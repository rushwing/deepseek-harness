/**
 * Lifecycle model fallback: when a model request of a lifecycle role child
 * fails with a hop-worthy code, the child moves to the next route of its
 * registry entry (its `fallbacks`, in order) and the step is retried under
 * the same uid. Its error listener is prepended and delegates first, so
 * `llm-retry` and every other recovery policy decide before it, whatever the
 * activation order; it acts only on a failure they all left terminal. Other
 * agents are untouched.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-model-fallback
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { loadAgentRegistry, loadLifecycleTable, type AgentRoute } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-subagent'

/** Plugin name. */
export const name = 'lifecycle-model-fallback'

/** Injected services: the runtime that answers which efforts a route advertises, and the projections that carry a child's label. */
export const inject = ['llm', 'sessionProjections']

/** Resolved configuration. */
export interface Config {
  /** The lifecycle directory relative to the child's Session working directory. */
  lifecycleDir: string
  /** Failure codes that move the child to its next route; other codes stay terminal. */
  hopOnCodes: string[]
  /** The most route switches one child makes. */
  maxHops: number
}

/** Schemastery configuration. */
export const Config = z.object({
  lifecycleDir: z.string().default('lifecycle'),
  hopOnCodes: z.array(z.string()).default(['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE']),
  maxHops: z.number().step(1).min(0).default(2),
})

/** The routes one lifecycle role child may use, and where it stands. */
export interface RoutePlan {
  readonly uid: string
  /** The registry route first, then its fallbacks in order. */
  readonly routes: readonly AgentRoute[]
  /** Route switches taken so far. */
  hops: number
  /** The route the next request uses. */
  route: AgentRoute
}

const LABEL = /^lifecycle:([^@:]+)@[^:]+:.+$/
const TABLE_FILE = 'lifecycle.yml'
const REGISTRY_FILE = 'agent-registry.yml'

/**
 * The uid in a driver label `lifecycle:<uid>@<state>:<REQ>`.
 * @param label - the subagent label, if any.
 * @returns the uid, or `undefined` for any other label.
 */
export function uidOfLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined
  const match = LABEL.exec(label)
  return match === null ? undefined : match[1]
}

function readOptional(cwd: string, dir: string, file: string): string {
  const path = join(cwd, ...dir.split('/'), file)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/**
 * The route plan of a lifecycle role child: its registry route followed by
 * its fallbacks, read from the tables in the child's workspace.
 * @param ctx - the plugin context, whose `subagent` projection carries the child's label.
 * @param agent - the agent whose Session carries the subagent descriptor.
 * @param dir - the lifecycle directory relative to the Session working directory.
 * @returns the plan, or `undefined` when the agent is not a lifecycle role child, its workspace has no loadable
 * tables, or its uid has no route.
 */
export function planFor(ctx: Context, agent: Agent, dir: string): RoutePlan | undefined {
  const uid = uidOfLabel(ctx.sessionProjections.stateOf(agent.session, 'subagent')?.identity?.label)
  const cwd = agent.session.header.cwd
  if (uid === undefined || cwd === undefined) return undefined
  const { table } = loadLifecycleTable(readOptional(cwd, dir, TABLE_FILE))
  if (table === undefined) return undefined
  const { registry } = loadAgentRegistry(readOptional(cwd, dir, REGISTRY_FILE), table)
  const entry = registry?.agents.find(candidate => String(candidate.uid) === uid)
  if (entry?.route === undefined) return undefined
  const route = entry.route
  const fallbacks = entry.fallbacks.map(fallback => ({ provider: fallback.provider, model: fallback.model }))
  return { uid, routes: [route, ...fallbacks], hops: 0, route }
}

/**
 * The effort to request on a route: the current one when the route's model
 * advertises it, else none (the adapter default applies).
 * @param ctx - the plugin context.
 * @param route - the route about to serve the request.
 * @param effort - the effort of the request as configured.
 * @returns the effort to keep, or `undefined` to drop it.
 * @throws whatever the runtime throws when the route's model does not resolve.
 */
export async function effortOn(
  ctx: Context, route: AgentRoute, effort: ReasoningEffortId | undefined,
): Promise<ReasoningEffortId | undefined> {
  if (effort === undefined) return undefined
  const info = await ctx.llm.resolveModelInfo(route.provider, route.model)
  return info.reasoning?.efforts.some(candidate => candidate.id === effort) === true ? effort : undefined
}

/**
 * Install the two waterfall listeners.
 * @param ctx - the plugin context.
 * @param config - the resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const plans = new WeakMap<Agent, RoutePlan | null>()
  const planOf = (agent: Agent): RoutePlan | null => {
    const known = plans.get(agent)
    if (known !== undefined) return known
    const plan = planFor(ctx, agent, config.lifecycleDir) ?? null
    plans.set(agent, plan)
    return plan
  }

  ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
    const requested = await next()
    const plan = planOf(payload.agent)
    if (plan === null || plan.hops === 0) return requested
    const { reasoningEffort, ...rest } = requested
    const effort = await effortOn(ctx, plan.route, reasoningEffort)
    return { ...rest, provider: plan.route.provider, model: plan.route.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
  })

  // Prepended so that every other recovery policy (llm-retry's same-route
  // retries first among them) decides first, whatever the activation order;
  // the fallback acts only on a failure they all left terminal.
  ctx.on('agent/request-error', async (payload, next) => {
    const downstream = await next()
    if (downstream !== undefined) return downstream
    const plan = planOf(payload.agent)
    if (plan === null || !config.hopOnCodes.includes(payload.failure.code) || plan.hops >= config.maxHops) return undefined
    const route = plan.routes[plan.hops + 1]
    if (route === undefined) return undefined
    plan.hops += 1
    plan.route = route
    return { kind: 'retry' }
  }, { prepend: true })
}
