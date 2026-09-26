/**
 * Transition evidence: the predicates a lifecycle table references, evaluated
 * over one step's pre-step tree (guards) and its change (effects), plus the
 * lifecycle-sensitive delta a step's `may_change` bounds and the derived
 * T16 restore pair.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/predicates
 */

import {
  sensitiveKinds,
  transitionById,
  type AgentRegistry,
  type LifecycleEvent,
  type LifecycleTable,
  type PredicateClause,
  type Transition,
} from '@deepseek-ai/dsh-experimental-lifecycle-table'
import type { Artifact } from './artifacts.ts'
import type { ArtifactContract } from './contract.ts'
import { list, quote, textOf } from './format.ts'
import { asList, positiveInt, scalar } from './frontmatter.ts'
import type { ArtifactGraph } from './graph.ts'
import type { ReviewSection } from './review.ts'
import { sectionContent } from './text.ts'

const ABSENT_FIELDS: Readonly<Record<string, string>> = { status: 'draft', owner: 'human-absent' }
const BLOCKED = 'blocked'
const CURRENT_OWNER = 'current_owner'
const RESTORE_STATE = 'restore_state'
const RESTORE_OWNER = 'restore_owner'
const REQ_REVIEW = 'req_review'
const PR_DRAFT = 'pr_draft'
const PLANNER = 'planner'
const REQ_IMPL = 'req_impl'
const GENERATOR = 'generator'
const OPEN = 'open'
const REQ_KIND_PREFIX = 'req.'
const OWN_AND_CARRIED = 'own_and_carried'
const CARRIED = 'carried'
const ANY = 'any'

/** The material of one step. */
export interface EvidenceInputs {
  /** The tree before the step. */
  readonly pre: ArtifactGraph
  /** The tree after the step. */
  readonly post: ArtifactGraph
  readonly table: LifecycleTable
  readonly contract: ArtifactContract
  /** The registry that maps owner uids to roles; without it, roles come from uid prefixes. */
  readonly registry?: AgentRegistry | undefined
  /** The REQ the step is about. */
  readonly reqId: string
  /** The pull-request number the step's event carries, when known. */
  readonly eventPr?: number | undefined
}

/** The inputs with the readings predicates share. Guards read `pre`; effects compare `pre` with `post`. */
export interface Evidence extends EvidenceInputs {
  /** The role of an owner uid: the registry's, else the uid prefix when it names a table role, else empty. */
  roleOf(uid: unknown): string
  /** A REQ frontmatter value before the step; an absent REQ reads as `draft` owned by a human. */
  fieldBefore(name: string): unknown
  /** A REQ frontmatter value after the step; an absent REQ has none. */
  fieldAfter(name: string): unknown
  statusBefore(): string
  statusAfter(): string
  roleBefore(): string
  roleAfter(): string
  /** The restore pair the pre-step REQ records. */
  restorePair(): readonly [state: string, owner: string]
  /** The post-step `tc_policy`. */
  policy(): string
  /** Whether, after the step, a BUG the REQ carries also blocks it, or the REQ carries BUGs while nothing blocks it. */
  selfCarried(): boolean
  /** Post-step TC ids whose `linked_req` names the REQ. */
  ownTcs(): ReadonlySet<string>
  /** Post-step BUG ids whose `linked_req` names the REQ. */
  carriedBugs(): ReadonlySet<string>
  /** TCs the carried BUGs list that are not own TCs. */
  carriedOriginTcs(): ReadonlySet<string>
  /** One section of the REQ's RV in a tree. */
  sectionOf(graph: ArtifactGraph, section: string): ReviewSection | undefined
  /** A section's trimmed raw text, empty when absent. */
  sectionText(graph: ArtifactGraph, section: string): string
  /** The id of the REQ's RV. */
  rvId(): string
}

/** One predicate: whether it reads the pre-step tree or the step's change, and its check. */
export interface Predicate {
  readonly on: 'pre' | 'delta'
  /** The violation text, or `undefined` when the clause holds. */
  check(evidence: Evidence, clause: PredicateClause): string | undefined
}

function argList(clause: PredicateClause, name: string): string[] {
  return asList(clause.args[name])
}

function argText(clause: PredicateClause, name: string): string {
  return textOf(clause.args[name])
}

function argFlag(clause: PredicateClause, name: string): boolean {
  return clause.args[name] === true
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function roleText(role: string): string {
  return role === '' ? '(unregistered)' : role
}

/**
 * Build the evidence of one step.
 * @param inputs - the two trees, the tables, and the REQ.
 * @returns the evidence.
 */
export function evidence(inputs: EvidenceInputs): Evidence {
  const { pre, post, table, registry, reqId } = inputs
  const agents = new Map((registry === undefined ? [] : registry.agents).map(agent => [String(agent.uid), agent.role]))
  const roleOf = (uid: unknown): string => {
    const text = typeof uid === 'string' ? uid : ''
    const registered = agents.get(text)
    if (registered !== undefined) return registered
    const prefix = String(text.split('-')[0])
    return table.roles.includes(prefix) ? prefix : ''
  }
  const fieldBefore = (name: string): unknown => {
    const node = pre.reqs.get(reqId)
    return node === undefined ? ABSENT_FIELDS[name] : node.fm[name]
  }
  const fieldAfter = (name: string): unknown => {
    const node = post.reqs.get(reqId)
    return node === undefined ? undefined : node.fm[name]
  }
  const setOf = (nodes: readonly Artifact[]): Set<string> => new Set(nodes.map(node => node.id))
  const ownTcs = (): ReadonlySet<string> => setOf(post.ownTcsOf(reqId))
  const carriedBugs = (): ReadonlySet<string> => setOf(post.carriedBugsOf(reqId))
  const sectionOf = (graph: ArtifactGraph, section: string): ReviewSection | undefined => {
    const rv = graph.rvOf.get(reqId)
    return rv === undefined ? undefined : rv.sections[section]
  }
  return {
    ...inputs,
    roleOf,
    fieldBefore,
    fieldAfter,
    statusBefore: () => textOf(fieldBefore('status')),
    statusAfter: () => textOf(fieldAfter('status')),
    roleBefore: () => roleOf(fieldBefore('owner')),
    roleAfter: () => roleOf(fieldAfter('owner')),
    restorePair: () => [textOf(fieldBefore('blocked_from_status')), textOf(fieldBefore('blocked_from_owner'))],
    policy: () => {
      const node = post.reqs.get(reqId)
      return node === undefined ? '' : textOf(node.fm.tc_policy)
    },
    selfCarried: () => {
      const carried = setOf(post.carriedBugsOf(reqId))
      const blocking = setOf(post.blockingBugsOf(reqId))
      return [...carried].some(id => blocking.has(id)) || (carried.size > 0 && blocking.size === 0)
    },
    ownTcs,
    carriedBugs,
    carriedOriginTcs: () => {
      const own = ownTcs()
      const listed = new Set<string>()
      for (const bug of post.carriedBugsOf(reqId)) {
        for (const tc of asList(bug.fm.test_case_ref)) if (!own.has(tc)) listed.add(tc)
      }
      return listed
    },
    sectionOf,
    sectionText: (graph, section) => {
      const found = sectionOf(graph, section)
      return found === undefined ? '' : found.raw.trim()
    },
    rvId: () => `RV-${reqId.slice('REQ-'.length)}`,
  }
}

/**
 * The restore pair a blocking step records: a blocked REQ keeps its recorded
 * pair; a self-carried block restores to `req_review` / planner; a block from
 * `pr_draft` restores to `req_impl` / generator; otherwise the restore target
 * whose rejection transition leaves the source state.
 * @param evidence - the step evidence.
 * @returns the state and owner role, empty when no target matches.
 */
export function restorePairFor(evidence: Evidence): readonly [state: string, owner: string] {
  const source = evidence.statusBefore()
  if (source === BLOCKED) return evidence.restorePair()
  if (evidence.selfCarried()) return [REQ_REVIEW, PLANNER]
  if (source === PR_DRAFT) return [REQ_IMPL, GENERATOR]
  for (const target of evidence.table.restoreTargets) {
    const via = transitionById(evidence.table, String(target.via))
    if (via !== undefined && via.from.kind === 'name' && via.from.name === source) return [target.state, target.owner]
  }
  return ['', '']
}

function statusDelta(
  before: ReadonlyMap<string, Artifact>,
  after: ReadonlyMap<string, Artifact>,
): Map<string, readonly [was: string, now: string]> {
  const delta = new Map<string, readonly [string, string]>()
  for (const [id, node] of [...after].sort()) {
    const old = before.get(id)
    const was = old === undefined ? '' : old.status
    if (was !== node.status) delta.set(id, [was, node.status])
  }
  for (const [id, node] of [...before].sort()) {
    if (!after.has(id)) delta.set(id, [node.status, ''])
  }
  return delta
}

function scopeMembers(evidence: Evidence, scope: string, kind: 'TC' | 'BUG', clause: PredicateClause): ReadonlySet<string> {
  if (kind === 'BUG') return scope === CARRIED ? evidence.carriedBugs() : new Set()
  const own = new Set(evidence.ownTcs())
  if (argFlag(clause, 'exclude_carried_origin')) for (const tc of evidence.carriedOriginTcs()) own.delete(tc)
  if (scope === OWN_AND_CARRIED) for (const tc of evidence.carriedOriginTcs()) own.add(tc)
  return own
}

function artifactStatus(evidence: Evidence, clause: PredicateClause, kind: 'TC' | 'BUG'): string | undefined {
  const onlyRestore = scalar(clause.args.only_restore)
  if (onlyRestore !== undefined && restorePairFor(evidence)[0] !== onlyRestore) return undefined
  const delta = kind === 'TC' ? statusDelta(evidence.pre.tcs, evidence.post.tcs) : statusDelta(evidence.pre.bugs, evidence.post.bugs)
  const allowed = argList(clause, 'to')
  const from = argList(clause, 'from')
  const scope = argText(clause, 'scope')
  const members = scopeMembers(evidence, scope, kind, clause)
  const moved: string[] = []
  for (const [id, [was, now]] of delta) {
    if (now === '') continue
    if (scope !== ANY && !members.has(id)) return `${id}.status: outside this effect's scope (${scope}); this step may not change it`
    if (!allowed.includes(now)) return `${id}.status: after the step it is ${quote(now)}; this effect allows only ${list(allowed)}`
    if (from.length > 0 && !from.includes(was)) return `${id}.status: moved from ${quote(was)}; this effect moves only from ${list(from)}`
    moved.push(id)
  }
  if (moved.length === 0 && !argFlag(clause, 'optional')) return `${evidence.reqId}: this effect requires ${kind}s set to ${list(allowed)}; none changed`
  return undefined
}

function gateSigned(evidence: Evidence, clause: PredicateClause): string | undefined {
  const section = argText(clause, 'section')
  const wanted = argText(clause, 'verdict')
  const onlyFrom = scalar(clause.args.only_from)
  if (onlyFrom !== undefined && evidence.statusBefore() !== onlyFrom) return undefined
  const rvId = evidence.rvId()
  if (evidence.sectionText(evidence.pre, section) === evidence.sectionText(evidence.post, section)) {
    return `${rvId}.${section}: this transition signs the section, yet it is unchanged (pre-filled or unsigned)`
  }
  const after = evidence.sectionOf(evidence.post, section)
  if (after === undefined || after.verdict !== wanted) {
    const verdict = after === undefined || after.verdict === '' ? 'missing' : after.verdict
    return `${rvId}.${section}: the conclusion is ${verdict}; the declared transition requires ${wanted}`
  }
  const before = evidence.sectionOf(evidence.pre, section)
  const was = before === undefined ? 0 : numberOf(before.round)
  const now = after.round
  const expected = was + 1
  if (now !== expected) return `${rvId}.${section}: the round is ${String(now)}; the pre-step section had ${was}; expected ${expected}`
  if (section === REQ_REVIEW) {
    const declared = evidence.fieldAfter('review_round')
    if (declared !== now) return `${rvId}.${section}: round ${now} does not equal the post-step review_round ${quote(declared)}`
  }
  return undefined
}

function regressionLines(graph: ArtifactGraph, rvId: string): readonly string[] {
  const rv = graph.rvs.get(rvId)
  return rv === undefined ? [] : rv.regression.map(line => line.raw)
}

function regressionWithdrawn(evidence: Evidence, clause: PredicateClause): string | undefined {
  const onlyRestore = scalar(clause.args.only_restore)
  if (onlyRestore !== undefined && restorePairFor(evidence)[0] !== onlyRestore) return undefined
  const own = [...evidence.ownTcs()]
  const cites = (line: string): boolean => own.some(tc => line.includes(tc))
  for (const rv of evidence.pre.rvs.values()) {
    const before = regressionLines(evidence.pre, rv.id)
    const after = regressionLines(evidence.post, rv.id)
    const still = after.filter(cites)
    if (still.length > 0) return `${rv.id}.regression: still holds a line citing this REQ's TC ${quote(still[0])}`
    const dropped = before.filter(line => !after.includes(line) && !cites(line))
    if (dropped.length > 0) return `${rv.id}.regression: withdrew the unrelated line ${quote(dropped[0])}`
  }
  return undefined
}

/** Every predicate the English table vocabulary names. */
export const PREDICATES: Readonly<Record<string, Predicate>> = {
  'req.status_in': {
    on: 'pre',
    check: (evidence, clause) => {
      const states = argList(clause, 'states')
      const current = evidence.statusBefore()
      if (states.includes(current)) return undefined
      return `${evidence.reqId}.status: the pre-step tree has ${quote(current)}; the origin must be one of ${list(states)}`
    },
  },
  'req.status_not_in': {
    on: 'pre',
    check: (evidence, clause) => {
      const states = argList(clause, 'states')
      const current = evidence.statusBefore()
      if (!states.includes(current)) return undefined
      return `${evidence.reqId}.status: the pre-step tree has ${quote(current)}; this transition may not start from ${list(states)}`
    },
  },
  'req.owner_role_is': {
    on: 'pre',
    check: (evidence, clause) => {
      const wanted = argText(clause, 'role')
      if (wanted === CURRENT_OWNER) return undefined
      const actual = evidence.roleBefore()
      if (actual === wanted) return undefined
      return `${evidence.reqId}.owner: the pre-step owner's role is ${roleText(actual)}; the acting role must be ${wanted}`
    },
  },
  'req.pending_questions_empty': {
    on: 'pre',
    check: (evidence) => {
      const node = evidence.pre.reqs.get(evidence.reqId)
      if (node === undefined) return undefined
      const heading = evidence.contract.req.headings.pendingDecisions
      const none = evidence.contract.words.none
      const content = sectionContent(node.body, heading).trim()
      if (content === '' || content === none) return undefined
      return `${evidence.reqId}.${heading}: is not ${quote(none)}; this transition requires the decisions to be closed`
    },
  },
  'req.pending_bugs_empty': {
    on: 'pre',
    check: (evidence) => {
      const listed = asList(evidence.fieldBefore('pending_bugs'))
      if (listed.length === 0) return undefined
      return `${evidence.reqId}.pending_bugs: the pre-step tree still lists ${list(listed)}`
    },
  },
  'req.no_carried_bugs': {
    on: 'pre',
    check: (evidence) => {
      const carried = evidence.pre.carriedBugsOf(evidence.reqId).map(bug => bug.id)
      if (carried.length === 0) return undefined
      return `${evidence.reqId}: this exit carries no BUG; the pre-step tree carries ${list(carried)}`
    },
  },
  'carried_bugs_in': {
    on: 'pre',
    check: (evidence, clause) => {
      const states = argList(clause, 'states')
      const bad = evidence.pre.carriedBugsOf(evidence.reqId).filter(bug => !states.includes(bug.status)).map(bug => bug.id)
      if (bad.length === 0) return undefined
      return `${evidence.reqId}: carried BUGs ${list(bad)} are not yet in ${list(states)}`
    },
  },
  'pending_bugs_in': {
    on: 'pre',
    check: (evidence, clause) => {
      const states = argList(clause, 'states')
      const relaxed = [...new Set([...states, ...argList(clause, 'self_carried_states')])].sort()
      const carried = new Set(evidence.pre.carriedBugsOf(evidence.reqId).map(bug => bug.id))
      const bad: string[] = []
      for (const id of asList(evidence.fieldBefore('pending_bugs'))) {
        const bug = evidence.pre.bugs.get(id)
        if (bug === undefined) continue
        if (!(carried.has(id) ? relaxed : states).includes(bug.status)) bad.push(id)
      }
      if (bad.length === 0) return undefined
      return `${evidence.reqId}.pending_bugs: ${list(bad)} are not yet in the accepted states ${list(states)} (self-carried BUGs: ${list(relaxed)})`
    },
  },
  'req.status_to': {
    on: 'delta',
    check: (evidence, clause) => {
      const declared = argText(clause, 'state')
      const wanted = declared === RESTORE_STATE ? evidence.restorePair()[0] : declared
      const actual = evidence.statusAfter()
      if (actual === wanted) return undefined
      return `${evidence.reqId}.status: after the step it is ${quote(actual)}; this transition ends in ${quote(wanted)}`
    },
  },
  'req.owner_role_to': {
    on: 'delta',
    check: (evidence, clause) => {
      const declared = argText(clause, 'role')
      const wanted = declared === RESTORE_OWNER ? evidence.restorePair()[1] : declared
      const actual = evidence.roleAfter()
      if (actual === wanted) return undefined
      return `${evidence.reqId}.owner: after the step the owner's role is ${roleText(actual)}; the hand-over role is ${wanted}`
    },
  },
  'req.counter_inc': {
    on: 'delta',
    check: (evidence, clause) => {
      const field = argText(clause, 'field')
      if (field === '') return `${clause.name}: the field argument is missing`
      const onlyFrom = scalar(clause.args.only_from)
      const before = numberOf(evidence.fieldBefore(field))
      const after = numberOf(evidence.fieldAfter(field))
      const expected = onlyFrom !== undefined && evidence.statusBefore() !== onlyFrom ? before : before + 1
      if (after === expected) return undefined
      return `${evidence.reqId}.${field}: ${before} before, ${after} after; expected ${expected}`
    },
  },
  'req.pr_number_eq_event': {
    on: 'delta',
    check: (evidence, clause) => {
      const policy = scalar(clause.args.policy)
      if (policy !== undefined && evidence.policy() !== policy) return undefined
      if (evidence.eventPr === undefined) return undefined
      const before = evidence.fieldBefore('pr_number')
      const after = evidence.fieldAfter('pr_number')
      if (positiveInt(before) && before === after) return undefined
      if (after === evidence.eventPr) return undefined
      return `${evidence.reqId}.pr_number: after the step it is ${quote(after)}; the event PR number is ${evidence.eventPr}`
    },
  },
  'req.fields_set': {
    on: 'delta',
    check: (evidence, clause) => {
      const empty = argList(clause, 'fields').filter(field => asList(evidence.fieldAfter(field)).length === 0)
      if (empty.length === 0) return undefined
      return `${evidence.reqId}.${String(empty[0])}: this transition requires it to be set`
    },
  },
  'req.fields_cleared': {
    on: 'delta',
    check: (evidence, clause) => {
      const left = argList(clause, 'fields').filter(field => asList(evidence.fieldAfter(field)).length > 0)
      if (left.length === 0) return undefined
      const field = String(left[0])
      return `${evidence.reqId}.${field}: this transition requires it cleared; it is ${quote(evidence.fieldAfter(field))}`
    },
  },
  'req.restore_pair_set': {
    on: 'delta',
    check: (evidence) => {
      const expected = restorePairFor(evidence)
      const actual = [textOf(evidence.fieldAfter('blocked_from_status')), textOf(evidence.fieldAfter('blocked_from_owner'))]
      if (actual[0] === expected[0] && actual[1] === expected[1]) return undefined
      const source = `${quote(evidence.statusBefore())}${evidence.selfCarried() ? ' (self-carried)' : ''}`
      return `${evidence.reqId}.blocked_from_status/blocked_from_owner: after the step they are ${list(actual)}; the restore pair for origin ${source} is ${list(expected)}`
    },
  },
  'req.restore_pair_to': {
    on: 'delta',
    check: (evidence, clause) => {
      const expected = [argText(clause, 'state'), argText(clause, 'owner')]
      const actual = [textOf(evidence.fieldAfter('blocked_from_status')), textOf(evidence.fieldAfter('blocked_from_owner'))]
      if (actual[0] === expected[0] && actual[1] === expected[1]) return undefined
      return `${evidence.reqId}.blocked_from_status/blocked_from_owner: after the step they are ${list(actual)}; expected ${list(expected)}`
    },
  },
  'tc.status_to': { on: 'delta', check: (evidence, clause) => artifactStatus(evidence, clause, 'TC') },
  'bug.status_to': { on: 'delta', check: (evidence, clause) => artifactStatus(evidence, clause, 'BUG') },
  'rv.gate_signed': { on: 'delta', check: gateSigned },
  'rv.section_changed': {
    on: 'delta',
    check: (evidence, clause) => {
      const section = argText(clause, 'section')
      if (evidence.sectionText(evidence.pre, section) !== evidence.sectionText(evidence.post, section)) return undefined
      return `${evidence.rvId()}.${section}: this event requires the section to change; it is unchanged`
    },
  },
  'rv.regression_withdrawn': { on: 'delta', check: regressionWithdrawn },
}

/**
 * Evaluate clauses in order; a clause naming a predicate this module lacks is itself a problem.
 * @param evidence - the step evidence.
 * @param clauses - guards or effects.
 * @returns one problem per failing clause.
 */
export function checkClauses(evidence: Evidence, clauses: readonly PredicateClause[]): string[] {
  const problems: string[] = []
  for (const clause of clauses) {
    const predicate = PREDICATES[clause.name]
    if (predicate === undefined) {
      problems.push(`${clause.name}: no such predicate is implemented`)
      continue
    }
    const problem = predicate.check(evidence, clause)
    if (problem !== undefined) problems.push(problem)
  }
  return problems
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function rvSections(graph: ArtifactGraph): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>()
  for (const rv of graph.rvs.values()) {
    const sections: Record<string, string> = Object.fromEntries(
      Object.entries(rv.sections).map(([name, section]) => [name, section.raw.trim()]),
    )
    if (rv.regression.length > 0) sections.regression = rv.regression.map(line => line.raw).join('\n')
    result.set(rv.id, sections)
  }
  return result
}

function pushTo(delta: Record<string, string[]>, kind: string, id: string): void {
  const listed = delta[kind]
  if (listed === undefined) delta[kind] = [id]
  else listed.push(id)
}

/**
 * Every lifecycle-sensitive change between two trees, keyed by the
 * `may_change` kind (`req.<field>`, `tc_status:<status>`, `bug_status:<status>`,
 * `rv:<section>`) with the changed object ids. A new REQ file, a new TC, and
 * a new open BUG are not changes; a deleted object is.
 * @param pre - the tree before.
 * @param post - the tree after.
 * @param table - the table whose sensitive REQ fields are compared.
 * @returns kind to sorted object ids.
 */
export function sensitiveDelta(
  pre: ArtifactGraph,
  post: ArtifactGraph,
  table: LifecycleTable,
): Readonly<Record<string, readonly string[]>> {
  const delta: Record<string, string[]> = {}
  const fields = sensitiveKinds(table).filter(kind => kind.startsWith(REQ_KIND_PREFIX)).map(kind => kind.slice(REQ_KIND_PREFIX.length))
  for (const [id, before] of [...pre.reqs].sort()) {
    const after = post.reqs.get(id)
    for (const field of fields) {
      if (!same(before.fm[field], after === undefined ? undefined : after.fm[field])) pushTo(delta, `${REQ_KIND_PREFIX}${field}`, id)
    }
  }
  for (const [id, node] of [...post.tcs].sort()) {
    const previous = pre.tcs.get(id)
    if (previous !== undefined && previous.status !== node.status) pushTo(delta, `tc_status:${node.status}`, id)
  }
  for (const [id, node] of [...pre.tcs].sort()) if (!post.tcs.has(id)) pushTo(delta, `tc_status:${node.status}`, id)
  for (const [id, node] of [...post.bugs].sort()) {
    const previous = pre.bugs.get(id)
    const changed = previous === undefined ? node.status !== OPEN : previous.status !== node.status
    if (changed) pushTo(delta, `bug_status:${node.status}`, id)
  }
  for (const [id, node] of [...pre.bugs].sort()) if (!post.bugs.has(id)) pushTo(delta, `bug_status:${node.status}`, id)
  const before = rvSections(pre)
  const after = rvSections(post)
  for (const rvId of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const sections = after.get(rvId)
    const old = before.get(rvId) ?? {}
    if (sections === undefined) {
      for (const section of Object.keys(old).sort()) pushTo(delta, `rv:${section}`, rvId)
      continue
    }
    for (const [section, text] of Object.entries(sections)) {
      if ((old[section] ?? '') !== text) pushTo(delta, `rv:${section}`, rvId)
    }
    for (const section of Object.keys(old)) if (!(section in sections)) pushTo(delta, `rv:${section}`, rvId)
  }
  return delta
}

/**
 * The REQs whose status or owner differs between two trees; a REQ absent
 * before reads as `draft` without an owner, and a deleted REQ counts as changed.
 * @param pre - the tree before.
 * @param post - the tree after.
 * @returns the sorted REQ ids.
 */
export function changedReqs(pre: ArtifactGraph, post: ArtifactGraph): string[] {
  const changed: string[] = []
  for (const id of [...new Set([...pre.reqs.keys(), ...post.reqs.keys()])].sort()) {
    const before = pre.reqs.get(id)
    const after = post.reqs.get(id)
    const was = before === undefined
      ? { status: ABSENT_FIELDS.status, owner: undefined }
      : { status: before.fm.status, owner: before.fm.owner }
    const now = after === undefined ? { status: undefined, owner: undefined } : { status: after.fm.status, owner: after.fm.owner }
    if (!same(was.status, now.status) || !same(was.owner, now.owner)) changed.push(id)
  }
  return changed
}

function mayChangeProblems(evidence: Evidence, allowed: readonly string[]): string[] {
  const problems: string[] = []
  for (const [kind, objects] of Object.entries(sensitiveDelta(evidence.pre, evidence.post, evidence.table)).sort()) {
    if (!allowed.includes(kind)) problems.push(`${list(objects)}: changed ${kind}, which is not in this step's may_change`)
  }
  return problems
}

/**
 * Judge one transition step: only its REQ moves, every guard held before it,
 * every effect holds after it, and nothing outside `may_change` changed.
 * @param evidence - the step evidence.
 * @param transition - the declared transition.
 * @returns every problem, empty when the step is a complete instance of the transition.
 */
export function checkTransition(evidence: Evidence, transition: Transition): string[] {
  const others = changedReqs(evidence.pre, evidence.post).filter(id => id !== evidence.reqId)
  const problems = others.length === 0 ? [] : [`${others.join(', ')}: a step changes the status or owner of its own REQ only`]
  return [
    ...problems,
    ...checkClauses(evidence, transition.guards),
    ...checkClauses(evidence, transition.effects),
    ...mayChangeProblems(evidence, transition.mayChange),
  ]
}

/**
 * Judge one event step: no REQ changes status or owner, every guard held,
 * every effect holds, and nothing outside `may_change` changed.
 * @param evidence - the step evidence.
 * @param event - the declared event.
 * @returns every problem, empty when the step is a complete instance of the event.
 */
export function checkEvent(evidence: Evidence, event: LifecycleEvent): string[] {
  const changed = changedReqs(evidence.pre, evidence.post)
  const problems = changed.length === 0 ? [] : [`${changed.join(', ')}: an event leaves the REQ status and owner unchanged`]
  return [
    ...problems, ...checkClauses(evidence, event.guards),
    ...checkClauses(evidence, event.effects),
    ...mayChangeProblems(evidence, event.mayChange),
  ]
}
