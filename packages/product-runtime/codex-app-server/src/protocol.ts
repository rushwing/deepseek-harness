/**
 * Protocol facts shared by every Codex app-server client in the harness:
 * JSON frame validation, the unattended approval decision, coarse
 * classification of a failed turn, and the abort race every guarded request
 * uses.
 *
 * @module @deepseek-ai/dsh-codex-app-server/protocol
 */

import type { Readable, Writable } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { CodexThreadPermissionParams } from './permission.ts'

/** A decoded JSON-RPC params or result object. */
export type JsonObject = Record<string, unknown>

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed protocol and stream failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/** What a client supplies to {@link connectTransport}. */
export interface TransportHooks {
  /** Answers server-initiated requests; a rejection becomes a JSON-RPC error response. */
  readonly request: (method: string, params: JsonObject) => Promise<unknown>
  /** Handles one notification; a thrown error is reported through `fatal`. */
  readonly notification: (method: string, params: JsonObject) => void
  /** Receives every fatal fact: a notification handler failure, a stream error, or the stream ending. */
  readonly fatal: (error: Error) => void
  /** Runs when the input stream ends, before `fatal` receives the closure error. */
  readonly ended?: () => void
}

/** The transport plus the one listener a client detaches when it closes deliberately. */
export interface ConnectedTransport {
  readonly transport: JsonRpcLineTransport
  /** Stop treating the input stream's end as a fatal fact. */
  readonly detachEnd: () => void
}

/**
 * Create the line transport over the app-server's streams and wire the
 * client's request, notification, and failure handling to it. The caller
 * still calls `transport.start()`.
 * @param input - the app-server's stdout.
 * @param output - the app-server's stdin.
 * @param hooks - the client's handlers.
 * @param source - client name prefixed to the stream-closure error.
 * @returns the transport and the end-listener disposer.
 */
export function connectTransport(
  input: Readable,
  output: Writable,
  hooks: TransportHooks,
  source = 'codex app-server',
): ConnectedTransport {
  const transport = new JsonRpcLineTransport(input, output)
  transport.onRequest(hooks.request)
  transport.onNotification((method, params) => {
    try {
      hooks.notification(method, params)
    } catch (error: unknown) {
      hooks.fatal(thrown(error))
    }
  })
  const onInputEnd = (): void => {
    hooks.ended?.()
    hooks.fatal(new Error(`${source}: app-server protocol stream closed`))
  }
  input.on('error', hooks.fatal)
  input.on('end', onInputEnd)
  // Pipe errors can race protocol closure and process teardown. Retain both
  // error listeners for the lifetime of their streams so no late EPIPE or
  // read failure becomes an unhandled EventEmitter error.
  output.on('error', hooks.fatal)
  return {
    transport,
    detachEnd: () => { input.off('end', onInputEnd) },
  }
}

/** Wraps one protocol promise with the caller's fatal-state and cancellation race. */
export type ProtocolGuard = <T>(pending: Promise<T>) => Promise<T>

/** The fixed client identity and capabilities every harness client declares. */
export const INITIALIZE_PARAMS: JsonObject = {
  clientInfo: {
    name: 'deepseek-harness',
    title: 'DeepSeek Harness',
    version: '0.0.1',
  },
  capabilities: {
    experimentalApi: false,
    requestAttestation: false,
  },
}

/**
 * Perform the required `initialize` request and `initialized` notification.
 * @param transport - the line transport to the app-server.
 * @param guard - the caller's guarded await for protocol promises.
 * @param signal - cancellation of the handshake requests.
 * @param source - client name prefixed to validation failures.
 */
export async function initializeHandshake(
  transport: JsonRpcLineTransport,
  guard: ProtocolGuard,
  signal: AbortSignal,
  source = 'codex app-server',
): Promise<void> {
  expectObject(await guard(transport.request('initialize', INITIALIZE_PARAMS, signal)), 'initialize response', source)
  transport.notify('initialized')
  await guard(transport.flush())
}

/** The fields every `thread/start` sends. */
export interface ThreadStartFields {
  /** Workspace the thread works in. */
  readonly cwd: string
  /** The approval, reviewer, and sandbox fields the thread runs under. */
  readonly permission: CodexThreadPermissionParams
  /** Model fixed for the thread; omission leaves native Codex settings in force. */
  readonly model?: string | undefined
  /** Whether Codex should skip persisting the thread. */
  readonly ephemeral: boolean
}

/** The thread facts a `thread/start` response reports. */
export interface StartedThread {
  readonly id: string
  readonly ephemeral: boolean
}

/**
 * Send one `thread/start` and validate the thread it returns.
 * @param transport - the line transport to the app-server.
 * @param guard - the caller's guarded await for protocol promises.
 * @param fields - workspace, mode, optional model, and persistence.
 * @param signal - cancellation of the request.
 * @param source - client name prefixed to validation failures.
 * @returns the created thread's id and whether Codex marked it ephemeral.
 */
export async function startThreadRequest(
  transport: JsonRpcLineTransport,
  guard: ProtocolGuard,
  fields: ThreadStartFields,
  signal: AbortSignal,
  source = 'codex app-server',
): Promise<StartedThread> {
  const response = expectObject(await guard(transport.request('thread/start', {
    cwd: fields.cwd,
    ephemeral: fields.ephemeral,
    ...fields.model === undefined ? {} : { model: fields.model },
    ...fields.permission,
  }, signal)), 'thread/start response', source)
  const thread = expectObject(response.thread, 'thread/start thread', source)
  return {
    id: expectString(thread.id, 'thread/start thread id', source),
    ephemeral: thread.ephemeral === true,
  }
}

/**
 * Require an app-server value to be a JSON object.
 * @param value - decoded frame member.
 * @param label - what the member is, for the failure message.
 * @param source - client name prefixed to the failure message.
 * @returns the same value, narrowed.
 */
export function expectObject(value: unknown, label: string, source = 'codex app-server'): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source}: app-server returned invalid ${label}`)
  }
  return value as JsonObject
}

/**
 * Require an app-server value to be a non-empty string.
 * @param value - decoded frame member.
 * @param label - what the member is, for the failure message.
 * @param source - client name prefixed to the failure message.
 * @returns the same value, narrowed.
 */
export function expectString(value: unknown, label: string, source = 'codex app-server'): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${source}: app-server returned invalid ${label}`)
  }
  return value
}

/**
 * The decision an unattended client returns to a command or file-change
 * approval request: `cancel` when offered, else `decline`.
 * @param params - the approval request params carrying `availableDecisions`.
 * @param source - client name prefixed to the failure message.
 * @returns the non-approving decision to send back.
 * @throws when the request offers a decision list with neither option.
 */
export function unattendedDecision(params: JsonObject, source = 'codex app-server'): 'cancel' | 'decline' {
  const available = params.availableDecisions
  if (available === undefined || available === null) return 'decline'
  if (Array.isArray(available)) {
    if (available.includes('cancel')) return 'cancel'
    if (available.includes('decline')) return 'decline'
  }
  throw new Error(`${source}: app-server offered no unattended approval decision`)
}

/** Coarse failure class of a Codex turn, safe to expose outside the product. */
export type CodexTurnFailureCategory =
  | 'limit'
  | 'access-policy'
  | 'service'
  | 'transport'
  | 'product-error'
  | 'invalid-result'
  | 'unknown'

/** What a failed `turn/completed` notification says about the failure. */
export interface CodexTurnFailureInfo {
  readonly category: CodexTurnFailureCategory
  /** Numeric HTTP status retained for connection and stream failures. */
  readonly httpStatus?: number | undefined
  /** The model context window was exhausted. */
  readonly maxTokens?: true
  /** The sandbox rejected the product's action. */
  readonly sandboxFailure?: true
}

function numericHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 65_535
    ? value
    : undefined
}

function objectFailureInfo(value: JsonObject): CodexTurnFailureInfo {
  const keys = Object.keys(value)
  const category = keys[0]
  if (keys.length !== 1 || category === undefined) {
    return { category: 'unknown' }
  }
  const detail = value[category]
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return { category: 'unknown' }
  }
  const fields = detail as JsonObject
  switch (category) {
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
    {
      const httpStatus = numericHttpStatus(fields.httpStatusCode)
      return httpStatus === undefined
        ? { category: 'transport' }
        : { category: 'transport', httpStatus }
    }
    case 'activeTurnNotSteerable':
      return { category: 'product-error' }
    default:
      return { category: 'unknown' }
  }
}

/**
 * Classify a terminal turn by its official `codexErrorInfo`.
 * @param turn - the `turn` object from `turn/completed`.
 * @returns the coarse category plus HTTP status, context-window, and sandbox facts when present.
 */
export function turnFailureInfo(turn: JsonObject): CodexTurnFailureInfo {
  if (turn.status !== 'failed') return { category: 'unknown' }
  const error = turn.error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) {
    return { category: 'unknown' }
  }
  const info = (error as JsonObject).codexErrorInfo
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
        return { category: 'limit', maxTokens: true }
      case 'sessionBudgetExceeded':
      case 'usageLimitExceeded':
        return { category: 'limit' }
      case 'serverOverloaded':
      case 'internalServerError':
        return { category: 'service' }
      case 'cyberPolicy':
      case 'misalignmentPolicyViolation':
      case 'unauthorized':
        return { category: 'access-policy' }
      case 'badRequest':
      case 'threadRollbackFailed':
      case 'other':
        return { category: 'product-error' }
      case 'sandboxError':
        return { category: 'access-policy', sandboxFailure: true }
      default:
        return { category: 'unknown' }
    }
  }
  return info !== null && typeof info === 'object' && !Array.isArray(info)
    ? objectFailureInfo(info as JsonObject)
    : { category: 'unknown' }
}

/**
 * Normalize an abort reason into the rejection error.
 * @param signal - the aborted signal.
 * @param source - client name prefixed to a synthesized message.
 * @returns the signal's Error reason, or a new Error naming the reason.
 */
export function abortError(signal: AbortSignal, source = 'codex app-server'): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`${source}: app-server request aborted: ${String(signal.reason)}`)
}

/**
 * Race a pending protocol operation against caller cancellation.
 * @param pending - the protocol promise.
 * @param signal - cancellation; an already-aborted signal rejects immediately.
 * @param source - client name prefixed to a synthesized abort message.
 * @returns the pending value, or rejects with the abort error.
 */
export async function raceAbort<T>(pending: Promise<T>, signal: AbortSignal, source = 'codex app-server'): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {})
    throw abortError(signal, source)
  }
  let rejectAbort!: (error: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => { rejectAbort(abortError(signal, source)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
