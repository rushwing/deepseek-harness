/**
 * Shared configuration resolution for conversation backends: the route table
 * every backend exposes and the duration fields it validates.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/routes
 */

import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** One resolved provider route. */
export interface ResolvedRoute<M extends string> {
  /** How threads created through the route answer product approval and input requests. */
  readonly permissionMode: M
}

/** The schema-defaulted configuration fields every backend shares. */
export interface BackendConfig<M extends string> {
  readonly routes?: Record<string, { readonly permissionMode?: M }>
  readonly env?: Record<string, string>
  readonly disposeGraceMs?: number
  readonly turnIdleTimeoutMs?: number
}

/** The fully resolved backend inputs. */
export interface BackendSpec<M extends string> {
  /** Routes in configuration order, each with its resolved permission mode. */
  readonly routes: ReadonlyMap<string, ResolvedRoute<M>>
  readonly env: Readonly<Record<string, string>>
  readonly disposeGraceMs: number
  readonly turnIdleTimeoutMs: number | undefined
}

/**
 * Resolve a backend's schema-defaulted configuration into its spec. The schema
 * has already filled every default, so this only checks what the schema cannot express.
 * @param source - plugin name prefixed to failure messages.
 * @param config - schema-validated plugin configuration.
 * @returns the routes with explicit permission modes and the process settings.
 * @throws when no route is configured, a route name is empty, or a duration is invalid.
 */
export function resolveBackendSpec<M extends string>(source: string, config: BackendConfig<M>): BackendSpec<M> {
  const routes = resolveRoutes(source, config.routes as Record<string, { permissionMode: M }>)
  const disposeGraceMs = config.disposeGraceMs as number
  assertDuration(source, 'disposeGraceMs', disposeGraceMs)
  if (config.turnIdleTimeoutMs !== undefined) assertDuration(source, 'turnIdleTimeoutMs', config.turnIdleTimeoutMs)
  return {
    routes,
    env: { ...config.env },
    disposeGraceMs,
    turnIdleTimeoutMs: config.turnIdleTimeoutMs,
  }
}

/**
 * Turn the schema-defaulted route table into the ordered route map a backend registers.
 * @param source - plugin name prefixed to failure messages.
 * @param routes - routes keyed by the name a request selects, each with its permission mode.
 * @returns the routes in configuration order.
 * @throws when no route is configured or a route name is empty.
 */
export function resolveRoutes<M extends string>(
  source: string,
  routes: Readonly<Record<string, { readonly permissionMode: M }>>,
): ReadonlyMap<string, ResolvedRoute<M>> {
  const resolved = new Map<string, ResolvedRoute<M>>()
  for (const [name, route] of Object.entries(routes)) {
    if (name.length === 0) throw new Error(`${source}: route names must be non-empty`)
    resolved.set(name, { permissionMode: route.permissionMode })
  }
  if (resolved.size === 0) throw new Error(`${source}: routes must declare at least one route`)
  return resolved
}

/**
 * Require a duration a timer can hold.
 * @param source - plugin name prefixed to the failure message.
 * @param field - configuration field name.
 * @param value - the configured milliseconds.
 * @throws when the value is not a positive finite number within `MAX_TIMER_DELAY_MS`.
 */
export function assertDuration(source: string, field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`${source}: ${field} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
