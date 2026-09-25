/**
 * The Claude Code conversation backend adapter. Each dsh Session runs its
 * turns on one Claude Code session recorded by the `claude-code/session`
 * event: every turn is one Agent SDK `query()` that resumes the bound
 * session, sends only the new user input, and streams Claude Code's text,
 * thinking, tool activity, and usage back. Auxiliary requests (`purpose`
 * set) and requests without a Session run as unpersisted queries.
 *
 * @module @deepseek-ai/dsh-experimental-llm-claude-code/adapter
 */

import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import {
  ManagedClaudeCodeProcess,
  SUPPORTED_UNATTENDED_DIALOG_KINDS,
  claudeSpawnSpec,
  type Options,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from '@deepseek-ai/dsh-claude-agent-sdk'
import {
  ProductTurnStream,
  TEXT_ONLY_MODALITIES,
  activityLine,
  conversationMissing,
  providerDisplayInfo,
  readBinding,
  requireNewUserInput,
  resolveProductTarget,
  routeOf,
  streamProductTurn,
  thrown,
  unlistedModelInfo,
  type BackendIdentity,
  type ProductActivity,
  type ProductConversationBinding,
  type ProductTarget,
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
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { scrubbedParentEnv, type SubprocessHandle, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import {
  ASK_USER_QUESTION_TOOL,
  createBridgedCallbacks,
  unattendedCallbacks,
  type BridgeServices,
  type ClaudeCodeCallbacks,
} from './bridge.ts'
import type { ClaudeCodeBackendSpec, ClaudeCodeRouteSpec } from './config.ts'
import { CLAUDE_CODE_SESSION_EVENT, CLAUDE_CODE_SESSION_PROJECTION_KEY } from './events.ts'

const SOURCE = 'llm-claude-code'
const PRODUCT = 'Claude Code'
const IDENTITY: BackendIdentity = { source: SOURCE, product: PRODUCT }
const DEFAULT_ROUTE = 'claude-code'
const TRANSPORT_CODE = 'TRANSPORT'
/** The effort levels the pinned SDK accepts. */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type EffortLevel = typeof EFFORT_LEVELS[number]
/** Failure codes for the SDK's terminal result subtypes. */
const RESULT_ERROR_CODES: Readonly<Record<string, string>> = {
  error_max_turns: 'MAX_TURNS',
  error_max_budget_usd: 'BUDGET_EXCEEDED',
  error_max_structured_output_retries: 'INVALID_RESULT',
  error_during_execution: 'PRODUCT_ERROR',
}
/** Claude Code tools whose calls narrate as file changes. */
const FILE_CHANGE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** How many trailing stderr lines a failure message quotes. */
const STDERR_TAIL_LINES = 5

/** The part of an SDK `Query` the adapter uses, so tests can script it without the full control surface. */
export type QueryLike = AsyncIterable<SDKMessage> & Pick<Query, 'close' | 'interrupt' | 'supportedModels' | 'accountInfo'>

/** The SDK `query` entry point, or a stand-in with the same call shape. */
export type QueryFactory = (params: { readonly prompt: AsyncIterable<SDKUserMessage>; readonly options: Options }) => QueryLike

/** What the adapter needs from its plugin. */
export interface ClaudeCodeBackendAdapterOptions {
  /** Routes, environment, and timing resolved from configuration. */
  readonly spec: ClaudeCodeBackendSpec
  /** Starts one SDK query. */
  readonly query: QueryFactory
  /** The shared subprocess service's spawn operation; every CLI process runs under it. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Workspace for the queries of requests that carry no Session and for catalog reads. */
  readonly cwd: string
  /** Resolves the live Agent of a request's Session. */
  readonly agents: Pick<AgentRegistry, 'get'>
  /** Reads the Session's `claudeCodeSession` binding. */
  readonly projections: Pick<SessionProjectionRegistry, 'stateOf'>
  /** The `ctx.approval` service bridged routes ask. */
  readonly approval: BridgeServices['approval']
  /** The `ctx.userQuestions` service bridged routes ask. */
  readonly userQuestions: BridgeServices['userQuestions']
  /** Receives the CLI's stderr text; defaults to the Host process stderr. */
  readonly stderr?: (line: string) => void
}

const toolUseBlock = z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) })
const toolResultBlock = z.object({ type: z.literal('tool_result'), tool_use_id: z.string(), is_error: z.boolean().optional() })
const contentBlocks = z.array(z.unknown())
const commandInput = z.object({ command: z.string() })
const fileInput = z.object({ file_path: z.string().optional(), notebook_path: z.string().optional() })
const searchInput = z.object({ query: z.string() })

interface ToolCall {
  readonly name: string
  readonly input: Record<string, unknown>
}

function toolActivity(call: ToolCall, failed: boolean): ProductActivity {
  const status = failed ? 'failed' : 'completed'
  if (call.name === 'Bash') {
    const parsed = commandInput.safeParse(call.input)
    if (parsed.success) return { kind: 'command', command: parsed.data.command, status }
  }
  if (FILE_CHANGE_TOOLS.has(call.name)) {
    const parsed = fileInput.parse(call.input)
    const path = parsed.file_path ?? parsed.notebook_path
    return { kind: 'file-change', paths: path === undefined ? [] : [path], status }
  }
  if (call.name === 'WebSearch') {
    const parsed = searchInput.safeParse(call.input)
    if (parsed.success) return { kind: 'web-search', query: parsed.data.query, status }
  }
  return { kind: 'tool', name: call.name, status }
}

function tokenUsage(result: SDKResultMessage): TokenUsage {
  return {
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    cacheReadTokens: result.usage.cache_read_input_tokens,
    cacheWriteTokens: result.usage.cache_creation_input_tokens,
  }
}

function statusCode(status: number | null | undefined): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status !== null && status !== undefined && status >= 500) return 'SERVER'
  return 'PRODUCT_ERROR'
}

function resultFailure(result: SDKResultMessage): LlmFailure {
  if (result.subtype === 'success') {
    return {
      message: result.result.length > 0 ? result.result : `${PRODUCT} reported an API error`,
      code: statusCode(result.api_error_status),
    }
  }
  const errors = result.errors.join('; ')
  return { message: errors.length > 0 ? errors : result.subtype, code: RESULT_ERROR_CODES[result.subtype] ?? 'UNKNOWN' }
}

function modelInfo(provider: string, model: Awaited<ReturnType<Query['supportedModels']>>[number]): LlmModelInfo {
  return {
    provider,
    id: model.value,
    name: model.displayName,
    ...model.description === '' ? {} : { description: model.description },
    inputModalities: TEXT_ONLY_MODALITIES,
  }
}

function resolvedModelInfo(provider: string, model: Awaited<ReturnType<Query['supportedModels']>>[number]): LlmResolvedModelInfo {
  const efforts = model.supportedEffortLevels ?? []
  if (efforts.length === 0) return modelInfo(provider, model)
  return {
    ...modelInfo(provider, model),
    reasoning: { efforts: efforts.map(effort => ({ id: ReasoningEffortId(effort), name: effort })) },
  }
}

function abortReason(signal: AbortSignal): Error {
  return thrown(signal.reason)
}

function effortLevel(effort: ReasoningEffortId | undefined): EffortLevel | undefined {
  if (effort === undefined) return undefined
  const level = EFFORT_LEVELS.find(candidate => candidate === effort)
  if (level === undefined) {
    throw new LlmError(`${SOURCE}: reasoning effort ${JSON.stringify(effort)} is not one of ${EFFORT_LEVELS.join(', ')}`, 'INVALID_REQUEST')
  }
  return level
}

/** The CLI's stderr for one query, kept for failure messages and forwarded to the host sink. */
class StderrTail {
  private readonly lines: string[] = []

  constructor(private readonly sink: (line: string) => void) {}

  readonly write = (data: string): void => {
    this.sink(data)
    this.lines.push(...data.split('\n').filter(line => line.trim().length > 0))
    if (this.lines.length > STDERR_TAIL_LINES) this.lines.splice(0, this.lines.length - STDERR_TAIL_LINES)
  }

  /** The retained lines joined, or `undefined` when the CLI wrote nothing. */
  text(): string | undefined {
    return this.lines.length === 0 ? undefined : this.lines.join('\n')
  }
}

/** A prompt stream that delivers one user message and stays open until released, so the query supports control requests. */
function heldPrompt(text: string | undefined): { readonly prompt: AsyncIterable<SDKUserMessage>; readonly release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  async function* prompt(): AsyncGenerator<SDKUserMessage, void> {
    if (text !== undefined) yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    await held
  }
  return { prompt: prompt(), release }
}

function defaultStderr(line: string): void {
  process.stderr.write(line)
}

/**
 * `LlmAdapter` for every route of one Claude Code backend instance. Routes
 * share the model catalog and differ in the permission mode their queries run with.
 */
export class ClaudeCodeBackendAdapter extends LlmAdapter {
  private catalog: Promise<Awaited<ReturnType<Query['supportedModels']>>> | undefined

  constructor(private readonly options: ClaudeCodeBackendAdapterOptions) {
    super()
  }

  /**
   * Name a route after the product, qualified by the route name when it is not the default route.
   * @param provider - a configured route.
   * @returns the route's display metadata.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return providerDisplayInfo(PRODUCT, DEFAULT_ROUTE, provider)
  }

  /**
   * The model catalog the CLI advertises, read once from a short-lived query and kept until a read fails.
   * @param provider - a configured route.
   * @returns every advertised model in CLI order.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return (await this.models()).map(model => modelInfo(provider, model))
  }

  /**
   * Resolve one model against the catalog: catalog entries carry their effort levels, unlisted ids resolve to text-only identity.
   * @param provider - a configured route.
   * @param model - the exact model id or alias.
   * @param _signal - unused; the catalog read is bounded by the CLI's own startup.
   * @returns the model's identity, modalities, and reasoning efforts.
   */
  override async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const found = (await this.models()).find(entry => entry.value === model)
    return found === undefined ? unlistedModelInfo(provider, model) : resolvedModelInfo(provider, found)
  }

  /**
   * Run one Claude Code turn for the request and stream its text, thinking,
   * activity lines, usage, and finish.
   * @param options - the request; `sessionId` selects the bound session, `purpose` or a missing `sessionId` selects an unpersisted query.
   * @returns the chunk stream; every failure ends it with an `error` or `aborted` finish.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return streamProductTurn(options.signal, turn => this.run(options, turn))
  }

  private models(): Promise<Awaited<ReturnType<Query['supportedModels']>>> {
    if (this.catalog !== undefined) return this.catalog
    const reading = this.readCatalog()
    this.catalog = reading
    reading.catch(() => { this.catalog = undefined })
    return reading
  }

  private async readCatalog(): Promise<Awaited<ReturnType<Query['supportedModels']>>> {
    const stderr = new StderrTail(this.options.stderr ?? defaultStderr)
    const held = heldPrompt(undefined)
    const session = this.startQuery(held.prompt, {
      cwd: this.options.cwd,
      persistSession: false,
      permissionMode: 'dontAsk',
      disallowedTools: [ASK_USER_QUESTION_TOOL],
      ...unattendedCallbacks(),
    }, stderr)
    try {
      return await session.query.supportedModels()
    } catch (error: unknown) {
      throw this.transportFailure(thrown(error), stderr)
    } finally {
      held.release()
      await session.close()
    }
  }

  private transportFailure(error: Error, stderr: StderrTail): LlmError {
    const tail = stderr.text()
    return new LlmError(tail === undefined ? error.message : `${error.message}\n${tail}`, TRANSPORT_CODE, { cause: error })
  }

  private startQuery(
    prompt: AsyncIterable<SDKUserMessage>,
    extra: Options,
    stderr: StderrTail,
  ): { readonly query: QueryLike; readonly controller: AbortController; readonly close: () => Promise<void> } {
    const controller = new AbortController()
    let child: SubprocessHandle | undefined
    const query = this.options.query({
      prompt,
      options: {
        abortController: controller,
        env: { ...scrubbedParentEnv(), ...this.options.spec.env },
        supportedDialogKinds: SUPPORTED_UNATTENDED_DIALOG_KINDS,
        stderr: stderr.write,
        spawnClaudeCodeProcess: (spawnOptions) => {
          child = this.options.spawn(claudeSpawnSpec(spawnOptions, this.options.spec.disposeGraceMs))
          return new ManagedClaudeCodeProcess(child)
        },
        ...extra,
      },
    })
    return {
      query,
      controller,
      close: async () => {
        query.close()
        if (child !== undefined) await child.waitForExit()
      },
    }
  }

  private permissionOptions(route: ClaudeCodeRouteSpec, target: ProductTarget, signal: AbortSignal): Options {
    const bridged = route.permissionMode === 'bridge' && target.kind === 'bound'
    const callbacks: ClaudeCodeCallbacks = bridged
      ? createBridgedCallbacks({ agent: target.agent, signal }, this.options)
      : unattendedCallbacks()
    if (route.permissionMode === 'bridge') {
      return { permissionMode: 'default', ...callbacks, ...bridged ? {} : { disallowedTools: [ASK_USER_QUESTION_TOOL] } }
    }
    return {
      permissionMode: route.permissionMode,
      disallowedTools: route.permissionMode === 'plan' ? [ASK_USER_QUESTION_TOOL, 'ExitPlanMode'] : [ASK_USER_QUESTION_TOOL],
      ...route.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {},
      ...callbacks,
    }
  }

  private async run(options: GenerateOptions, turn: ProductTurnStream): Promise<void> {
    const route = routeOf(IDENTITY, this.options.spec.routes, options.provider)
    const input = requireNewUserInput(IDENTITY, options.messages)
    const effort = effortLevel(options.reasoningEffort)
    const signal = options.signal ?? new AbortController().signal
    const target = resolveProductTarget(IDENTITY, options, this.options.agents, this.options.cwd)
    const binding = readBinding(IDENTITY, CLAUDE_CODE_SESSION_PROJECTION_KEY, target, agent =>
      this.options.projections.stateOf(agent.session, CLAUDE_CODE_SESSION_PROJECTION_KEY))
    const stderr = new StderrTail(this.options.stderr ?? defaultStderr)
    const held = heldPrompt(input.join('\n\n'))
    const session = this.startQuery(held.prompt, {
      cwd: target.cwd,
      model: options.model,
      ...effort === undefined ? {} : { effort },
      persistSession: target.kind === 'bound',
      includePartialMessages: true,
      ...binding === null ? {} : { resume: binding.conversationId },
      ...this.permissionOptions(route, target, signal),
    }, stderr)
    try {
      turn.finish(await this.consume(session.query, session.controller, signal, turn, target, binding, options.model, stderr))
    } finally {
      held.release()
      await session.close()
    }
  }

  private async consume(
    query: QueryLike,
    controller: AbortController,
    signal: AbortSignal,
    stream: ProductTurnStream,
    target: ProductTarget,
    binding: ProductConversationBinding | null,
    model: string,
    stderr: StderrTail,
  ): Promise<FinishReason> {
    const { turnIdleTimeoutMs } = this.options.spec
    let idle: ReturnType<typeof setTimeout> | undefined
    let stopCause: Error | undefined
    const stop = (cause: Error): void => {
      stopCause = cause
      controller.abort(cause)
    }
    const onAbort = (): void => { stop(abortReason(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    const pulse = (): void => {
      if (turnIdleTimeoutMs === undefined) return
      clearTimeout(idle)
      idle = setTimeout(() => {
        stop(new LlmError(`${PRODUCT} produced no output for ${String(turnIdleTimeoutMs)} ms`, 'TIMEOUT'))
      }, turnIdleTimeoutMs)
    }
    const tools = new Map<string, ToolCall>()
    let initialized = false
    let streamedText = false
    let result: SDKResultMessage | undefined
    pulse()
    try {
      for await (const message of query) {
        pulse()
        if (message.type === 'system' && message.subtype === 'init') {
          initialized = true
          if (target.kind === 'bound' && binding === null) {
            target.agent.session.append(CLAUDE_CODE_SESSION_EVENT, { conversationId: message.session_id, cwd: target.cwd, model })
            binding = { conversationId: message.session_id, cwd: target.cwd, model }
          }
        } else if (message.type === 'stream_event') {
          if (message.event.type === 'content_block_delta') {
            if (message.event.delta.type === 'text_delta') {
              streamedText = true
              stream.text(message.event.delta.text)
            } else if (message.event.delta.type === 'thinking_delta') {
              stream.reasoning(message.event.delta.thinking)
            }
          }
        } else if (message.type === 'assistant') {
          for (const block of contentBlocks.parse(message.message.content)) {
            const parsed = toolUseBlock.safeParse(block)
            if (parsed.success) tools.set(parsed.data.id, { name: parsed.data.name, input: parsed.data.input })
          }
        } else if (message.type === 'user') {
          const blocks = contentBlocks.safeParse(message.message.content)
          for (const block of blocks.success ? blocks.data : []) {
            const parsed = toolResultBlock.safeParse(block)
            const call = parsed.success ? tools.get(parsed.data.tool_use_id) : undefined
            if (parsed.success && call !== undefined) {
              stream.reasoning(`${activityLine(toolActivity(call, parsed.data.is_error === true))}\n`)
            }
          }
        } else if (message.type === 'result') {
          result = message
          break
        }
      }
    } catch (error: unknown) {
      const cause = thrown(error)
      if (stopCause !== undefined) throw stopCause
      if (!initialized && binding !== null) throw conversationMissing(PRODUCT, binding.conversationId, stderr.text() ?? cause.message)
      throw this.transportFailure(cause, stderr)
    } finally {
      signal.removeEventListener('abort', onAbort)
      clearTimeout(idle)
    }
    if (result === undefined) throw new LlmError(`${PRODUCT} ended the turn without a result`, 'INVALID_RESULT')
    stream.usage(tokenUsage(result))
    if (result.subtype !== 'success' || result.is_error) return { kind: 'error', failure: resultFailure(result) }
    if (!streamedText && result.result.length > 0) stream.text(result.result)
    return { kind: 'stop' }
  }
}
