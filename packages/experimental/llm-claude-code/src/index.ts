/**
 * Claude Code conversation backend: LLM provider routes that run each dsh
 * Session's turns on one persistent Claude Code session through the official
 * Agent SDK. The plugin registers the `claudeCodeSession` projection that
 * remembers each Session's Claude Code session, runs every turn as one SDK
 * query under the subprocess seam, and answers Claude Code permission and
 * question requests through `ctx.approval` and `ctx.userQuestions` for
 * `bridge` routes.
 *
 * @module @deepseek-ai/dsh-experimental-llm-claude-code
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { query } from '@deepseek-ai/dsh-claude-agent-sdk'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { ClaudeCodeBackendAdapter } from './adapter.ts'
import { Config, resolveClaudeCodeBackendSpec } from './config.ts'
import { claudeCodeSessionProjection } from './events.ts'

export const name = 'llm-claude-code'
export const inject = ['llm', 'agents', 'subprocess', 'sessionProjections', 'approval', 'userQuestions']

export {
  Config,
  resolveClaudeCodeBackendSpec,
  type ClaudeCodeBackendSpec,
  type ClaudeCodeRoutePermissionMode,
  type ClaudeCodeRouteSpec,
} from './config.ts'
export {
  ASK_USER_QUESTION_TOOL,
  createBridgedCallbacks,
  unattendedCallbacks,
  type BridgeServices,
  type ClaudeCodeCallbacks,
  type LiveTurn,
} from './bridge.ts'
export {
  ClaudeCodeBackendAdapter,
  type ClaudeCodeBackendAdapterOptions,
  type QueryFactory,
  type QueryLike,
} from './adapter.ts'
export {
  CLAUDE_CODE_SESSION_EVENT,
  CLAUDE_CODE_SESSION_PROJECTION_KEY,
  claudeCodeSessionProjection,
} from './events.ts'

/**
 * Mount the backend: resolve the routes, build the adapter over the official
 * SDK and the subprocess seam, and register the projection and every route.
 * Disposal releases the routes and the projection; each turn's CLI process is
 * released when its query closes.
 * @param ctx - context carrying the LLM, agent, subprocess, projection, approval, and user-question services.
 * @param config - routes, environment, and timing; the schema fills the defaults and the resolution rejects invalid values at load.
 */
export function apply(ctx: Context, config: Config): void {
  const spec = resolveClaudeCodeBackendSpec(config)
  const adapter = new ClaudeCodeBackendAdapter({
    spec,
    query,
    spawn: spawnSpec => ctx.subprocess.spawn(spawnSpec),
    cwd: process.cwd(),
    agents: ctx.agents,
    projections: ctx.sessionProjections,
    approval: ctx.approval,
    userQuestions: ctx.userQuestions,
  })
  ctx.effect(() => {
    const unregisterProjection = ctx.sessionProjections.register(claudeCodeSessionProjection)
    const unregisterRoutes = ctx.llm.registerAdapter([...spec.routes.keys()], adapter)
    return () => {
      unregisterRoutes()
      unregisterProjection()
    }
  })
}
