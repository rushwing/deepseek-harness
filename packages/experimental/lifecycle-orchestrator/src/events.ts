/**
 * The Session events the lifecycle orchestrator appends.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/events
 */

/** One lint run over the lifecycle artifacts of the Session's workspace. */
export interface LifecycleLintEvent {
  readonly version: 1
  /** `all`, or the REQ id the run was scoped to. */
  readonly scope: string
  readonly violationCount: number
  /** Violations per rule id. */
  readonly ruleCounts: Readonly<Record<string, number>>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A `lifecycle_lint` run: its scope (`all` or a REQ id), the violation
     * count, and the count per rule. Log-only; the violations themselves are
     * returned to the caller, not logged.
     */
    'lifecycle/lint': LifecycleLintEvent
  }
}
