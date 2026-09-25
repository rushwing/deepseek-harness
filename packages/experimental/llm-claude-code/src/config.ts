/**
 * Deployment configuration for the Claude Code backend and its explicit
 * resolution into the spec the plugin runs with.
 *
 * @module @deepseek-ai/dsh-experimental-llm-claude-code/config
 */

import z from '@deepseek-ai/schemastery'
import { CLAUDE_CODE_PERMISSION_MODES, type ClaudeCodePermissionMode } from '@deepseek-ai/dsh-claude-agent-sdk'
import { resolveBackendSpec, type BackendSpec, type ResolvedRoute } from '@deepseek-ai/dsh-experimental-llm-product-backend'

const SOURCE = 'llm-claude-code'

/** Default grace between termination tiers when a turn's Claude Code process is released. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** The route Claude Code mounts on when the configuration names none. */
export const DEFAULT_ROUTE = 'claude-code'

/**
 * How a route answers Claude Code permission and question requests: `bridge`
 * runs the SDK's `default` mode and routes them to the harness approval and
 * user-question services; the native modes keep Claude Code's own unattended
 * behavior.
 */
export type ClaudeCodeRoutePermissionMode = ClaudeCodePermissionMode | 'bridge'

/** Every selectable route permission mode. */
export const CLAUDE_CODE_ROUTE_PERMISSION_MODES = [
  ...CLAUDE_CODE_PERMISSION_MODES,
  'bridge',
] as const satisfies readonly ClaudeCodeRoutePermissionMode[]

/* jscpd:ignore-start -- the config catalog reads each plugin's literal schema, so the
 * parallel backend configurations stay spelled out per package. */
/** One provider route this plugin instance serves. */
export interface RouteConfig {
  /** Permission behavior for sessions driven through this route (default `bridge`). */
  permissionMode?: ClaudeCodeRoutePermissionMode
}

/** Deployment-owned routes, environment, and process-release settings. */
export interface Config {
  /**
   * Provider routes keyed by the name a request selects with
   * `GenerateOptions.provider`. Defaults to one bridged `claude-code` route.
   */
  routes?: Record<string, RouteConfig>
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment, for example `CLAUDE_CONFIG_DIR`.
   */
  env?: Record<string, string>
  /** Grace in milliseconds between termination tiers when a turn's process is released. */
  disposeGraceMs?: number
  /** Fail a turn that produces no SDK message for this long; omission leaves turns unbounded. */
  turnIdleTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  routes: z.dict(z.object({
    permissionMode: z.union([...CLAUDE_CODE_ROUTE_PERMISSION_MODES]).default('bridge'),
  })).default({ [DEFAULT_ROUTE]: {} }),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  turnIdleTimeoutMs: z.number(),
})
/* jscpd:ignore-end */

/** One resolved route. */
export type ClaudeCodeRouteSpec = ResolvedRoute<ClaudeCodeRoutePermissionMode>

/** The fully resolved plugin inputs. */
export type ClaudeCodeBackendSpec = BackendSpec<ClaudeCodeRoutePermissionMode>

/**
 * Resolve validated configuration into the spec the plugin runs with.
 * @param config - schema-validated plugin configuration.
 * @returns the routes with explicit permission modes and the process settings.
 * @throws when no route is configured, a route name is empty, or a duration is invalid.
 */
export function resolveClaudeCodeBackendSpec(config: Config): ClaudeCodeBackendSpec {
  return resolveBackendSpec(SOURCE, config)
}
