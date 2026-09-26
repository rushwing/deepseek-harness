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

/** One transition or lifecycle event applied to a REQ's artifacts. */
export interface LifecycleTransitionEvent {
  readonly version: 1
  readonly reqId: string
  /** The transition id, or the event name when `eventName` is present. */
  readonly id: string
  /** The REQ status before and after; equal for an event. */
  readonly from: string
  readonly to: string
  /** The registered uid that acted, or `''` when the actor role has no agent. */
  readonly actorUid: string
  readonly ownerBefore: string
  readonly ownerAfter: string
  readonly reviewRound: number | null
  /** The workspace-relative files the effects rewrote. */
  readonly files: readonly string[]
  /** Present when the step was a lifecycle event rather than a transition. */
  readonly eventName?: string
}

/** One role-child step of a `lifecycle_run`, logged when it starts and when it ends. */
export interface LifecycleStepEvent {
  readonly version: 1
  readonly reqId: string
  /** The acting registered uid, role, and the REQ state it worked in. */
  readonly uid: string
  readonly role: string
  readonly state: string
  /** The subagent provider that ran the child, and the model route and effort the registry seated. */
  readonly provider: string
  readonly route: { readonly provider: string; readonly model: string }
  readonly effort: string
  /** The child Session id once the child started; `null` on the `started` record. */
  readonly childSessionId: string | null
  readonly phase: 'started' | 'completed' | 'rejected' | 'failed'
  /** Why the step was rejected or failed; `null` otherwise. */
  readonly reason: string | null
}

/** One question to the human at a human-owned REQ state, and its outcome. */
export interface LifecycleHumanDecisionEvent {
  readonly version: 1
  readonly reqId: string
  readonly state: string
  /** The legal transition ids offered. */
  readonly options: readonly string[]
  readonly phase: 'requested' | 'answered' | 'unavailable'
  /** The transition chosen or the answer that stopped the run; `null` when nothing was answered. */
  readonly answer: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A `lifecycle_run` step by a role child: appended with `phase: started`
     * before the child spawns and again with `completed`, `rejected`, or
     * `failed` after it is disposed. Log-only; a resumed driver re-reads the
     * files and never replays a step.
     */
    'lifecycle/step': LifecycleStepEvent
    /**
     * A human decision `lifecycle_run` requested at a human-owned REQ state:
     * `requested` before the question, then `answered` with the choice or
     * `unavailable` when no answerer could be reached. Log-only.
     */
    'lifecycle/human-decision': LifecycleHumanDecisionEvent
    /**
     * A transition or lifecycle event that `lifecycle_transition` or the
     * driver applied: the REQ, the step, the status and owner before and
     * after, the acting uid, and the files rewritten. Log-only; a resumed
     * driver re-reads the files and never replays this event.
     */
    'lifecycle/transition': LifecycleTransitionEvent
    /**
     * A `lifecycle_lint` run: its scope (`all` or a REQ id), the violation
     * count, and the count per rule. Log-only; the violations themselves are
     * returned to the caller, not logged.
     */
    'lifecycle/lint': LifecycleLintEvent
  }
}
