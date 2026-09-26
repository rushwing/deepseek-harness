/**
 * Types of the lifecycle team's static tables: the lifecycle state table, the
 * agent registry, and the work-item id scheme. Only types live here.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-table/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Registered agent identity of the form `<role>-NNN`. */
export type AgentUid = Branded<'LifecycleAgentUid'>

/** Transition identity of the form `T<NN>[a-z]`. */
export type TransitionId = Branded<'LifecycleTransitionId'>

/** The state enumerations of the table. */
export interface LifecycleStates {
  /** The REQ main chain, in order; the position is the status index. */
  readonly req: readonly string[]
  /** REQ states off the main chain (`blocked`), judged by their restore target. */
  readonly reqOffChain: readonly string[]
  /** TC statuses. */
  readonly tc: readonly string[]
  /** BUG statuses. */
  readonly bug: readonly string[]
}

/** One review-record section and the role that signs it. */
export interface ReviewGate {
  readonly section: string
  readonly signer: string
}

/** One legal T16 restore pair, keyed by the rejection transition it mirrors. */
export interface RestoreTarget {
  readonly via: TransitionId
  readonly state: string
  readonly owner: string
}

/** A transition's `from`, `actor`, `to`, or `owner_after` slot. */
export type TransitionSlot =
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'any-of'; readonly states: readonly string[] }
  | { readonly kind: 'special'; readonly name: string }

/** One guard or effect: a registered predicate name and its arguments. */
export interface PredicateClause {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

/** One registered transition with its static facts and version 2 registrations. */
export interface Transition {
  readonly id: TransitionId
  readonly from: TransitionSlot
  readonly actor: TransitionSlot
  readonly to: TransitionSlot
  readonly ownerAfter: TransitionSlot
  /** Whether the transition is exempt from the hard-stop checks (only T19). */
  readonly exemptFromHardStop: boolean
  /** Whether the entry wrote the exemption key at all, whatever its value. */
  readonly exemptDeclared: boolean
  /** Commit-subject shapes, each anchored at the line start and naming exactly this id. */
  readonly subjects: readonly string[]
  /** Predicates over the pre-step graph that must hold for the transition to happen. */
  readonly guards: readonly PredicateClause[]
  /** Predicates over the step's changes that must hold for the transition to be complete. */
  readonly effects: readonly PredicateClause[]
  /** The lifecycle-sensitive kinds the transition may change. */
  readonly mayChange: readonly string[]
}

/** One registered non-transition event: a change that leaves the REQ status and owner alone. */
export interface LifecycleEvent {
  readonly name: string
  readonly subjects: readonly string[]
  readonly guards: readonly PredicateClause[]
  readonly effects: readonly PredicateClause[]
  readonly mayChange: readonly string[]
}

/** The predicate vocabulary the table may reference. */
export interface PredicateVocabulary {
  /** Data predicates: name to parameter names. */
  readonly data: Readonly<Record<string, readonly string[]>>
  /** Predicates only code can express. */
  readonly code: readonly string[]
}

/** The loaded lifecycle state table. */
export interface LifecycleTable {
  readonly version: number
  readonly states: LifecycleStates
  readonly roles: readonly string[]
  readonly gates: readonly ReviewGate[]
  /** `tc_policy` to the transitions that leave `req_review` under it. */
  readonly exits: Readonly<Record<string, readonly TransitionId[]>>
  /** Policy column to state to the review sections that must PASS to enter it. */
  readonly passToEnter: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>
  /** REQ state to the TC statuses allowed while the REQ is there. */
  readonly tcStatusByState: Readonly<Record<string, readonly string[]>>
  readonly restoreTargets: readonly RestoreTarget[]
  readonly transitions: readonly Transition[]
  readonly events: Readonly<Record<string, LifecycleEvent>>
  readonly predicates: PredicateVocabulary
}

/** Result of loading a lifecycle table: the table, or the problems that prevented it. */
export interface LifecycleTableLoad {
  readonly table: LifecycleTable | undefined
  readonly problems: readonly string[]
}

/** Reasoning efforts a registry may assign. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** A dsh provider route and the model it resolves. */
export interface AgentRoute {
  readonly provider: string
  readonly model: string
}

/** An ordered fallback route with its declared vendor. */
export interface FallbackRoute extends AgentRoute {
  readonly vendor: string
}

/** One registered agent. Human agents carry no route, vendor, or effort. */
export interface RegisteredAgent {
  readonly uid: AgentUid
  readonly role: string
  readonly description?: string
  readonly notes?: string
  readonly vendor?: string
  readonly route?: AgentRoute
  /** Effort by state with a `default`; a scalar registration is normalized to `{ default }`. */
  readonly effort?: Readonly<Record<string, ReasoningEffort>>
  readonly fallbacks: readonly FallbackRoute[]
  /** The states the agent may work in; equal to the states the table derives for its role. */
  readonly handles: readonly string[]
}

/** One complete planner / generator / evaluator trio. */
export interface ProviderSet {
  readonly kind: 'same_vendor' | 'cross_vendor'
  readonly planner: AgentUid
  readonly generator: AgentUid
  readonly evaluator: AgentUid
}

/** The loaded agent registry. */
export interface AgentRegistry {
  readonly version: number
  /** Role name to its description. */
  readonly roles: Readonly<Record<string, string>>
  readonly providerSets: Readonly<Record<string, ProviderSet>>
  /** The provider set whose members take the role seats; absent when no sets are declared. */
  readonly activeSet: string | undefined
  /** State to the uid that takes that state instead of the active set's role member. */
  readonly seats: Readonly<Record<string, AgentUid>>
  readonly agents: readonly RegisteredAgent[]
}

/** Result of loading an agent registry. */
export interface AgentRegistryLoad {
  readonly registry: AgentRegistry | undefined
  readonly problems: readonly string[]
}

/** Scope directory to work-item id prefix. */
export interface IdScheme {
  readonly scopes: Readonly<Record<string, string>>
}

/** Result of loading an id scheme. */
export interface IdSchemeLoad {
  readonly scheme: IdScheme | undefined
  readonly problems: readonly string[]
}
