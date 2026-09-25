/**
 * Deployment configuration for the Codex backend and its explicit resolution
 * into the spec the plugin runs with.
 *
 * @module @deepseek-ai/dsh-experimental-llm-codex/config
 */

import z from '@deepseek-ai/schemastery'
import { CODEX_PERMISSION_MODES, type CodexPermissionMode } from '@deepseek-ai/dsh-codex-app-server'
import { resolveBackendSpec, type BackendSpec, type ResolvedRoute } from '@deepseek-ai/dsh-experimental-llm-product-backend'

const SOURCE = 'llm-codex'

/** Default grace between termination tiers when the plugin disposes its app-server. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** The route Codex mounts on when the configuration names none. */
export const DEFAULT_ROUTE = 'codex'

/**
 * How a route answers Codex approval and user-input requests: `bridge` routes
 * them to the harness approval and user-question services; the native modes
 * keep Codex's own unattended behavior.
 */
export type CodexRoutePermissionMode = CodexPermissionMode | 'bridge'

/** Every selectable route permission mode. */
export const CODEX_ROUTE_PERMISSION_MODES = [
  ...CODEX_PERMISSION_MODES,
  'bridge',
] as const satisfies readonly CodexRoutePermissionMode[]

/* jscpd:ignore-start -- the config catalog reads each plugin's literal schema, so the
 * parallel backend configurations stay spelled out per package. */
/** One provider route this plugin instance serves. */
export interface RouteConfig {
  /** Approval behavior for threads created through this route (default `bridge`). */
  permissionMode?: CodexRoutePermissionMode
}

/** Deployment-owned routes, environment, and process-release settings. */
export interface Config {
  /**
   * Provider routes keyed by the name a request selects with
   * `GenerateOptions.provider`; every route shares one app-server. Defaults to
   * one bridged `codex` route.
   */
  routes?: Record<string, RouteConfig>
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment, for example `CODEX_HOME`.
   */
  env?: Record<string, string>
  /** Grace in milliseconds between app-server termination tiers on disposal. */
  disposeGraceMs?: number
  /** Fail a turn that produces no notification for this long; omission leaves turns unbounded. */
  turnIdleTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  routes: z.dict(z.object({
    permissionMode: z.union([...CODEX_ROUTE_PERMISSION_MODES]).default('bridge'),
  })).default({ [DEFAULT_ROUTE]: {} }),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  turnIdleTimeoutMs: z.number(),
})
/* jscpd:ignore-end */

/** One resolved route. */
export type CodexRouteSpec = ResolvedRoute<CodexRoutePermissionMode>

/** The fully resolved plugin inputs. */
export type CodexBackendSpec = BackendSpec<CodexRoutePermissionMode>

/**
 * Resolve validated configuration into the spec the plugin runs with.
 * @param config - schema-validated plugin configuration.
 * @returns the routes with explicit permission modes and the process settings.
 * @throws when no route is configured, a route name is empty, or a duration is invalid.
 */
export function resolveCodexBackendSpec(config: Config): CodexBackendSpec {
  return resolveBackendSpec(SOURCE, config)
}
