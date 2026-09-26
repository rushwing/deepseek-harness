/**
 * Write scopes: the artifact kinds a role may write at a REQ state, and the
 * judgement of one workspace path against a scope. The kinds mirror "What to
 * write and where" in the role briefs; the post-step diff and the tool guard
 * both judge through {@link denialOf}.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/scope
 */

import { posix } from 'node:path'
import { asList, textOf, type ArtifactGraph, type ArtifactKind } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** What one role child may write during one step. */
export interface WriteScope {
  readonly role: string
  readonly state: string
  readonly reqId: string
  /** Artifact kinds the child may create or edit, always bound to the REQ. */
  readonly kinds: readonly ArtifactKind[]
}

/** Artifact kinds by `role@state`; a missing key allows no artifact write. */
export const WRITE_KINDS: Readonly<Record<string, readonly ArtifactKind[]>> = {
  'planner@req_review': ['REQ', 'PL'],
  'evaluator@req_review': ['RV', 'BUG'],
  'evaluator@tc_design': ['TC', 'REQ'],
  'evaluator@tc_impl_review': ['RV', 'BUG'],
  'evaluator@req_impl_review': ['RV', 'BUG'],
  'generator@tc_review': ['RV'],
  'generator@tc_impl': ['TC'],
  'generator@req_impl': ['BUG', 'TC'],
}

const KIND_BY_DIR: Readonly<Record<string, ArtifactKind>> = { features: 'REQ', 'test-cases': 'TC', bugs: 'BUG', reviews: 'RV', plans: 'PL' }
const ARCHIVE = 'archive'
const REQ_PREFIX = 'REQ-'
const MD = '.md'

/**
 * The write scope of a role at a state on a REQ.
 * @param role - the acting role.
 * @param state - the REQ state the role works in.
 * @param reqId - the REQ.
 * @returns the scope; empty kinds when the pair is not a writing role state.
 */
export function writeScope(role: string, state: string, reqId: string): WriteScope {
  const kinds = WRITE_KINDS[`${role}@${state}`]
  return { role, state, reqId, kinds: kinds === undefined ? [] : kinds }
}

function reason(scope: WriteScope, label: string, why: string): string {
  return `${label}: outside the write scope of ${scope.role} @ ${scope.state} on ${scope.reqId} (${why})`
}

/** A BUG the tree already knew belongs to the REQ when it is carried by or blocks it; an unknown file is judged after the step. */
function bugBound(pre: ArtifactGraph, label: string, reqId: string): boolean {
  if (pre.nodeFor(label) === undefined) return true
  return [...pre.carriedBugsOf(reqId), ...pre.blockingBugsOf(reqId)].some(bug => bug.label === label)
}

function boundTo(kind: ArtifactKind, id: string, scope: WriteScope, label: string, pre: ArtifactGraph): boolean {
  const suffix = scope.reqId.slice(REQ_PREFIX.length)
  switch (kind) {
    case 'REQ':
      return id === scope.reqId
    case 'RV':
      return id === `RV-${suffix}`
    case 'PL':
      return id === `PL-${suffix}`
    case 'TC':
      return id.startsWith(`TC-${suffix}-`)
    case 'BUG':
      return bugBound(pre, label, scope.reqId)
    /* v8 ignore next 2 -- closed-union exhaustiveness guard */
    default:
      return assertNever(kind)
  }
}

/**
 * Judge one workspace-relative path against a scope.
 * @param scope - the step's write scope.
 * @param label - the path relative to the workspace, POSIX separators.
 * @param tasksDir - the artifact tree relative to the workspace, such as `lifecycle/tasks`.
 * @param pre - the tree before the step, which binds existing BUGs.
 * @returns the denial reason, or `undefined` when the write is allowed: every path outside the lifecycle directory, and
 * in-scope artifacts inside the tree; the tables, standards, and briefs beside the tree are always denied.
 */
export function denialOf(scope: WriteScope, label: string, tasksDir: string, pre: ArtifactGraph): string | undefined {
  if (!label.startsWith(`${tasksDir}/`)) {
    return label.startsWith(`${posix.dirname(tasksDir)}/`) ? reason(scope, label, 'the tables, standards, and briefs are read-only for a role child') : undefined
  }
  const rest = label.slice(tasksDir.length + 1)
  const dir = rest.slice(0, Math.max(rest.indexOf('/'), 0))
  const kind = KIND_BY_DIR[dir]
  if (kind === undefined) return reason(scope, label, dir === ARCHIVE ? 'archived artifacts are read-only' : 'not an artifact directory')
  if (!scope.kinds.includes(kind)) {
    return reason(scope, label, scope.kinds.length === 0 ? 'this role writes no artifact at this state' : `may write ${scope.kinds.join(', ')} only`)
  }
  const file = rest.slice(rest.lastIndexOf('/') + 1)
  const id = file.endsWith(MD) ? file.slice(0, -MD.length) : ''
  return boundTo(kind, id, scope, label, pre) ? undefined : reason(scope, label, `${file} is not an artifact of ${scope.reqId}`)
}

/**
 * A BUG file the step created must name the REQ as its origin, carrier, or blocked REQ.
 * @param post - the tree after the step.
 * @param label - the new file's workspace-relative path.
 * @param reqId - the REQ of the step.
 * @returns the problem, or `undefined` when the BUG binds to the REQ.
 */
export function unboundBug(post: ArtifactGraph, label: string, reqId: string): string | undefined {
  const node = post.nodeFor(label)
  if (node === undefined || node.kind !== 'BUG') return `${label}: a new file under bugs/ is not a well-formed BUG`
  const bound = textOf(node.fm.origin_req) === reqId || textOf(node.fm.linked_req) === reqId || asList(node.fm.blocks_req).includes(reqId)
  return bound ? undefined : `${label}: ${node.id} names ${reqId} neither as origin_req or linked_req nor in blocks_req`
}
