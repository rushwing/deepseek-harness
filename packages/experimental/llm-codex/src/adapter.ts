/**
 * The Codex conversation backend adapter. Each dsh Session runs its turns on
 * one persistent Codex app-server thread recorded by the `codex/thread`
 * session event; auxiliary requests (`purpose` set) and requests without a
 * Session run on ephemeral threads. Only the new user input reaches Codex:
 * the product owns the conversation history, system prompt, and tools, so a
 * request's `system`, `tools`, and earlier messages are not sent.
 *
 * @module @deepseek-ai/dsh-experimental-llm-codex/adapter
 */

import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import {
  INTERACTIVE_THREAD_PERMISSION_PARAMS,
  abortError,
  threadPermissionParams,
  type CodexAppServerConnection,
  type CodexModel,
  type CodexThreadPermissionParams,
  type CodexTokenUsageBreakdown,
  type CodexTurnFailureCategory,
  type CodexTurnObserver,
  type CodexTurnOutcome,
  type CodexTurnRequest,
  type JsonObject,
} from '@deepseek-ai/dsh-codex-app-server'
import {
  ProductTurnStream,
  activityLine,
  conversationMissing,
  isEphemeralRequest,
  newUserInput,
  productNotSignedIn,
  type ProductActivity,
  type ProductActivityStatus,
  type ProductConversationBinding,
} from '@deepseek-ai/dsh-experimental-llm-product-backend'
import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type FinishReason,
  type GenerateOptions,
  type LlmFailure,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type ModelModality,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import type { LiveThread, ThreadRegistry } from './bridge.ts'
import type { CodexBackendSpec, CodexRoutePermissionMode, CodexRouteSpec } from './config.ts'
import { CODEX_THREAD_EVENT, CODEX_THREAD_PROJECTION_KEY } from './events.ts'
import type { CodexAppServerHost } from './host.ts'

const SOURCE = 'llm-codex'
const PRODUCT = 'Codex'
const LOGIN_COMMAND = 'codex login'
const DEFAULT_ROUTE = 'codex'
const TEXT_ONLY: readonly ModelModality[] = ['text']

/** Failure code for a turn the product stopped without being asked. */
const ABORTED_CODE = 'ABORTED'
/** Failure code for a product operation that failed before or while the product answered. */
const TRANSPORT_CODE = 'TRANSPORT'

/** Provider-neutral failure codes for each Codex turn failure category. */
const FAILURE_CODES: Readonly<Record<CodexTurnFailureCategory, string>> = {
  'limit': 'RATE_LIMIT',
  'access-policy': 'ACCESS_POLICY',
  'service': 'SERVER',
  'transport': TRANSPORT_CODE,
  'product-error': 'PRODUCT_ERROR',
  'invalid-result': 'INVALID_RESULT',
  'unknown': 'UNKNOWN',
}

/** What the adapter needs from its plugin. */
export interface CodexBackendAdapterOptions {
  /** Routes, environment, and timing resolved from configuration. */
  readonly spec: CodexBackendSpec
  /** The app-server process owner. */
  readonly host: CodexAppServerHost
  /** Threads with a running turn, read by the server-request bridge. */
  readonly threads: ThreadRegistry
  /** Workspace for the ephemeral threads of requests that carry no Session. */
  readonly cwd: string
  /** Resolves the live Agent of a request's Session. */
  readonly agents: Pick<AgentRegistry, 'get'>
  /** Reads the Session's `codexThread` binding. */
  readonly projections: Pick<SessionProjectionRegistry, 'stateOf'>
}

type Target =
  | { readonly kind: 'bound'; readonly agent: Agent; readonly cwd: string }
  | { readonly kind: 'ephemeral'; readonly cwd: string }

const itemStatus = z.enum(['inProgress', 'completed', 'failed', 'declined']).catch('completed')
  .transform((status): ProductActivityStatus => (status === 'inProgress' ? 'started' : status))

/** The completed thread items narrated as activity lines; every other item type is silent. */
const activityItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('commandExecution'), command: z.string(), status: itemStatus, exitCode: z.number().nullish() }),
  z.object({ type: z.literal('fileChange'), status: itemStatus, changes: z.array(z.object({ path: z.string() })) }),
  z.object({ type: z.literal('mcpToolCall'), server: z.string(), tool: z.string(), status: itemStatus }),
  z.object({ type: z.literal('dynamicToolCall'), tool: z.string(), status: itemStatus }),
  z.object({ type: z.literal('webSearch'), query: z.string() }),
])

function itemActivity(item: JsonObject): ProductActivity | undefined {
  const parsed = activityItem.safeParse(item)
  if (!parsed.success) return undefined
  const data = parsed.data
  switch (data.type) {
    case 'commandExecution':
      return {
        kind: 'command',
        command: data.command,
        status: data.status,
        ...typeof data.exitCode === 'number' ? { exitCode: data.exitCode } : {},
      }
    case 'fileChange':
      return { kind: 'file-change', paths: data.changes.map(change => change.path), status: data.status }
    case 'mcpToolCall':
      return { kind: 'tool', name: `${data.server}/${data.tool}`, status: data.status }
    case 'dynamicToolCall':
      return { kind: 'tool', name: data.tool, status: data.status }
    case 'webSearch':
      return { kind: 'web-search', query: data.query, status: 'completed' }
    /* v8 ignore next 2 -- closed-union exhaustiveness guard */
    default:
      return assertNever(data, 'codex thread item')
  }
}

function tokenUsage(usage: CodexTokenUsageBreakdown): TokenUsage {
  return {
    inputTokens: Math.max(0, usage.inputTokens - usage.cachedInputTokens),
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningOutputTokens,
  }
}

function permissionParams(mode: CodexRoutePermissionMode): CodexThreadPermissionParams {
  return mode === 'bridge' ? { ...INTERACTIVE_THREAD_PERMISSION_PARAMS } : threadPermissionParams(mode)
}

function modelInfo(provider: string, model: CodexModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.displayName,
    ...model.description === '' ? {} : { description: model.description },
    inputModalities: TEXT_ONLY,
  }
}

function resolvedModelInfo(provider: string, model: CodexModel): LlmResolvedModelInfo {
  if (model.supportedReasoningEfforts.length === 0) return modelInfo(provider, model)
  return {
    ...modelInfo(provider, model),
    reasoning: {
      efforts: model.supportedReasoningEfforts.map(effort => ({ id: ReasoningEffortId(effort), name: effort })),
      defaultEffort: ReasoningEffortId(model.defaultReasoningEffort),
    },
  }
}

function thrown(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Keep adapter-owned failures; classify anything the product runtime threw as a transport failure. */
function productFailure(error: unknown): LlmError {
  const cause = thrown(error)
  return cause instanceof LlmError ? cause : new LlmError(cause.message, TRANSPORT_CODE, { cause })
}

async function viaProduct<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error: unknown) {
    throw productFailure(error)
  }
}

function failureFinish(error: Error, signal: AbortSignal | undefined): FinishReason {
  if (signal?.aborted === true) {
    return { kind: 'aborted', failure: { message: error.message, code: ABORTED_CODE } }
  }
  const failure: LlmFailure = error instanceof LlmError ? error.failure : { message: error.message, code: 'UNKNOWN' }
  return { kind: 'error', failure }
}

function outcomeFinish(outcome: CodexTurnOutcome): FinishReason {
  switch (outcome.status) {
    case 'completed':
      return { kind: 'stop' }
    case 'interrupted':
      return { kind: 'aborted', failure: { message: `${PRODUCT} interrupted the turn`, code: ABORTED_CODE } }
    case 'failed':
      return outcome.failure.maxTokens === true
        ? { kind: 'max-tokens' }
        : { kind: 'error', failure: { message: outcome.message, code: FAILURE_CODES[outcome.failure.category] } }
    /* v8 ignore next 2 -- closed-union exhaustiveness guard */
    default:
      return assertNever(outcome, 'codex turn outcome')
  }
}

function idleTimeout(idleMs: number): LlmError {
  return new LlmError(`${PRODUCT} produced no output for ${String(idleMs)} ms`, 'TIMEOUT')
}

/**
 * `LlmAdapter` for every route of one Codex backend instance. All routes share
 * the host's app-server process and model catalog; they differ in the
 * permission mode their threads are created with.
 */
export class CodexBackendAdapter extends LlmAdapter {
  /** The catalog read from each app-server process, dropped with the process. */
  private readonly catalogs = new WeakMap<CodexAppServerConnection, Promise<readonly CodexModel[]>>()

  constructor(private readonly options: CodexBackendAdapterOptions) {
    super()
  }

  /**
   * Name a route after the product, qualified by the route name when it is not the default route.
   * @param provider - a configured route.
   * @returns the route's display metadata.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: provider === DEFAULT_ROUTE ? PRODUCT : `${PRODUCT} (${provider})` }
  }

  /**
   * The visible Codex model catalog, read from the running app-server.
   * @param provider - a configured route.
   * @returns every non-hidden model in Codex catalog order.
   * @throws `LlmError` with code `MISSING_CREDENTIAL` when Codex has no signed-in account.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = await this.catalog(new AbortController().signal)
    return models.map(model => modelInfo(provider, model))
  }

  /**
   * Resolve one model against the Codex catalog: catalog entries carry their
   * selectable reasoning efforts, unlisted ids resolve to text-only identity.
   * @param provider - a configured route.
   * @param model - the exact model id.
   * @param signal - cancellation of the catalog read.
   * @returns the model's identity, modalities, and reasoning efforts.
   */
  override async resolveModel(
    provider: string,
    model: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<LlmResolvedModelInfo> {
    const found = (await this.catalog(signal)).find(entry => entry.id === model)
    return found === undefined
      ? { provider, id: model, name: model, inputModalities: TEXT_ONLY }
      : resolvedModelInfo(provider, found)
  }

  /**
   * Run one Codex turn for the request and stream its text, reasoning,
   * activity lines, usage, and finish.
   * @param options - the request; `sessionId` selects the bound thread, `purpose` or a missing `sessionId` selects an ephemeral one.
   * @returns the chunk stream; every failure ends it with an `error` or `aborted` finish.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const turn = new ProductTurnStream()
    void this.run(options, turn).catch((error: unknown) => {
      turn.finish(failureFinish(thrown(error), options.signal))
    })
    return turn.chunks()
  }

  private async catalog(signal: AbortSignal): Promise<readonly CodexModel[]> {
    const connection = await viaProduct(() => this.options.host.connection(signal))
    const cached = this.catalogs.get(connection)
    if (cached !== undefined) return cached
    const reading = this.readCatalog(connection, signal)
    this.catalogs.set(connection, reading)
    reading.catch(() => { this.catalogs.delete(connection) })
    return reading
  }

  private async readCatalog(connection: CodexAppServerConnection, signal: AbortSignal): Promise<readonly CodexModel[]> {
    return viaProduct(async () => {
      const account = await connection.readAccount(signal)
      if (!account.signedIn && account.requiresOpenaiAuth) throw productNotSignedIn(PRODUCT, LOGIN_COMMAND)
      return connection.listModels(signal)
    })
  }

  private route(provider: string): CodexRouteSpec {
    const route = this.options.spec.routes.get(provider)
    if (route === undefined) throw new LlmError(`${SOURCE}: route ${JSON.stringify(provider)} is not configured`, 'NO_ROUTE')
    return route
  }

  private target(options: GenerateOptions): Target {
    const agent = options.sessionId === undefined ? undefined : this.options.agents.get(options.sessionId)
    if (isEphemeralRequest(options)) {
      const cwd = agent === undefined ? undefined : agent.session.header.cwd
      return { kind: 'ephemeral', cwd: cwd ?? this.options.cwd }
    }
    if (agent === undefined) {
      throw new LlmError(
        `${SOURCE}: Session ${JSON.stringify(options.sessionId)} has no live Agent to run a ${PRODUCT} turn for`,
        'NO_LIVE_AGENT',
      )
    }
    const cwd = agent.session.header.cwd
    if (cwd === undefined) {
      throw new LlmError(`${SOURCE}: Session ${JSON.stringify(agent.id)} has no workspace; ${PRODUCT} needs one to start a thread`, 'NO_WORKSPACE')
    }
    return { kind: 'bound', agent, cwd }
  }

  private async run(options: GenerateOptions, turn: ProductTurnStream): Promise<void> {
    const route = this.route(options.provider)
    const input = newUserInput(options.messages)
    if (input.length === 0) throw new LlmError(`${SOURCE}: the request carries no new user input for ${PRODUCT}`, 'EMPTY_REQUEST')
    const signal = options.signal ?? new AbortController().signal
    const target = this.target(options)
    const connection = await viaProduct(() => this.options.host.connection(signal))
    const threadId = await this.thread(connection, route, target, options.model, signal)
    const request: CodexTurnRequest = {
      input,
      model: options.model,
      ...options.reasoningEffort === undefined ? {} : { effort: options.reasoningEffort },
    }
    const live: LiveThread | undefined = target.kind === 'bound'
      ? { agent: target.agent, mode: route.permissionMode, signal }
      : undefined
    if (live !== undefined) this.options.threads.set(threadId, live)
    try {
      turn.finish(await this.turn(connection, threadId, request, turn, signal))
    } finally {
      if (live !== undefined) this.options.threads.delete(threadId)
    }
  }

  private async thread(
    connection: CodexAppServerConnection,
    route: CodexRouteSpec,
    target: Target,
    model: string,
    signal: AbortSignal,
  ): Promise<string> {
    const permission = permissionParams(route.permissionMode)
    if (target.kind === 'ephemeral') {
      const started = await viaProduct(() => connection.startThread({ cwd: target.cwd, permission, model, ephemeral: true }, signal))
      return started.threadId
    }
    const binding = this.options.projections.stateOf(target.agent.session, CODEX_THREAD_PROJECTION_KEY)
    if (binding === undefined) {
      throw new LlmError(`${SOURCE}: the ${CODEX_THREAD_PROJECTION_KEY} projection is not registered`, 'PROJECTION_MISSING')
    }
    if (binding === null) {
      const started = await viaProduct(() => connection.startThread({ cwd: target.cwd, permission, model, ephemeral: false }, signal))
      target.agent.session.append(CODEX_THREAD_EVENT, { conversationId: started.threadId, cwd: target.cwd, model })
      this.options.host.markThreadLive(started.threadId)
      return started.threadId
    }
    if (binding.cwd !== target.cwd) {
      throw new LlmError(
        `${SOURCE}: this Session's ${PRODUCT} thread was created in ${binding.cwd} but the Session workspace is now ${target.cwd}`,
        'WORKSPACE_MISMATCH',
      )
    }
    if (!this.options.host.threadIsLive(binding.conversationId)) {
      await this.resume(connection, binding, permission, model, signal)
      this.options.host.markThreadLive(binding.conversationId)
    }
    return binding.conversationId
  }

  private async resume(
    connection: CodexAppServerConnection,
    binding: ProductConversationBinding,
    permission: CodexThreadPermissionParams,
    model: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await connection.resumeThread(binding.conversationId, { cwd: binding.cwd, permission, model }, signal)
    } catch (error: unknown) {
      if (error instanceof JsonRpcResponseError) throw conversationMissing(PRODUCT, binding.conversationId, error.message)
      throw productFailure(error)
    }
  }

  /**
   * Run the turn. Caller cancellation and the idle timeout both ask Codex to
   * interrupt the turn (as soon as its id is known) and wait for its
   * `turn/completed`; when Codex has not settled the turn within
   * `disposeGraceMs`, the wait is abandoned.
   */
  private async turn(
    connection: CodexAppServerConnection,
    threadId: string,
    request: CodexTurnRequest,
    stream: ProductTurnStream,
    signal: AbortSignal,
  ): Promise<FinishReason> {
    const { disposeGraceMs, turnIdleTimeoutMs } = this.options.spec
    const control = new AbortController()
    let stopCause: Error | undefined
    let grace: ReturnType<typeof setTimeout> | undefined
    let idle: ReturnType<typeof setTimeout> | undefined
    const requestStop = (cause: Error): void => {
      if (stopCause !== undefined) return
      stopCause = cause
      const turnId = connection.activeTurn(threadId)
      if (turnId !== undefined) connection.interrupt(threadId, turnId)
      grace = setTimeout(() => { control.abort(cause) }, disposeGraceMs)
    }
    const onAbort = (): void => { requestStop(abortError(signal, SOURCE)) }
    const pulse = (): void => {
      if (turnIdleTimeoutMs === undefined) return
      clearTimeout(idle)
      idle = setTimeout(() => { requestStop(idleTimeout(turnIdleTimeoutMs)) }, turnIdleTimeoutMs)
    }
    const observer: CodexTurnObserver = {
      onTurnStarted: (turnId) => {
        pulse()
        if (stopCause !== undefined) connection.interrupt(threadId, turnId)
      },
      onTextDelta: (delta) => {
        pulse()
        stream.text(delta)
      },
      onReasoningDelta: (delta) => {
        pulse()
        stream.reasoning(delta)
      },
      onItemStarted: () => { pulse() },
      onItemCompleted: (item) => {
        pulse()
        const activity = itemActivity(item)
        if (activity !== undefined) stream.reasoning(`${activityLine(activity)}\n`)
      },
      onUsage: (usage) => {
        pulse()
        stream.usage(tokenUsage(usage))
      },
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pulse()
    try {
      const outcome = await viaProduct(() => connection.runTurn(threadId, request, control.signal, observer))
      if (stopCause !== undefined) throw stopCause
      return outcomeFinish(outcome)
    } finally {
      signal.removeEventListener('abort', onAbort)
      clearTimeout(idle)
      clearTimeout(grace)
    }
  }
}
