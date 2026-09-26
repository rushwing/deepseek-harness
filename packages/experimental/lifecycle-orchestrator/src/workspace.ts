/**
 * Reading one workspace's lifecycle directory: the four tables, the artifact
 * graph, the lint, the hard-stop check-in, the legal transitions of a REQ,
 * and the status report. Files are the only truth; nothing is cached.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/workspace
 */

import { readFileSync, statSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  loadAgentRegistry,
  loadIdScheme,
  loadLifecycleTable,
  seatFor,
  transitionById,
  type AgentRegistry,
  type IdScheme,
  type LifecycleEvent,
  type LifecycleTable,
  type PredicateClause,
  type Transition,
  type TransitionSlot,
} from '@deepseek-ai/dsh-experimental-lifecycle-table'
import {
  asList,
  checkClauses,
  checkEvent,
  checkTransition,
  directorySource,
  evidence,
  lint,
  loadArtifactContract,
  loadGraph,
  parseOptionsOf,
  planEffects,
  textOf,
  writeAtomically,
  type ArtifactContract,
  type ArtifactGraph,
  type FileProbe,
  type Req,
  type StepDecisions,
  type Violation,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import { LifecycleError } from './errors.ts'
import { diffTree, restoreTree, snapshotTree } from './tree.ts'

/** The four loaded tables of a workspace. */
export interface LifecycleTables {
  readonly table: LifecycleTable
  readonly registry: AgentRegistry
  readonly idScheme: IdScheme
  readonly contract: ArtifactContract
}

/** The outcome of reading a workspace's lifecycle directory. */
export interface LifecycleLoad {
  /** The absolute lifecycle directory. */
  readonly root: string
  /** The lifecycle directory relative to the workspace, as configured. */
  readonly dir: string
  /** The tables, present only when every file loaded without problems. */
  readonly tables: LifecycleTables | undefined
  /** One line per missing file or loader problem, prefixed with the file label. */
  readonly problems: readonly string[]
}

/** One lint run's findings and their count per rule. */
export interface LintReport {
  readonly violations: readonly Violation[]
  readonly counts: Readonly<Record<string, number>>
}

/** The hard-stop check-in a role performs before working on a REQ. */
export interface CheckInRequest {
  readonly reqId: string
  /** The caller's registered uid. */
  readonly uid: string
  /** The REQ state the caller intends to work in. */
  readonly state: string
  /** The transition the caller intends to take; exempt transitions pass the owner and state checks. */
  readonly transition?: string | undefined
}

/** The three checks and the verdict. */
export interface CheckInResult {
  readonly ok: boolean
  /** Whether the named transition is exempt from the owner and state checks for the caller's role. */
  readonly exempt: boolean
  readonly checks: {
    /** The REQ file exists. */
    readonly c1: { readonly ok: boolean; readonly file: string | null }
    /** The caller is the REQ's owner. */
    readonly c2: { readonly ok: boolean; readonly expected: string | null; readonly actual: string }
    /** The REQ is in the intended state and the caller's registration handles it. */
    readonly c3: {
      readonly ok: boolean
      readonly status: string | null
      readonly state: string
      readonly handles: string[]
    }
  }
}

/** One transition the REQ's current owner may take. */
export interface LegalTransition {
  readonly id: string
  /** The acting role; the current owner's role for `current_owner` transitions. */
  readonly actor: string
  /** The target state, with the restore state resolved for T16. */
  readonly to: string
  /** The role that owns the REQ afterwards, with the restore owner resolved for T16. */
  readonly ownerAfter: string
  /** Whether a human acts. */
  readonly human: boolean
}

/** One REQ's lifecycle position. */
export interface ReqStatus {
  readonly id: string
  readonly status: string
  readonly owner: string
  /** The owner's registered role, empty when the owner is not registered. */
  readonly ownerRole: string
  readonly reviewRound: number | null
  readonly tcPolicy: string
  readonly blocked: {
    readonly reason: string
    readonly pendingBugs: string[]
    readonly restoreState: string
    readonly restoreOwner: string
  } | null
  /** The uid that takes the owner role at the current state, or null when none does. */
  readonly seat: string | null
  readonly legalTransitions: LegalTransition[]
}

/** The status report of one REQ or of every REQ. */
export interface LifecycleStatus {
  readonly activeSet: string | null
  readonly reqs: ReqStatus[]
}

/** A transition or lifecycle event to apply to one REQ. */
export interface TransitionRequest {
  readonly reqId: string
  /** A transition id such as `T03`; exactly one of `transition` and `event` is named. */
  readonly transition?: string | undefined
  /** A lifecycle event name such as `bug_fix`. */
  readonly event?: string | undefined
  /** The sentence after the dash in the suggested commit subject; never blank. */
  readonly summary: string
  /** The choices for effects that admit several values. */
  readonly decisions?: StepDecisions | undefined
  /** The pull-request number the step carries, read by `req.pr_number_eq_event`. */
  readonly pr?: number | undefined
}

/** What applying a transition or event did, or why it was rejected with nothing written. */
export interface TransitionResult {
  readonly kind: 'transition' | 'event'
  readonly applied: boolean
  readonly reqId: string
  /** The transition id or the event name. */
  readonly id: string
  readonly from: string
  /** The status after an applied step, or the status the step declares when rejected. */
  readonly to: string
  /** The uid seated in the acting role, or `''` when the role has no agent. */
  readonly actorUid: string
  readonly ownerBefore: string
  readonly ownerAfter: string
  readonly reviewRound: number | null
  /** The workspace-relative files rewritten; empty when rejected. */
  readonly files: string[]
  readonly suggestedCommitSubject: string
  /** Guard, effect, `may_change`, and lint problems; empty when applied. */
  readonly violations: string[]
}

const TASKS = 'tasks'
const TABLE_FILE = 'lifecycle.yml'
const REGISTRY_FILE = 'agent-registry.yml'
const ID_SCHEME_FILE = `${TASKS}/id-scheme.yml`
const CONTRACT_FILE = 'artifact-contract.yml'
const BLOCKED = 'blocked'
const DONE = 'done'
const ARCHIVE_DIR = 'archive'
const HUMAN = 'human'
/** Special slot names to the REQ frontmatter field that resolves them. */
const SPECIAL_FIELDS: Readonly<Record<string, string>> = { restore_state: 'blocked_from_status', restore_owner: 'blocked_from_owner' }

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/**
 * Load the four tables under `<cwd>/<dir>/`.
 * @param cwd - the absolute workspace directory.
 * @param dir - the lifecycle directory relative to the workspace.
 * @returns the tables, or every problem that prevented them.
 */
export function loadTables(cwd: string, dir: string): LifecycleLoad {
  const root = join(cwd, dir)
  const label = (file: string): string => posix.join(dir, file)
  const texts = new Map<string, string | undefined>()
  const missing: string[] = []
  for (const file of [TABLE_FILE, REGISTRY_FILE, ID_SCHEME_FILE, CONTRACT_FILE]) {
    const text = readOptional(join(root, ...file.split('/')))
    if (text === undefined) missing.push(`${label(file)}: missing`)
    texts.set(file, text)
  }
  if (missing.length > 0) return { root, dir, tables: undefined, problems: missing }
  const table = loadLifecycleTable(String(texts.get(TABLE_FILE)), label(TABLE_FILE))
  if (table.table === undefined) return { root, dir, tables: undefined, problems: table.problems }
  const registry = loadAgentRegistry(String(texts.get(REGISTRY_FILE)), table.table, label(REGISTRY_FILE))
  const idScheme = loadIdScheme(String(texts.get(ID_SCHEME_FILE)), label(ID_SCHEME_FILE))
  const contract = loadArtifactContract(String(texts.get(CONTRACT_FILE)), label(CONTRACT_FILE))
  const problems = [...registry.problems, ...idScheme.problems, ...contract.problems]
  if (registry.registry === undefined || idScheme.scheme === undefined || contract.contract === undefined) {
    return { root, dir, tables: undefined, problems }
  }
  return {
    root,
    dir,
    tables: { table: table.table, registry: registry.registry, idScheme: idScheme.scheme, contract: contract.contract },
    problems: [],
  }
}

/**
 * The tables of a load, or the `TABLES_INVALID` failure listing its problems.
 * @param load - a workspace load.
 * @returns the tables.
 */
export function requireTables(load: LifecycleLoad): LifecycleTables {
  if (load.tables === undefined) {
    throw new LifecycleError('TABLES_INVALID', `the lifecycle tables under ${load.dir}/ did not load:\n${load.problems.join('\n')}`)
  }
  return load.tables
}

/**
 * The artifact graph of a loaded workspace.
 * @param load - a workspace load with tables.
 * @returns the graph of `<dir>/tasks/`.
 */
export function graphOf(load: LifecycleLoad): ArtifactGraph {
  const tables = requireTables(load)
  const source = directorySource(join(load.root, TASKS), posix.join(load.dir, TASKS))
  return loadGraph(source, parseOptionsOf(tables.contract))
}

/**
 * The REQ of a tree.
 * @param graph - the tree.
 * @param reqId - the REQ id.
 * @returns the REQ node.
 * @throws LifecycleError `UNKNOWN_REQ` when the tree has no such REQ.
 */
export function requireReq(graph: ArtifactGraph, reqId: string): Req {
  const req = graph.reqs.get(reqId)
  if (req === undefined) throw new LifecycleError('UNKNOWN_REQ', `${reqId} is not a REQ under ${graph.tasksDir}/`)
  return req
}

function requireTransition(table: LifecycleTable, id: string): Transition {
  const transition = transitionById(table, id)
  if (transition === undefined) throw new LifecycleError('UNKNOWN_TRANSITION', `${id} is not a transition of the lifecycle table`)
  return transition
}

/** Link targets are judged by `stat`: a path that cannot be read is a missing target. */
function probe(cwd: string): FileProbe {
  return {
    kind: (path) => {
      try {
        return statSync(join(cwd, ...path.split('/'))).isFile() ? 'file' : 'directory'
      } catch (_error: unknown) {
        return 'missing'
      }
    },
  }
}

/** The files a REQ's lint scope covers: the REQ, its TCs, RV, PL, and the BUGs it carries or that block it. */
function family(graph: ArtifactGraph, req: Req): ReadonlySet<string> {
  const labels = new Set<string>([req.label])
  for (const tc of graph.ownTcsOf(req.id)) labels.add(tc.label)
  for (const bug of [...graph.carriedBugsOf(req.id), ...graph.blockingBugsOf(req.id)]) labels.add(bug.label)
  const rv = graph.rvOf.get(req.id)
  if (rv !== undefined) labels.add(rv.label)
  const pl = graph.plOf.get(req.id)
  if (pl !== undefined) labels.add(pl.label)
  return labels
}

/**
 * Lint the workspace's artifacts, all of them or one REQ's family.
 * @param cwd - the absolute workspace directory.
 * @param load - the workspace load.
 * @param reqId - when given, keep only the violations of that REQ's files.
 * @returns the violations and their count per rule.
 */
export function lintWorkspace(cwd: string, load: LifecycleLoad, reqId?: string): LintReport {
  const tables = requireTables(load)
  const graph = graphOf(load)
  const everything = lint({
    graph,
    contract: tables.contract,
    table: tables.table,
    registry: tables.registry,
    idScheme: tables.idScheme,
    workspace: probe(cwd),
  })
  const scope = reqId === undefined ? undefined : family(graph, requireReq(graph, reqId))
  const violations = scope === undefined ? everything : everything.filter(violation => scope.has(violation.file))
  const counts: Record<string, number> = {}
  for (const violation of violations) counts[violation.rule] = (counts[violation.rule] ?? 0) + 1
  return { violations, counts }
}

/**
 * The role of a registered uid.
 * @param registry - the loaded registry.
 * @param uid - the uid.
 * @returns the role, or `''` for an unregistered uid.
 */
export function roleOf(registry: AgentRegistry, uid: string): string {
  const agent = registry.agents.find(entry => String(entry.uid) === uid)
  return agent === undefined ? '' : agent.role
}

/**
 * Run the hard-stop checks for one caller on one REQ.
 * @param load - the workspace load.
 * @param request - who checks in, on which REQ, in which state, for which transition.
 * @returns the three checks and the verdict.
 */
export function checkIn(load: LifecycleLoad, request: CheckInRequest): CheckInResult {
  const tables = requireTables(load)
  const graph = graphOf(load)
  const transition = request.transition === undefined ? undefined : requireTransition(tables.table, request.transition)
  const agent = tables.registry.agents.find(entry => String(entry.uid) === request.uid)
  const handles = agent === undefined ? [] : [...agent.handles]
  const role = agent === undefined ? '' : agent.role
  const actorRole = transition === undefined || transition.actor.kind !== 'name' ? '' : transition.actor.name
  const exempt = transition !== undefined && transition.exemptFromHardStop && actorRole === role
  const req = graph.reqs.get(request.reqId)
  if (req === undefined) {
    return {
      ok: false,
      exempt,
      checks: {
        c1: { ok: false, file: null },
        c2: { ok: false, expected: null, actual: request.uid },
        c3: { ok: false, status: null, state: request.state, handles },
      },
    }
  }
  const owner = textOf(req.fm.owner)
  const ownerOk = owner === request.uid
  const stateOk = req.status === request.state && handles.includes(request.state)
  return {
    ok: exempt || (ownerOk && stateOk),
    exempt,
    checks: {
      c1: { ok: true, file: req.label },
      c2: { ok: ownerOk, expected: owner, actual: request.uid },
      c3: { ok: stateOk, status: req.status, state: request.state, handles },
    },
  }
}

/** The state names a slot stands for: the named state, the `any_of` states, or the REQ field a special slot reads. */
function slotNames(slot: TransitionSlot, req: Req): readonly string[] {
  switch (slot.kind) {
    case 'name':
      return [slot.name]
    case 'any-of':
      return slot.states
    case 'special':
      return [textOf(req.fm[String(SPECIAL_FIELDS[slot.name])])]
  }
}

/**
 * The transitions the REQ's current owner may take from its status.
 * @param tables - the loaded tables.
 * @param req - the REQ.
 * @returns the transitions in table order.
 */
export function legalTransitionsOf(tables: LifecycleTables, req: Req): LegalTransition[] {
  const ownerRole = roleOf(tables.registry, textOf(req.fm.owner))
  const legal: LegalTransition[] = []
  for (const transition of tables.table.transitions) {
    if (!slotNames(transition.from, req).includes(req.status)) continue
    const actor = transition.actor.kind === 'name' ? transition.actor.name : ownerRole
    if (actor === '' || actor !== ownerRole) continue
    legal.push({
      id: String(transition.id),
      actor,
      to: String(slotNames(transition.to, req)[0]),
      ownerAfter: String(slotNames(transition.ownerAfter, req)[0]),
      human: actor === HUMAN,
    })
  }
  return legal
}

function reqStatusOf(tables: LifecycleTables, req: Req): ReqStatus {
  const owner = textOf(req.fm.owner)
  const ownerRole = roleOf(tables.registry, owner)
  const seat = ownerRole === '' ? undefined : seatFor(tables.registry, ownerRole, req.status)
  return {
    id: req.id,
    status: req.status,
    owner,
    ownerRole,
    reviewRound: roundOf(req),
    tcPolicy: req.tcPolicy,
    blocked: req.status === BLOCKED
      ? {
        reason: textOf(req.fm.blocked_reason),
        pendingBugs: asList(req.fm.pending_bugs),
        restoreState: textOf(req.fm.blocked_from_status),
        restoreOwner: textOf(req.fm.blocked_from_owner),
      }
      : null,
    seat: seat === undefined ? null : String(seat),
    legalTransitions: legalTransitionsOf(tables, req),
  }
}

/**
 * The lifecycle position of one REQ or of every REQ, in id order.
 * @param load - the workspace load.
 * @param reqId - when given, report that REQ only.
 * @returns the report.
 */
export function statusOf(load: LifecycleLoad, reqId?: string): LifecycleStatus {
  const tables = requireTables(load)
  const graph = graphOf(load)
  const reqs = reqId === undefined
    ? [...graph.reqs.values()].sort((left, right) => left.id.localeCompare(right.id))
    : [requireReq(graph, reqId)]
  const activeSet = tables.registry.activeSet
  return { activeSet: activeSet === undefined ? null : activeSet, reqs: reqs.map(req => reqStatusOf(tables, req)) }
}

/**
 * The transitions the current owner of a REQ may take.
 * @param load - the workspace load.
 * @param reqId - the REQ.
 * @returns the transitions in table order.
 */
export function legalTransitions(load: LifecycleLoad, reqId: string): LegalTransition[] {
  const tables = requireTables(load)
  return legalTransitionsOf(tables, requireReq(graphOf(load), reqId))
}

function roundOf(req: Req): number | null {
  const round = req.fm.review_round
  return typeof round === 'number' && Number.isInteger(round) ? round : null
}

/**
 * The uid that takes a role at a REQ state: the registry seat when one is
 * resolvable, else the first registered agent of the role, else `''`.
 */
function uidFor(registry: AgentRegistry, role: string, state: string): string {
  const seat = seatFor(registry, role, state)
  if (seat !== undefined) return String(seat)
  const agent = registry.agents.find(entry => entry.role === role)
  return agent === undefined ? '' : String(agent.uid)
}

interface StepBase {
  readonly id: string
  readonly guards: readonly PredicateClause[]
  readonly effects: readonly PredicateClause[]
}

type Step =
  | (StepBase & { readonly kind: 'transition'; readonly transition: Transition })
  | (StepBase & { readonly kind: 'event'; readonly event: LifecycleEvent })

function stepOf(table: LifecycleTable, request: TransitionRequest): Step {
  if (request.summary.trim() === '') {
    throw new LifecycleError('INVALID_REQUEST', 'the summary is blank; it becomes the sentence after the dash in the commit subject')
  }
  const named = [request.transition, request.event].filter(name => name !== undefined)
  if (named.length !== 1) throw new LifecycleError('INVALID_REQUEST', 'name exactly one of transition or event')
  if (request.transition !== undefined) {
    const transition = requireTransition(table, request.transition)
    return { kind: 'transition', id: String(transition.id), guards: transition.guards, effects: transition.effects, transition }
  }
  const name = String(request.event)
  const event = table.events[name]
  if (event === undefined) throw new LifecycleError('UNKNOWN_TRANSITION', `${name} is not an event of the lifecycle table`)
  return { kind: 'event', id: name, guards: event.guards, effects: event.effects, event }
}

/**
 * One lint violation as `file [rule]: message`.
 * @param violation - the violation.
 * @returns the line.
 */
export function violationText(violation: Violation): string {
  return `${violation.file} [${violation.rule}]: ${violation.message}`
}

/**
 * Apply one transition or event to the tree on disk: the guards are judged
 * against `pre`, the effects are planned over the current tree and written
 * atomically, and the result is judged as a complete step (guards, effects,
 * `may_change`) and linted within the REQ's family. A red judgement or lint
 * restores the rewritten files to their previous bytes.
 * @param cwd - the absolute workspace directory the artifact labels are relative to.
 * @param load - the workspace load.
 * @param pre - the tree before the step; the current tree when nothing preceded the call.
 * @param request - the step and its decisions.
 * @returns what was applied, or the violations and nothing written.
 * @throws LifecycleError with `UNKNOWN_REQ`, `UNKNOWN_TRANSITION`, or `INVALID_REQUEST`.
 */
export async function applyStep(
  cwd: string, load: LifecycleLoad, pre: ArtifactGraph, request: TransitionRequest,
): Promise<TransitionResult> {
  const tables = requireTables(load)
  const { table, contract, registry } = tables
  const step = stepOf(table, request)
  const current = graphOf(load)
  const before = requireReq(pre, request.reqId)
  requireReq(current, request.reqId)
  const ownerBefore = textOf(before.fm.owner)
  const roleBefore = roleOf(registry, ownerBefore)
  const actorRole = step.kind === 'transition' && step.transition.actor.kind === 'name' ? step.transition.actor.name : roleBefore
  const to = step.kind === 'transition' ? String(slotNames(step.transition.to, before)[0]) : before.status
  const ownerAfterRole = step.kind === 'transition' ? String(slotNames(step.transition.ownerAfter, before)[0]) : roleBefore
  const base = {
    kind: step.kind,
    reqId: request.reqId,
    id: step.id,
    from: before.status,
    to,
    actorUid: uidFor(registry, actorRole, before.status),
    ownerBefore,
    ownerAfter: uidFor(registry, ownerAfterRole, to),
    reviewRound: roundOf(before),
    files: [],
    suggestedCommitSubject: `lifecycle: ${step.id} — ${request.summary.trim()}`,
  }
  const inputs = { pre, post: current, table, contract, registry, reqId: request.reqId, eventPr: request.pr }
  const guardProblems = checkClauses(evidence(inputs), step.guards)
  if (guardProblems.length > 0) return { ...base, applied: false, violations: guardProblems }
  const read = (label: string): string => readFileSync(join(cwd, ...label.split('/')), 'utf8')
  const plan = planEffects({
    graph: current,
    table,
    contract,
    registry,
    reqId: request.reqId,
    clauses: step.effects,
    decisions: request.decisions ?? {},
    eventPr: request.pr,
    ownerFor: (role, state) => {
      const seat = seatFor(registry, role, state)
      return seat === undefined ? undefined : String(seat)
    },
    read,
  })
  if (plan.problems.length > 0) return { ...base, applied: false, violations: [...plan.problems] }
  const tasksDir = posix.join(load.dir, TASKS)
  const snapshot = await snapshotTree(cwd, tasksDir)
  await writeAtomically(cwd, plan.writes)
  await archiveDone(cwd, tasksDir, requireReq(graphOf(load), request.reqId))
  const post = graphOf(load)
  const judged = evidence({ ...inputs, post })
  const problems = step.kind === 'transition' ? checkTransition(judged, step.transition) : checkEvent(judged, step.event)
  const violations = [...problems, ...lintWorkspace(cwd, load, request.reqId).violations.map(violationText)]
  if (violations.length > 0) {
    await restoreTree(cwd, snapshot, await snapshotTree(cwd, tasksDir))
    return { ...base, applied: false, violations }
  }
  const after = requireReq(post, request.reqId)
  const diff = diffTree(snapshot, await snapshotTree(cwd, tasksDir))
  return {
    ...base,
    applied: true,
    to: after.status,
    ownerAfter: textOf(after.fm.owner),
    reviewRound: roundOf(after),
    files: [...diff.changed, ...diff.added].sort(),
    violations: [],
  }
}

/**
 * A REQ that reached `done` in a live directory moves to `archive/done`, the
 * only place the lint accepts a done REQ; its TCs, RV, and PL stay where they are.
 */
async function archiveDone(cwd: string, tasksDir: string, req: Req): Promise<void> {
  if (req.status !== DONE || !req.live) return
  const file = req.label.slice(req.label.lastIndexOf('/') + 1)
  const target = join(cwd, ...tasksDir.split('/'), ARCHIVE_DIR, DONE, file)
  await mkdir(dirname(target), { recursive: true })
  await rename(join(cwd, ...req.label.split('/')), target)
}
