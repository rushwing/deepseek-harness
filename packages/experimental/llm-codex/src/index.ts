/**
 * Codex conversation backend: LLM provider routes that run each dsh Session's
 * turns on one persistent Codex app-server thread. The plugin owns one lazily
 * started app-server for all of its routes, registers the `codexThread`
 * projection that remembers each Session's thread, and answers Codex approval
 * and user-input requests through `ctx.approval` and `ctx.userQuestions` for
 * `bridge` routes.
 *
 * @module @deepseek-ai/dsh-experimental-llm-codex
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { CodexBackendAdapter } from './adapter.ts'
import { ThreadRegistry, createServerRequestHandler } from './bridge.ts'
import { Config, resolveCodexBackendSpec } from './config.ts'
import { codexThreadProjection } from './events.ts'
import { CodexAppServerHost } from './host.ts'

export const name = 'llm-codex'
export const inject = ['llm', 'agents', 'subprocess', 'sessionProjections', 'approval', 'userQuestions']

export { Config, resolveCodexBackendSpec, type CodexBackendSpec, type CodexRouteSpec, type CodexRoutePermissionMode } from './config.ts'
export { CodexAppServerHost, type CodexAppServerHostOptions } from './host.ts'
export {
  ThreadRegistry,
  createServerRequestHandler,
  type BridgeServices,
  type LiveThread,
} from './bridge.ts'
export { CodexBackendAdapter, type CodexBackendAdapterOptions } from './adapter.ts'
export { CODEX_THREAD_EVENT, CODEX_THREAD_PROJECTION_KEY, codexThreadProjection } from './events.ts'

/**
 * Mount the backend: resolve the routes, prepare the app-server owner, and
 * register the projection and the adapter for every route. Disposal releases
 * the routes and projection and terminates the app-server.
 * @param ctx - context carrying the LLM, agent, subprocess, projection, approval, and user-question services.
 * @param config - routes, environment, and timing; the schema fills the defaults and the resolution rejects invalid values at load.
 */
export function apply(ctx: Context, config: Config): void {
  const spec = resolveCodexBackendSpec(config)
  const threads = new ThreadRegistry()
  const host = new CodexAppServerHost({
    spawn: spawnSpec => ctx.subprocess.spawn(spawnSpec),
    cwd: process.cwd(),
    env: spec.env,
    disposeGraceMs: spec.disposeGraceMs,
    handler: createServerRequestHandler(threads, {
      approval: ctx.approval,
      userQuestions: ctx.userQuestions,
    }),
  })
  const adapter = new CodexBackendAdapter({
    spec,
    host,
    threads,
    cwd: process.cwd(),
    agents: ctx.agents,
    projections: ctx.sessionProjections,
  })
  ctx.effect(() => {
    const unregisterProjection = ctx.sessionProjections.register(codexThreadProjection)
    const unregisterRoutes = ctx.llm.registerAdapter([...spec.routes.keys()], adapter)
    return async () => {
      unregisterRoutes()
      unregisterProjection()
      await host.dispose()
    }
  })
}
