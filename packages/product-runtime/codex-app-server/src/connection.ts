/**
 * One persistent Codex app-server connection serving many threads: the
 * handshake, thread creation and resume, one streamed turn per thread at a
 * time, interruption, the model catalog, and account status. Server requests
 * (approvals, user input, elicitation) are delegated to an injected handler
 * so each consumer decides how a human is involved.
 *
 * @module @deepseek-ai/dsh-codex-app-server/connection
 */

import type { Readable, Writable } from 'node:stream'
import type { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { CodexThreadPermissionParams } from './permission.ts'
import {
  connectTransport,
  expectObject,
  expectString,
  initializeHandshake,
  raceAbort,
  startThreadRequest,
  turnFailureInfo,
  type CodexTurnFailureInfo,
  type JsonObject,
} from './protocol.ts'

const SOURCE = 'codex app-server'
const MODEL_PAGE_SIZE = 100

/** A server-initiated request the connection could not answer by itself. */
export interface CodexServerRequest {
  /** Official request method, for example `item/commandExecution/requestApproval`. */
  readonly method: string
  /** Verbatim request params. */
  readonly params: JsonObject
  /** The thread the request names, when it names one. */
  readonly threadId: string | undefined
  /** The turn the request names, when it names one. */
  readonly turnId: string | undefined
}

/**
 * Answers server requests. The resolved value is sent verbatim as the JSON-RPC
 * result; a rejection becomes a JSON-RPC error response and leaves the
 * connection and every thread running.
 */
export type CodexServerRequestHandler = (request: CodexServerRequest) => Promise<unknown>

/** Fields for one `thread/start`. */
export interface CodexThreadOptions {
  /** Workspace the thread works in. */
  readonly cwd: string
  /** The approval, reviewer, and sandbox fields the thread runs under. */
  readonly permission: CodexThreadPermissionParams
  /** Model fixed for the thread; omission leaves native Codex settings in force. */
  readonly model?: string
  /** Create a thread Codex does not persist. Defaults to a persistent thread. */
  readonly ephemeral?: boolean
}

/** Fields for one `thread/resume`. */
export interface CodexThreadResumeOptions {
  /** Workspace the resumed thread works in. */
  readonly cwd: string
  /** The approval, reviewer, and sandbox fields the resumed thread runs under. */
  readonly permission: CodexThreadPermissionParams
  /** Model for the resumed thread; omission leaves the thread's own setting. */
  readonly model?: string
}

/** One turn's input and per-turn model selection. */
export interface CodexTurnRequest {
  /** Non-empty text blocks sent as the user input. */
  readonly input: readonly string[]
  /** Model for this turn; omission keeps the thread's model. */
  readonly model?: string
  /** Reasoning effort for this turn; omission keeps the model's default. */
  readonly effort?: string
}

/** Token counts from one `thread/tokenUsage/updated` notification. */
export interface CodexTokenUsageBreakdown {
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  readonly reasoningOutputTokens: number
  readonly totalTokens: number
}

/** Receives the streamed facts of one turn as they arrive. */
export interface CodexTurnObserver {
  /** The `turn/start` response arrived; from here on the turn can be interrupted by id. */
  onTurnStarted(turnId: string): void
  /** An assistant message text fragment. */
  onTextDelta(delta: string): void
  /** A reasoning or reasoning-summary text fragment. */
  onReasoningDelta(delta: string): void
  /** A thread item began; the verbatim item carries `type` and `id`. */
  onItemStarted(item: JsonObject): void
  /** A thread item settled; the verbatim item carries its final fields. */
  onItemCompleted(item: JsonObject): void
  /** The turn's latest token usage. */
  onUsage(usage: CodexTokenUsageBreakdown): void
}

/** How one turn ended, from the authoritative `turn/completed` notification. */
export type CodexTurnOutcome =
  | {
    readonly status: 'completed'
    readonly turnId: string
    /** The final assistant message text, when the turn produced one. */
    readonly finalText: string | undefined
  }
  | {
    readonly status: 'interrupted'
    readonly turnId: string
  }
  | {
    readonly status: 'failed'
    readonly turnId: string
    /** Coarse classification of the product's error. */
    readonly failure: CodexTurnFailureInfo
    /** The product's error message. */
    readonly message: string
  }

/** One visible catalog entry from `model/list`. */
export interface CodexModel {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly isDefault: boolean
  readonly defaultReasoningEffort: string
  readonly supportedReasoningEfforts: readonly string[]
  readonly inputModalities: readonly string[]
}

/** The account facts `account/read` reports. */
export interface CodexAccountStatus {
  /** Whether an account is signed in. */
  readonly signedIn: boolean
  /** Whether the configured model provider needs an OpenAI login at all. */
  readonly requiresOpenaiAuth: boolean
  /** The verbatim account object, or `null` when signed out. */
  readonly account: JsonObject | null
}

interface ActiveTurn {
  turnId: string | undefined
  readonly observer: CodexTurnObserver
  readonly completion: PromiseWithResolvers<CodexTurnOutcome>
  readonly early: Array<{ readonly method: string; readonly params: JsonObject }>
  lastFinalAnswer: string | undefined
  lastUnphasedAnswer: string | undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${SOURCE}: app-server returned invalid ${label}`)
  }
  return value
}

function usageBreakdown(value: unknown): CodexTokenUsageBreakdown {
  const fields = expectObject(value, 'token usage breakdown')
  return {
    inputTokens: integer(fields.inputTokens, 'token usage inputTokens'),
    cachedInputTokens: integer(fields.cachedInputTokens, 'token usage cachedInputTokens'),
    outputTokens: integer(fields.outputTokens, 'token usage outputTokens'),
    reasoningOutputTokens: integer(fields.reasoningOutputTokens, 'token usage reasoningOutputTokens'),
    totalTokens: integer(fields.totalTokens, 'token usage totalTokens'),
  }
}

function catalogModel(value: unknown): CodexModel {
  const model = expectObject(value, 'model/list entry')
  const efforts = Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []
  return {
    id: expectString(model.id, 'model/list entry id'),
    displayName: optionalString(model.displayName) ?? expectString(model.id, 'model/list entry id'),
    description: optionalString(model.description) ?? '',
    isDefault: model.isDefault === true,
    defaultReasoningEffort: expectString(model.defaultReasoningEffort, 'model/list entry defaultReasoningEffort'),
    supportedReasoningEfforts: efforts.flatMap((entry) => {
      const effort = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as JsonObject).reasoningEffort
        : undefined
      return typeof effort === 'string' && effort.length > 0 ? [effort] : []
    }),
    inputModalities: model.inputModalities === undefined ? ['text'] : stringList(model.inputModalities),
  }
}

/**
 * A long-lived app-server connection. Construct it over the app-server's
 * stdout and stdin, call {@link start}, complete {@link initialize}, then use
 * threads for as long as the process lives. Every method rejects once the
 * connection is closed or the protocol stream ends.
 */
export class CodexAppServerConnection {
  private readonly transport: JsonRpcLineTransport
  private readonly detachEnd: () => void
  private readonly fatal = Promise.withResolvers<never>()
  private readonly turns = new Map<string, ActiveTurn>()
  private fatalError: Error | undefined

  /**
   * @param input - the app-server's stdout.
   * @param output - the app-server's stdin.
   * @param handler - answers approval, user-input, and elicitation requests.
   */
  constructor(
    input: Readable,
    output: Writable,
    private readonly handler: CodexServerRequestHandler,
  ) {
    const connected = connectTransport(input, output, {
      request: (method, params) => this.handleServerRequest(method, params),
      notification: (method, params) => { this.handleNotification(method, params) },
      fatal: (error) => { this.fail(error) },
    }, SOURCE)
    this.transport = connected.transport
    this.detachEnd = connected.detachEnd
    void this.fatal.promise.catch(() => {})
  }

  /** Whether the connection was closed, a stream failed, or the protocol stream ended. */
  get closed(): boolean {
    return this.fatalError !== undefined
  }

  /** Start reading app-server frames. */
  start(): void {
    this.transport.start()
  }

  /**
   * Perform the required `initialize` / `initialized` handshake.
   * @param signal - cancellation of the handshake.
   */
  async initialize(signal: AbortSignal): Promise<void> {
    await initializeHandshake(this.transport, pending => this.guarded(pending, signal), signal, SOURCE)
  }

  /**
   * Create a thread.
   * @param options - workspace, permission mode, optional model, and persistence.
   * @param signal - cancellation of the request.
   * @returns the id Codex assigned to the thread.
   */
  async startThread(options: CodexThreadOptions, signal: AbortSignal): Promise<{ threadId: string }> {
    const thread = await startThreadRequest(this.transport, pending => this.guarded(pending, signal), {
      cwd: options.cwd,
      permission: options.permission,
      model: options.model,
      ephemeral: options.ephemeral ?? false,
    }, signal, SOURCE)
    return { threadId: thread.id }
  }

  /**
   * Resume a thread Codex persisted earlier.
   * @param threadId - the thread to resume.
   * @param options - workspace, permission mode, and optional model.
   * @param signal - cancellation of the request.
   * @returns the id of the resumed thread as Codex reports it.
   */
  async resumeThread(
    threadId: string,
    options: CodexThreadResumeOptions,
    signal: AbortSignal,
  ): Promise<{ threadId: string }> {
    const response = expectObject(await this.guarded(this.transport.request('thread/resume', {
      threadId,
      cwd: options.cwd,
      ...options.model === undefined ? {} : { model: options.model },
      ...options.permission,
    }, signal), signal), 'thread/resume response')
    const thread = expectObject(response.thread, 'thread/resume thread')
    return { threadId: expectString(thread.id, 'thread/resume thread id') }
  }

  /**
   * The id of the turn running on a thread.
   * @param threadId - the thread to inspect.
   * @returns the turn id once `turn/start` has answered, otherwise `undefined`.
   */
  activeTurn(threadId: string): string | undefined {
    return this.turns.get(threadId)?.turnId
  }

  /**
   * Run one turn on a thread and stream its facts to the observer until the
   * authoritative `turn/completed` notification.
   * @param threadId - a thread this connection started or resumed.
   * @param request - user input and per-turn model selection.
   * @param signal - cancellation; aborting rejects and frees the thread but does not interrupt the product by itself.
   * @param observer - receives deltas, items, and usage as they arrive.
   * @returns how the turn ended.
   */
  async runTurn(
    threadId: string,
    request: CodexTurnRequest,
    signal: AbortSignal,
    observer: CodexTurnObserver,
  ): Promise<CodexTurnOutcome> {
    if (this.turns.has(threadId)) {
      throw new Error(`${SOURCE}: thread ${JSON.stringify(threadId)} already has an active turn`)
    }
    const active: ActiveTurn = {
      turnId: undefined,
      observer,
      completion: Promise.withResolvers<CodexTurnOutcome>(),
      early: [],
      lastFinalAnswer: undefined,
      lastUnphasedAnswer: undefined,
    }
    void active.completion.promise.catch(() => {})
    this.turns.set(threadId, active)
    try {
      const response = expectObject(await this.guarded(this.transport.request('turn/start', {
        threadId,
        input: request.input.map(text => ({ type: 'text', text, text_elements: [] })),
        ...request.model === undefined ? {} : { model: request.model },
        ...request.effort === undefined ? {} : { effort: request.effort },
      }, signal), signal), 'turn/start response')
      const turn = expectObject(response.turn, 'turn/start turn')
      active.turnId = expectString(turn.id, 'turn/start turn id')
      observer.onTurnStarted(active.turnId)
      for (const notification of active.early.splice(0)) {
        this.handleNotification(notification.method, notification.params)
      }
      return await this.guarded(active.completion.promise, signal)
    } finally {
      this.turns.delete(threadId)
    }
  }

  /**
   * Ask Codex to interrupt a running turn. The turn still ends through its
   * `turn/completed` notification; a refused or lost request is ignored.
   * @param threadId - the thread whose turn to interrupt.
   * @param turnId - the running turn.
   */
  interrupt(threadId: string, turnId: string): void {
    if (this.closed) return
    void this.transport.request('turn/interrupt', { threadId, turnId }).catch(() => {})
  }

  /**
   * List the visible model catalog, following pagination.
   * @param signal - cancellation of the listing.
   * @returns every non-hidden model in catalog order.
   */
  async listModels(signal: AbortSignal): Promise<CodexModel[]> {
    const models: CodexModel[] = []
    let cursor: string | null = null
    do {
      const page: JsonObject = expectObject(await this.guarded(this.transport.request('model/list', {
        cursor,
        includeHidden: false,
        limit: MODEL_PAGE_SIZE,
      }, signal), signal), 'model/list response')
      const data: unknown = page.data
      if (!Array.isArray(data)) throw new Error(`${SOURCE}: app-server returned invalid model/list data`)
      for (const entry of data) {
        const model = expectObject(entry, 'model/list entry')
        if (model.hidden === true) continue
        models.push(catalogModel(model))
      }
      cursor = optionalString(page.nextCursor) ?? null
    } while (cursor !== null)
    return models
  }

  /**
   * Read the signed-in account without forcing a token refresh.
   * @param signal - cancellation of the request.
   * @returns the account status.
   */
  async readAccount(signal: AbortSignal): Promise<CodexAccountStatus> {
    const response = expectObject(await this.guarded(this.transport.request('account/read', {
      refreshToken: false,
    }, signal), signal), 'account/read response')
    const account = response.account === null || response.account === undefined
      ? null
      : expectObject(response.account, 'account/read account')
    return {
      signedIn: account !== null,
      requiresOpenaiAuth: response.requiresOpenaiAuth === true,
      account,
    }
  }

  /** Detach protocol listeners, reject pending requests, and fail active turns. Idempotent. */
  close(): void {
    if (this.closed) return
    this.detachEnd()
    this.transport.close()
    this.fail(new Error(`${SOURCE}: connection is closed`))
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    const fatalError = this.fatalError
    if (fatalError !== undefined) {
      void pending.catch(() => {})
      throw fatalError
    }
    return raceAbort(Promise.race([this.fatal.promise, pending]), signal, SOURCE)
  }

  /** Record the first fatal error, which closes the connection, and fail every waiter with it. */
  private fail(error: Error): void {
    this.fatalError ??= error
    this.fatal.reject(error)
    for (const active of this.turns.values()) active.completion.reject(error)
  }

  private handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    return this.handler({
      method,
      params,
      threadId: optionalString(params.threadId),
      turnId: optionalString(params.turnId),
    })
  }

  private handleNotification(method: string, params: JsonObject): void {
    const threadId = optionalString(params.threadId)
    if (threadId === undefined) return
    const active = this.turns.get(threadId)
    if (active === undefined) return
    const turnId = method === 'turn/started' || method === 'turn/completed'
      ? expectString(expectObject(params.turn, `${method} turn`).id, `${method} turn id`)
      : optionalString(params.turnId)
    if (active.turnId === undefined) {
      active.early.push({ method, params })
      return
    }
    if (turnId !== active.turnId) return
    switch (method) {
      case 'item/agentMessage/delta':
        active.observer.onTextDelta(expectString(params.delta, 'agent message delta'))
        return
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        active.observer.onReasoningDelta(expectString(params.delta, 'reasoning delta'))
        return
      case 'item/started':
        active.observer.onItemStarted(expectObject(params.item, 'item/started item'))
        return
      case 'item/completed': {
        const item = expectObject(params.item, 'item/completed item')
        if (item.type === 'agentMessage') {
          const text = expectString(item.text, 'agent message text')
          if (item.phase === 'final_answer') active.lastFinalAnswer = text
          else if (item.phase === null || item.phase === undefined) active.lastUnphasedAnswer = text
        }
        active.observer.onItemCompleted(item)
        return
      }
      case 'thread/tokenUsage/updated': {
        const usage = expectObject(params.tokenUsage, 'thread token usage')
        active.observer.onUsage(usageBreakdown(usage.last))
        return
      }
      case 'turn/completed':
        active.completion.resolve(this.terminalOutcome(active, expectObject(params.turn, 'turn/completed turn')))
        return
      default:
        return
    }
  }

  private terminalOutcome(active: ActiveTurn, turn: JsonObject): CodexTurnOutcome {
    const turnId = active.turnId as string
    switch (turn.status) {
      case 'completed':
        return { status: 'completed', turnId, finalText: active.lastFinalAnswer ?? active.lastUnphasedAnswer }
      case 'interrupted':
        return { status: 'interrupted', turnId }
      case 'failed': {
        const error = turn.error !== null && typeof turn.error === 'object' && !Array.isArray(turn.error)
          ? turn.error as JsonObject
          : {}
        return {
          status: 'failed',
          turnId,
          failure: turnFailureInfo(turn),
          message: optionalString(error.message) ?? 'Codex turn failed',
        }
      }
      default:
        throw new Error(`${SOURCE}: app-server returned invalid terminal turn status ${String(turn.status)}`)
    }
  }
}
