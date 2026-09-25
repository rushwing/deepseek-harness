/**
 * The request-side skeleton every conversation backend adapter shares: route
 * lookup, the new-input requirement, the bound-or-ephemeral target of a
 * request, the Session binding checks, provider display names, and the
 * failure-to-finish conversion around one turn.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/backend
 */

import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import {
  LlmError,
  type FinishReason,
  type GenerateOptions,
  type LlmFailure,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type ModelModality,
  type RequestMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ProductConversationBinding } from './binding.ts'
import { isEphemeralRequest, newUserInput } from './input.ts'
import { ProductTurnStream } from './stream.ts'

/** Failure code for a turn the caller cancelled. */
export const ABORTED_CODE = 'ABORTED'

/** The request modalities every conversation backend route declares: the runtime projects images to text. */
export const TEXT_ONLY_MODALITIES: readonly ModelModality[] = ['text']

/** Names one backend in failure messages. */
export interface BackendIdentity {
  /** Plugin name prefixed to failure messages, for example `llm-codex`. */
  readonly source: string
  /** Product name shown to the user, for example `Codex`. */
  readonly product: string
}

/** Where a request's turn runs: the Session's bound product conversation, or a throwaway one. */
export type ProductTarget =
  | {
    readonly kind: 'bound'
    /** The live Agent whose Session owns the conversation. */
    readonly agent: Agent
    /** The Session workspace. */
    readonly cwd: string
  }
  | {
    readonly kind: 'ephemeral'
    /** The workspace the throwaway conversation runs in. */
    readonly cwd: string
  }

/**
 * Normalize a thrown value into an Error.
 * @param error - whatever was thrown.
 * @returns the value itself when it is an Error, else an Error naming it.
 */
export function thrown(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Name a route after the product, qualified by the route name when it is not the default route.
 * @param product - product name, for example `Codex`.
 * @param defaultRoute - the route whose display name is the bare product name.
 * @param provider - the route being described.
 * @returns the route's display metadata.
 */
export function providerDisplayInfo(product: string, defaultRoute: string, provider: string): LlmProviderInfo {
  return { id: provider, name: provider === defaultRoute ? product : `${product} (${provider})` }
}

/**
 * The identity a backend resolves for a model id its catalog does not list: core routing still accepts it.
 * @param provider - the route being resolved.
 * @param model - the exact model id the request named.
 * @returns text-only model metadata named after the id.
 */
export function unlistedModelInfo(provider: string, model: string): LlmResolvedModelInfo {
  return { provider, id: model, name: model, inputModalities: TEXT_ONLY_MODALITIES }
}

/**
 * Look up the route a request selected.
 * @param identity - the backend's names.
 * @param routes - the configured routes.
 * @param provider - the route the request names.
 * @returns the route's spec.
 * @throws `LlmError` with code `NO_ROUTE` when the route is not configured.
 */
export function routeOf<R>(identity: BackendIdentity, routes: ReadonlyMap<string, R>, provider: string): R {
  const route = routes.get(provider)
  if (route === undefined) throw new LlmError(`${identity.source}: route ${JSON.stringify(provider)} is not configured`, 'NO_ROUTE')
  return route
}

/**
 * The trailing user input a turn sends, which must not be empty.
 * @param identity - the backend's names.
 * @param messages - the request messages.
 * @returns the new user texts in order.
 * @throws `LlmError` with code `EMPTY_REQUEST` when the request carries no new user text.
 */
export function requireNewUserInput(identity: BackendIdentity, messages: readonly RequestMessage[]): string[] {
  const input = newUserInput(messages)
  if (input.length === 0) {
    throw new LlmError(`${identity.source}: the request carries no new user input for ${identity.product}`, 'EMPTY_REQUEST')
  }
  return input
}

/**
 * Decide where a request runs. Auxiliary requests (`purpose` set), requests
 * without a Session, and requests the agent loop did not build run on an
 * ephemeral conversation in the Agent's workspace, or in `fallbackCwd` when
 * there is no Agent. Everything else runs on the Session's bound conversation.
 * @param identity - the backend's names.
 * @param options - the request.
 * @param agents - resolves the live Agent of the request's Session.
 * @param fallbackCwd - workspace for ephemeral conversations of requests without an Agent.
 * @returns the bound or ephemeral target.
 * @throws `LlmError` with code `NO_LIVE_AGENT` when a bound request's Session has no live Agent,
 *   or `NO_WORKSPACE` when its Session has no `cwd`.
 */
export function resolveProductTarget(
  identity: BackendIdentity,
  options: GenerateOptions,
  agents: Pick<AgentRegistry, 'get'>,
  fallbackCwd: string,
): ProductTarget {
  const agent = options.sessionId === undefined ? undefined : agents.get(options.sessionId)
  if (isEphemeralRequest(options)) {
    const cwd = agent === undefined ? undefined : agent.session.header.cwd
    return { kind: 'ephemeral', cwd: cwd ?? fallbackCwd }
  }
  if (agent === undefined) {
    throw new LlmError(
      `${identity.source}: Session ${JSON.stringify(options.sessionId)} has no live Agent to run a ${identity.product} turn for`,
      'NO_LIVE_AGENT',
    )
  }
  const cwd = agent.session.header.cwd
  if (cwd === undefined) {
    throw new LlmError(
      `${identity.source}: Session ${JSON.stringify(agent.id)} has no workspace; ${identity.product} needs one to start a conversation`,
      'NO_WORKSPACE',
    )
  }
  return { kind: 'bound', agent, cwd }
}

/**
 * Read a bound target's Session binding and check it against the workspace.
 * @param identity - the backend's names.
 * @param projectionKey - the backend's projection key, named in the missing-projection failure.
 * @param target - the request target; an ephemeral target has no binding.
 * @param read - reads the projection state for the Agent's Session; `undefined` means the projection is not registered.
 * @returns the binding, or `null` when the Session is unbound or the target is ephemeral.
 * @throws `LlmError` with code `PROJECTION_MISSING` when the projection is not registered,
 *   or `WORKSPACE_MISMATCH` when the binding's workspace differs from the Session's.
 */
export function readBinding(
  identity: BackendIdentity,
  projectionKey: string,
  target: ProductTarget,
  read: (agent: Agent) => ProductConversationBinding | null | undefined,
): ProductConversationBinding | null {
  if (target.kind === 'ephemeral') return null
  const binding = read(target.agent)
  if (binding === undefined) {
    throw new LlmError(`${identity.source}: the ${projectionKey} projection is not registered`, 'PROJECTION_MISSING')
  }
  if (binding !== null && binding.cwd !== target.cwd) {
    throw new LlmError(
      `${identity.source}: this Session's ${identity.product} conversation was created in ${binding.cwd} but the Session workspace is now ${target.cwd}`,
      'WORKSPACE_MISMATCH',
    )
  }
  return binding
}

/**
 * Convert a turn failure into the terminal finish reason.
 * @param error - whatever the turn threw.
 * @param signal - the request's cancellation; an aborted signal makes the finish `aborted`.
 * @returns an `aborted` finish when the caller cancelled, else an `error` finish carrying the `LlmError` facts or an `UNKNOWN` code.
 */
export function finishForFailure(error: unknown, signal: AbortSignal | undefined): FinishReason {
  const cause = thrown(error)
  if (signal?.aborted === true) {
    return { kind: 'aborted', failure: { message: cause.message, code: ABORTED_CODE } }
  }
  const failure: LlmFailure = cause instanceof LlmError ? cause.failure : { message: cause.message, code: 'UNKNOWN' }
  return { kind: 'error', failure }
}

/**
 * Run one product turn behind a chunk stream: `run` fills the stream and
 * finishes it; a rejection finishes the stream through {@link finishForFailure}.
 * @param signal - the request's cancellation.
 * @param run - the adapter's turn, which must call `turn.finish()` itself on success.
 * @returns the chunk stream for `LlmAdapter.stream()`.
 */
export function streamProductTurn(
  signal: AbortSignal | undefined,
  run: (turn: ProductTurnStream) => Promise<void>,
): AsyncIterable<StreamChunk> {
  const turn = new ProductTurnStream()
  void run(turn).catch((error: unknown) => {
    turn.finish(finishForFailure(error, signal))
  })
  return turn.chunks()
}
