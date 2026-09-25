/**
 * Minimal Codex app-server 0.153.4 protocol adapter. The shared JSON-RPC
 * transport owns framing and request correlation; this module owns only the
 * product methods, current thread/turn association, unattended approval
 * responses, and terminal-answer selection.
 *
 * @module @deepseek-ai/dsh-subagent-codex/wire
 */

import type { Readable, Writable } from 'node:stream'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import {
  connectTransport,
  expectObject,
  expectString,
  initializeHandshake,
  raceAbort,
  startThreadRequest,
  threadPermissionParams,
  turnFailureInfo,
  unattendedDecision as sharedUnattendedDecision,
  type CodexPermissionMode,
  type CodexTurnFailureCategory,
  type JsonObject,
} from '@deepseek-ai/dsh-codex-app-server'
import type { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'

const SOURCE = 'subagent-codex'

/** Product facts owned by the Codex wire after publication. */
export interface CodexWireFailureFacts {
  readonly stage: 'turn-start' | 'turn'
  readonly category: CodexTurnFailureCategory
  readonly httpStatus?: number | undefined
}

const object = (value: unknown, label: string): JsonObject => expectObject(value, label, SOURCE)
const string = (value: unknown, label: string): string => expectString(value, label, SOURCE)
const unattendedDecision = (params: JsonObject): 'cancel' | 'decline' => sharedUnattendedDecision(params, SOURCE)

function unattendedDiagnostic(
  mode: CodexPermissionMode,
  request: 'command approval' | 'file approval' | 'permission grant' | 'user input' | 'MCP elicitation' | 'command execution' | 'file change' | 'sandbox execution',
  decision: 'cancelled' | 'declined' | 'denied' | 'empty response' | 'failed',
  reason: string,
): string {
  return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed protocol and stream failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * One app-server connection and its single ephemeral thread/turn.
 *
 * The class deliberately exposes no generic request surface. Supporting
 * another product method must first become part of the provider contract.
 */
export class CodexAppServerWire {
  private readonly transport: JsonRpcLineTransport
  private readonly fatal = Promise.withResolvers<never>()
  private threadId: string | undefined
  private turnId: string | undefined
  private pendingTurnId: string | undefined
  private turnCompleted: PromiseWithResolvers<{
    readonly params: JsonObject
    readonly order: number
  }> | undefined
  private readonly earlyTurnNotifications: Array<{
    readonly method: string
    readonly params: JsonObject
    readonly order: number
  }> = []
  private lastFinalAnswer: string | undefined
  private lastUnphasedAnswer: string | undefined
  private diagnostic: string | undefined
  private failure: CodexWireFailureFacts | undefined
  private diagnosticOrder = 0
  private observationOrder = 0
  private pendingDiagnostic: {
    readonly order: number
    readonly request: Parameters<typeof unattendedDiagnostic>[1]
    readonly decision: Parameters<typeof unattendedDiagnostic>[2]
    readonly reason: string
  } | undefined
  private inputEnded = false
  private terminalObserved = false
  private closed = false

  private readonly detachEnd: () => void

  constructor(
    input: Readable,
    output: Writable,
    private readonly permissionMode: CodexPermissionMode,
    private readonly model?: string,
  ) {
    /* jscpd:ignore-start -- the one-shot wire and the persistent connection
     * bind the same three handlers to the shared transport helper. */
    const connected = connectTransport(input, output, {
      request: (method, params) => this.handleServerRequest(method, params),
      notification: (method, params) => { this.handleNotification(method, params) },
      fatal: (error) => { this.fail(error) },
      ended: () => { this.inputEnded = true },
    }, SOURCE)
    /* jscpd:ignore-end */
    this.transport = connected.transport
    this.detachEnd = connected.detachEnd
    // Fatal protocol state can arrive after the current guarded operation has
    // already settled. Keep the shared rejection observed without inserting
    // another promise-adoption hop into active races.
    void this.fatal.promise.catch(() => {})
  }

  /** Start reading app-server frames. */
  start(): void {
    this.transport.start()
  }

  /**
   * Whether protocol output ended before a terminal turn notification.
   * @returns `true` only for an early protocol close without a terminal turn.
   */
  endedBeforeTerminal(): boolean {
    return this.inputEnded && !this.terminalObserved
  }

  /**
   * Perform the required app-server initialize/initialized handshake.
   * @param signal - unpublished-start cancellation.
   */
  async initialize(signal: AbortSignal): Promise<void> {
    await initializeHandshake(this.transport, pending => this.guarded(pending, signal), signal, SOURCE)
  }

  /**
   * Create the run's private ephemeral thread and retain its identity.
   * @param cwd - parent Session workspace.
   * @param signal - unpublished-start cancellation.
   */
  async startThread(cwd: string, signal: AbortSignal): Promise<void> {
    const thread = await startThreadRequest(this.transport, pending => this.guarded(pending, signal), {
      cwd,
      permission: threadPermissionParams(this.permissionMode),
      model: this.model,
      ephemeral: true,
    }, signal, SOURCE)
    if (!thread.ephemeral) {
      throw new Error('subagent-codex: app-server did not create an ephemeral thread')
    }
    this.threadId = thread.id
  }

  /**
   * Submit the one text-only task and wait for this thread/turn's authoritative
   * terminal notification.
   * @param texts - already validated task text blocks.
   * @param signal - local cancellation for the published run.
   * @returns the shared subagent result.
   */
  async runTurn(
    texts: readonly string[],
    signal: AbortSignal,
  ): Promise<SubagentResult> {
    const completion = Promise.withResolvers<{
      readonly params: JsonObject
      readonly order: number
    }>()
    this.turnCompleted = completion
    const threadId = this.threadId as string
    try {
      const response = object(await this.guarded(this.transport.request('turn/start', {
        threadId,
        input: texts.map(text => ({ type: 'text', text, text_elements: [] })),
      }, signal), signal), 'turn/start response')
      const turn = object(response.turn, 'turn/start turn')
      this.commitTurnId(string(turn.id, 'turn/start turn id'))
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn-start', category: 'unknown' })
      throw error
    }

    let completed: {
      readonly params: JsonObject
      readonly order: number
    }
    let terminal: JsonObject
    try {
      completed = await this.guarded(completion.promise, signal)
      terminal = object(completed.params.turn, 'turn/completed turn')
    } catch (error: unknown) {
      this.recordFailure({ stage: 'turn', category: 'unknown' })
      throw error
    }
    const status = terminal.status
    if (status !== 'completed') {
      const parsed = turnFailureInfo(terminal)
      this.recordFailure(parsed.httpStatus === undefined
        ? { stage: 'turn', category: parsed.category }
        : {
          stage: 'turn',
          category: parsed.category,
          httpStatus: parsed.httpStatus,
        })
      if (parsed.sandboxFailure) {
        this.recordDiagnostic(
          'sandbox execution',
          'failed',
          'Codex reported a sandbox failure',
          completed.order,
        )
      }
      if (parsed.maxTokens) {
        return { output: this.collectOutput(), stopReason: 'max-tokens' }
      }
      const detail = status === 'failed' ? `: ${parsed.category}` : ''
      throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`)
    }
    const output = this.collectOutput()
    if (output.length === 0) {
      this.recordFailure({ stage: 'turn', category: 'invalid-result' })
      throw new Error('subagent-codex: Codex completed without a final answer')
    }
    return { output, stopReason: 'completed' }
  }

  /**
   * Best-effort remote cancellation. Local settlement and process teardown
   * remain authoritative when the child no longer accepts protocol requests.
   */
  interrupt(): void {
    if (this.threadId === undefined || this.turnId === undefined || this.closed) return
    void this.transport.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    }).catch(() => {})
  }

  /**
   * The best non-commentary answer observed so far, preserving exact bytes.
   * @returns the selected final or nullable-phase text block, if any.
   */
  collectOutput(): ContentBlock[] {
    const selected = this.lastFinalAnswer ?? this.lastUnphasedAnswer
    return selected !== undefined && selected.trim().length > 0
      ? [{ type: 'text', text: selected }]
      : []
  }

  /**
   * The latest safe unattended permission fact observed for this run.
   * @returns provider-authored diagnostic text, when one was observed.
   */
  collectDiagnostic(): string | undefined {
    return this.diagnostic
  }

  /**
   * The structured failure fact observed for this published turn.
   * Call only after a non-completed return or rejection from {@link runTurn}.
   * @returns the fixed stage/category pair and optional HTTP status.
   */
  collectFailure(): CodexWireFailureFacts {
    return this.failure as CodexWireFailureFacts
  }

  /** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.detachEnd()
    this.transport.close()
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    const withFatal = Promise.race([this.fatal.promise, pending])
    return raceAbort(withFatal, signal, SOURCE)
  }

  private fail(error: Error): void {
    this.fatal.reject(error)
  }

  private observePendingTurnId(id: string): void {
    if (this.turnCompleted === undefined) {
      throw new Error('subagent-codex: app-server referenced a turn before turn/start')
    }
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: app-server referenced conflicting turns')
    }
    this.pendingTurnId = id
  }

  private commitTurnId(id: string): void {
    if (this.pendingTurnId !== undefined && this.pendingTurnId !== id) {
      throw new Error('subagent-codex: turn/start response did not match the active turn')
    }
    this.turnId = id
    const pendingDiagnostic = this.pendingDiagnostic
    this.pendingDiagnostic = undefined
    if (pendingDiagnostic !== undefined) {
      this.recordDiagnostic(
        pendingDiagnostic.request,
        pendingDiagnostic.decision,
        pendingDiagnostic.reason,
        pendingDiagnostic.order,
      )
    }
    const notifications = this.earlyTurnNotifications.splice(0)
    for (const notification of notifications) {
      this.handleNotification(
        notification.method,
        notification.params,
        notification.order,
      )
    }
  }

  /**
   * Validate the request's thread and turn association.
   * @returns `true` when the matching turn is still provisional, so the caller
   * defers its diagnostic until `commitTurnId()`.
   */
  private validateRunIds(
    params: JsonObject,
    nullableTurn = false,
  ): boolean {
    if (params.threadId !== this.threadId) {
      throw new Error('subagent-codex: app-server request referenced another thread')
    }
    if (nullableTurn && params.turnId === null) return false
    const id = string(params.turnId, 'server request turn id')
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      return true
    }
    if (id !== this.turnId) {
      throw new Error('subagent-codex: app-server request referenced another turn')
    }
    return false
  }

  private recordRequestDiagnostic(
    provisional: boolean,
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
  ): void {
    const order = this.nextObservationOrder()
    if (provisional) {
      this.pendingDiagnostic = {
        order,
        request,
        decision,
        reason,
      }
      return
    }
    this.recordDiagnostic(request, decision, reason, order)
  }

  private recordDiagnostic(
    request: Parameters<typeof unattendedDiagnostic>[1],
    decision: Parameters<typeof unattendedDiagnostic>[2],
    reason: string,
    order = this.nextObservationOrder(),
  ): void {
    if (order < this.diagnosticOrder) return
    this.diagnosticOrder = order
    this.diagnostic = unattendedDiagnostic(
      this.permissionMode,
      request,
      decision,
      reason,
    )
  }

  private recordFailure(facts: CodexWireFailureFacts): void {
    this.failure = facts
  }

  private nextObservationOrder(): number {
    this.observationOrder += 1
    return this.observationOrder
  }

  private recordDeclinedItem(item: JsonObject, order?: number): boolean {
    if (item.type === 'commandExecution' && item.status === 'declined') {
      this.recordDiagnostic(
        'command execution',
        'declined',
        'Codex declined the command under the selected permission mode',
        order,
      )
      return true
    }
    if (item.type === 'fileChange' && item.status === 'declined') {
      this.recordDiagnostic(
        'file change',
        'declined',
        'Codex declined the file change under the selected permission mode',
        order,
      )
      return true
    }
    return false
  }

  private handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval':
        {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'command approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/fileChange/requestApproval':
        {
          const provisional = this.validateRunIds(params)
          const decision = unattendedDecision(params)
          this.recordRequestDiagnostic(
            provisional,
            'file approval',
            decision === 'cancel' ? 'cancelled' : 'declined',
            'the provider does not grant interactive approval',
          )
          return Promise.resolve({ decision })
        }
        case 'item/permissions/requestApproval':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'permission grant',
            'denied',
            'the provider grants no additional turn permissions',
          )
          return Promise.resolve({ permissions: {}, scope: 'turn' })
        case 'item/tool/requestUserInput':
          this.recordRequestDiagnostic(
            this.validateRunIds(params),
            'user input',
            'empty response',
            'the provider does not collect interactive answers',
          )
          return Promise.resolve({ answers: {} })
        case 'mcpServer/elicitation/request':
          this.recordRequestDiagnostic(
            this.validateRunIds(params, true),
            'MCP elicitation',
            'declined',
            'the provider does not collect interactive MCP input',
          )
          return Promise.resolve({ action: 'decline', content: null, _meta: null })
        default:
          throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`)
      }
    } catch (error: unknown) {
      const normalized = thrown(error)
      this.fail(normalized)
      return Promise.reject(normalized)
    }
  }

  private handleNotification(
    method: string,
    params: JsonObject,
    order?: number,
  ): void {
    if (method === 'turn/started') {
      const threadId = string(params.threadId, 'turn/started thread id')
      if (threadId !== this.threadId) return
      const turn = object(params.turn, 'turn/started turn')
      if (this.turnCompleted !== undefined && this.turnId === undefined) {
        this.observePendingTurnId(string(turn.id, 'turn/started turn id'))
      }
      return
    }
    if (method === 'item/completed') {
      const threadId = string(params.threadId, 'item/completed thread id')
      if (threadId !== this.threadId) return
      const id = string(params.turnId, 'item/completed turn id')
      if (this.turnId === undefined) {
        if (this.turnCompleted !== undefined) {
          this.observePendingTurnId(id)
          this.earlyTurnNotifications.push({
            method,
            params,
            order: this.nextObservationOrder(),
          })
        }
        return
      }
      if (id !== this.turnId) return
      const item = object(params.item, 'item/completed item')
      if (this.recordDeclinedItem(item, order)) return
      if (item.type !== 'agentMessage') return
      const text = typeof item.text === 'string'
        ? item.text
        : (() => { throw new Error('subagent-codex: app-server returned an invalid agent message') })()
      if (item.phase === 'final_answer') {
        this.lastFinalAnswer = text
      } else if (item.phase === null) {
        this.lastUnphasedAnswer = text
      } else if (item.phase !== 'commentary') {
        throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`)
      }
      return
    }
    if (method !== 'turn/completed') return
    const threadId = string(params.threadId, 'turn/completed thread id')
    if (threadId !== this.threadId) return
    const turn = object(params.turn, 'turn/completed turn')
    const id = string(turn.id, 'turn/completed turn id')
    const turnCompleted = this.turnCompleted
    if (turnCompleted === undefined) return
    if (this.turnId === undefined) {
      this.observePendingTurnId(id)
      this.earlyTurnNotifications.push({
        method,
        params,
        order: this.nextObservationOrder(),
      })
      return
    }
    if (id !== this.turnId) return
    this.terminalObserved = true
    if (!['completed', 'interrupted', 'failed'].includes(String(turn.status))) {
      throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`)
    }
    turnCompleted.resolve({
      params,
      order: order ?? this.nextObservationOrder(),
    })
  }
}
