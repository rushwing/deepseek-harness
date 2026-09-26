/**
 * Effect application: the frontmatter and regression-line edits a
 * transition's or event's effects require, planned as whole-file writes over
 * the tree the step's child left behind. Review-record effects are verified,
 * never written.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/apply
 */

import type { AgentRegistry, LifecycleTable, PredicateClause } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import { parseDocument } from 'yaml'
import type { Artifact, Req } from './artifacts.ts'
import type { ArtifactContract } from './contract.ts'
import { list, quote, textOf } from './format.ts'
import { FRONTMATTER_BLOCK, asList, positiveInt, scalar } from './frontmatter.ts'
import type { ArtifactGraph } from './graph.ts'
import { evidence, restorePairFor, type Evidence } from './predicates.ts'
import { REGRESSION_SECTION } from './review.ts'

/** The choices a step leaves to its proposer, read by the effects that admit more than one outcome. */
export interface StepDecisions {
  /** Values for `req.fields_set` effects, by field name. */
  readonly fields?: Readonly<Record<string, unknown>>
  /** TC id to status for `tc.status_to` effects; when absent, a single-valued effect applies to every TC in scope. */
  readonly tcStatuses?: Readonly<Record<string, string>>
  /** BUG id to status for `bug.status_to` effects; when absent, a single-valued effect applies to every BUG in scope. */
  readonly bugStatuses?: Readonly<Record<string, string>>
}

/** One whole-file write, addressed by the workspace-relative POSIX path every artifact label carries. */
export interface FileWrite {
  readonly path: string
  readonly text: string
}

/** What planning the effects of one step reads. */
export interface EffectPlanInputs {
  /** The tree after the child's edits and before the effects. */
  readonly graph: ArtifactGraph
  readonly table: LifecycleTable
  readonly contract: ArtifactContract
  readonly registry?: AgentRegistry | undefined
  readonly reqId: string
  /** The transition's or event's effects, in table order. */
  readonly clauses: readonly PredicateClause[]
  readonly decisions: StepDecisions
  /** The pull-request number the step carries, for `req.pr_number_eq_event`. */
  readonly eventPr?: number | undefined
  /** The uid that takes a role at a REQ state, or `undefined` when no agent does. */
  ownerFor(role: string, state: string): string | undefined
  /** The current text of a workspace file by its label. */
  read(label: string): string
}

/** The planned writes, or the problems that prevent any write. */
export interface EffectPlan {
  /** Whole-file writes; empty whenever `problems` is not. */
  readonly writes: readonly FileWrite[]
  readonly problems: readonly string[]
}

const RESTORE_STATE = 'restore_state'
const RESTORE_OWNER = 'restore_owner'
const LIST_FIELDS: readonly string[] = ['pending_bugs', 'test_case_ref', 'depends_on']
const OWN = 'own'
const OWN_AND_CARRIED = 'own_and_carried'
const CARRIED = 'carried'
const ANY = 'any'
const SCOPES: Readonly<Record<'TC' | 'BUG', readonly string[]>> = { TC: [OWN, OWN_AND_CARRIED, ANY], BUG: [CARRIED, ANY] }
const H2 = '## '

/**
 * Rewrite frontmatter fields, keeping the document's other fields, their
 * order, quoting, and comments, and the body byte for byte. Lists are
 * written in flow style.
 * @param text - the complete artifact text.
 * @param edits - field to new value; arrays become flow sequences.
 * @returns the rewritten text.
 * @throws when the text has no frontmatter block.
 */
export function editFrontmatter(text: string, edits: Readonly<Record<string, unknown>>): string {
  const match = FRONTMATTER_BLOCK.exec(text)
  if (match === null) throw new Error('missing YAML frontmatter')
  const document = parseDocument(String(match[1]), { uniqueKeys: true })
  for (const [key, value] of Object.entries(edits)) {
    document.set(key, Array.isArray(value) ? document.createNode(value, { flow: true }) : value)
  }
  return `---\n${document.toString({ lineWidth: 0 })}---\n${text.slice(match[0].length)}`
}

/**
 * Remove the regression lines that cite any of the given TCs.
 * @param text - a review record's complete text.
 * @param tcIds - the TC ids whose lines are withdrawn.
 * @returns the text without those lines.
 */
export function withdrawRegression(text: string, tcIds: readonly string[]): string {
  let inRegression = false
  return text.split('\n').filter((line) => {
    if (line.startsWith(H2)) {
      inRegression = line.slice(H2.length).trim() === REGRESSION_SECTION
      return true
    }
    return !(inRegression && tcIds.some(tc => line.includes(tc)))
  }).join('\n')
}

function argList(clause: PredicateClause, name: string): string[] {
  return asList(clause.args[name])
}

function argText(clause: PredicateClause, name: string): string {
  return textOf(clause.args[name])
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

interface Planner {
  readonly inputs: EffectPlanInputs
  readonly req: Req
  readonly step: Evidence
  readonly problems: string[]
  readonly reqEdits: Record<string, unknown>
  readonly statuses: Map<Artifact, string>
  status: string
  withdraw: boolean
}

function scopeNodes(planner: Planner, kind: 'TC' | 'BUG', scope: string, clause: PredicateClause): readonly Artifact[] {
  const { graph, reqId } = planner.inputs
  if (kind === 'BUG') return scope === ANY ? [...graph.bugs.values()] : graph.carriedBugsOf(reqId)
  if (scope === ANY) return [...graph.tcs.values()]
  const origin = planner.step.carriedOriginTcs()
  const own = graph.ownTcsOf(reqId)
  const base = clause.args.exclude_carried_origin === true ? own.filter(tc => !origin.has(tc.id)) : own
  return scope === OWN_AND_CARRIED ? [...base, ...[...graph.tcs.values()].filter(tc => origin.has(tc.id))] : base
}

function statusEffect(planner: Planner, clause: PredicateClause, kind: 'TC' | 'BUG'): void {
  const onlyRestore = scalar(clause.args.only_restore)
  if (onlyRestore !== undefined && restorePairFor(planner.step)[0] !== onlyRestore) return
  const scope = argText(clause, 'scope')
  if (!SCOPES[kind].includes(scope)) {
    planner.problems.push(`${clause.name}: unknown scope ${quote(scope)}; ${kind} scopes are ${list(SCOPES[kind])}`)
    return
  }
  const allowed = argList(clause, 'to')
  const from = argList(clause, 'from')
  const members = new Map(scopeNodes(planner, kind, scope, clause).map(node => [node.id, node]))
  const decided = kind === 'TC' ? planner.inputs.decisions.tcStatuses : planner.inputs.decisions.bugStatuses
  if (decided !== undefined) {
    for (const [id, next] of Object.entries(decided)) {
      const node = members.get(id)
      if (node === undefined) planner.problems.push(`${clause.name}: ${id} is outside this effect's scope (${scope})`)
      else if (!allowed.includes(next)) planner.problems.push(`${clause.name}: ${id} status ${quote(next)} is not one of ${list(allowed)}`)
      else if (node.status !== next) planner.statuses.set(node, next)
    }
    return
  }
  if (allowed.length === 1) {
    const next = String(allowed[0])
    for (const node of members.values()) {
      if ((from.length === 0 || from.includes(node.status)) && node.status !== next) planner.statuses.set(node, next)
    }
    return
  }
  if (clause.args.optional !== true) planner.problems.push(`${clause.name}: decide a status for each ${kind} in scope ${scope}; allowed ${list(allowed)}`)
}

function applyClause(planner: Planner, clause: PredicateClause): void {
  const { inputs, req, step, problems, reqEdits } = planner
  switch (clause.name) {
    case 'req.status_to': {
      const declared = argText(clause, 'state')
      planner.status = declared === RESTORE_STATE ? step.restorePair()[0] : declared
      reqEdits.status = planner.status
      break
    }
    case 'req.owner_role_to': {
      const declared = argText(clause, 'role')
      const role = declared === RESTORE_OWNER ? step.restorePair()[1] : declared
      const uid = inputs.ownerFor(role, planner.status)
      if (uid === undefined) problems.push(`${clause.name}: no agent takes role ${role} at ${planner.status}`)
      else reqEdits.owner = uid
      break
    }
    case 'req.counter_inc': {
      const field = argText(clause, 'field')
      if (field === '') {
        problems.push(`${clause.name}: the field argument is missing`)
        break
      }
      const onlyFrom = scalar(clause.args.only_from)
      if (onlyFrom === undefined || req.status === onlyFrom) reqEdits[field] = numberOf(req.fm[field]) + 1
      break
    }
    case 'req.pr_number_eq_event': {
      const policy = scalar(clause.args.policy)
      const applies = (policy === undefined || req.tcPolicy === policy) && inputs.eventPr !== undefined
      if (applies && !positiveInt(req.fm.pr_number)) reqEdits.pr_number = inputs.eventPr
      break
    }
    case 'req.fields_set':
      for (const field of argList(clause, 'fields')) {
        const value = inputs.decisions.fields === undefined ? undefined : inputs.decisions.fields[field]
        if (asList(value).length === 0) problems.push(`${clause.name}: no value decided for ${field}`)
        else reqEdits[field] = value
      }
      break
    case 'req.fields_cleared':
      for (const field of argList(clause, 'fields')) reqEdits[field] = LIST_FIELDS.includes(field) ? [] : ''
      break
    case 'req.restore_pair_set': {
      const [state, owner] = restorePairFor(step)
      reqEdits.blocked_from_status = state
      reqEdits.blocked_from_owner = owner
      break
    }
    case 'req.restore_pair_to':
      reqEdits.blocked_from_status = argText(clause, 'state')
      reqEdits.blocked_from_owner = argText(clause, 'owner')
      break
    case 'tc.status_to':
      statusEffect(planner, clause, 'TC')
      break
    case 'bug.status_to':
      statusEffect(planner, clause, 'BUG')
      break
    case 'rv.gate_signed':
    case 'rv.section_changed':
      break
    case 'rv.regression_withdrawn': {
      const onlyRestore = scalar(clause.args.only_restore)
      if (onlyRestore === undefined || restorePairFor(step)[0] === onlyRestore) planner.withdraw = true
      break
    }
    default:
      problems.push(`${clause.name}: no such effect can be applied`)
  }
}

/**
 * Plan the writes that apply a step's effects: REQ frontmatter (status,
 * owner, counters, `pr_number`, blocked fields, restore pair), TC and BUG
 * statuses in scope, and regression-line withdrawal. Effects that admit
 * several values take their choice from `decisions`; a single-valued status
 * effect without decisions applies to every artifact in scope.
 * @param inputs - the tree, tables, clauses, decisions, and resolvers.
 * @returns the writes, or the problems that keep the step from being applied.
 */
export function planEffects(inputs: EffectPlanInputs): EffectPlan {
  const { graph, reqId } = inputs
  const req = graph.reqs.get(reqId)
  if (req === undefined) return { writes: [], problems: [`${reqId}: not in the tree`] }
  const planner: Planner = {
    inputs,
    req,
    step: evidence({
      pre: graph,
      post: graph,
      table: inputs.table,
      contract: inputs.contract,
      registry: inputs.registry,
      reqId,
      eventPr: inputs.eventPr,
    }),
    problems: [],
    reqEdits: {},
    statuses: new Map(),
    status: req.status,
    withdraw: false,
  }
  for (const clause of inputs.clauses) applyClause(planner, clause)
  if (planner.problems.length > 0) return { writes: [], problems: planner.problems }
  const writes: FileWrite[] = []
  if (Object.keys(planner.reqEdits).length > 0) {
    writes.push({ path: req.label, text: editFrontmatter(inputs.read(req.label), planner.reqEdits) })
  }
  for (const [node, status] of planner.statuses) {
    writes.push({ path: node.label, text: editFrontmatter(inputs.read(node.label), { status }) })
  }
  if (planner.withdraw) {
    const own = graph.ownTcsOf(reqId).map(tc => tc.id)
    for (const rv of graph.rvs.values()) {
      const text = inputs.read(rv.label)
      const edited = withdrawRegression(text, own)
      if (edited !== text) writes.push({ path: rv.label, text: edited })
    }
  }
  return { writes, problems: [] }
}
