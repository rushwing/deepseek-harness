/**
 * Deployment configuration for the Codex backend and its explicit resolution
 * into the spec the plugin runs with.
 *
 * @module @deepseek-ai/dsh-experimental-llm-codex/config
 */

import z from '@deepseek-ai/schemastery'
import { CODEX_PERMISSION_MODES, type CodexPermissionMode } from '@deepseek-ai/dsh-codex-app-server'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

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

/** One resolved route. */
export interface CodexRouteSpec {
  readonly permissionMode: CodexRoutePermissionMode
}

/** The fully resolved plugin inputs. */
export interface CodexBackendSpec {
  /** Routes in configuration order, each with its resolved permission mode. */
  readonly routes: ReadonlyMap<string, CodexRouteSpec>
  readonly env: Readonly<Record<string, string>>
  readonly disposeGraceMs: number
  readonly turnIdleTimeoutMs: number | undefined
}

function assertPositiveFinite(field: string, value: number, max = Number.POSITIVE_INFINITY): void {
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(`llm-codex: ${field} must be a positive finite number no greater than ${max}`)
  }
}

/**
 * Resolve validated configuration into the spec the plugin runs with. The
 * schema has already filled every default, so the resolution only checks
 * what the schema cannot express.
 * @param config - schema-validated plugin configuration.
 * @returns the routes with explicit permission modes and the process settings.
 * @throws when no route is configured, a route name is empty, or a duration is invalid.
 */
export function resolveCodexBackendSpec(config: Config): CodexBackendSpec {
  const routes = new Map<string, CodexRouteSpec>()
  for (const [name, route] of Object.entries(config.routes as Record<string, RouteConfig>)) {
    if (name.length === 0) throw new Error('llm-codex: route names must be non-empty')
    routes.set(name, { permissionMode: route.permissionMode as CodexRoutePermissionMode })
  }
  if (routes.size === 0) throw new Error('llm-codex: routes must declare at least one route')
  const disposeGraceMs = config.disposeGraceMs as number
  assertPositiveFinite('disposeGraceMs', disposeGraceMs, MAX_TIMER_DELAY_MS)
  if (config.turnIdleTimeoutMs !== undefined) {
    assertPositiveFinite('turnIdleTimeoutMs', config.turnIdleTimeoutMs, MAX_TIMER_DELAY_MS)
  }
  return {
    routes,
    env: { ...config.env },
    disposeGraceMs,
    turnIdleTimeoutMs: config.turnIdleTimeoutMs,
  }
}
