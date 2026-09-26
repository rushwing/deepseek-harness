/**
 * Lifecycle-consistency rules across artifacts: `tc_policy` exits and their
 * consequences, blocking and carried BUG binding, BUG frontmatter
 * references, BUG closure requirements, and the closed-BUG loop back to a
 * passing TC and a naming acceptance criterion.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/lifecycle
 */

import { reachableStates } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import type { Bug, Req } from '../artifacts.ts'
import { asList, positiveInt, scalar } from '../frontmatter.ts'
import { idShapeOf, type ArtifactKind } from '../ids.ts'
import { list, quote, textOf, type LintContext, type Violation } from './context.ts'

const EXEMPT = 'exempt'
const OPTIONAL = 'optional'
const OPTIONAL_NO_TC = 'optional_no_tc'
const REQ_REVIEW = 'req_review'
const TC_DESIGN = 'tc_design'
const REQ_IMPL_REVIEW = 'req_impl_review'
const PR_DRAFT = 'pr_draft'
const DONE = 'done'
const RESOLVED = 'resolved'
const CLOSED = 'closed'
const PASSING = 'passing'
const REGRESSION = 'regression'
const REQ_BUG = 'req_bug'
const BUG_TYPES: readonly string[] = ['impl_bug', 'req_bug', 'tc_bug']
const HIGH_SEVERITIES: readonly string[] = ['high', 'critical']
const BUG_REF_FIELDS: readonly string[] = ['linked_req', 'blocks_req', 'found_in', 'test_case_ref']
const SCALAR_REF_FIELDS: readonly string[] = ['linked_req', 'origin_req']
const BUG_REFERENCES: readonly (readonly [field: string, kind: ArtifactKind])[] = [
  ['linked_req', 'REQ'],
  ['origin_req', 'REQ'],
  ['blocks_req', 'REQ'],
  ['test_case_ref', 'TC'],
]

function namesBug(text: string, bugId: string): boolean {
  return new RegExp(`(?<![\\w-])${bugId}(?![\\w-])`).test(text)
}

function acsNaming(req: Req, bugId: string): string[] {
  return req.acceptance.filter(item => namesBug(item.text, bugId)).map(item => item.number)
}

/** Whether a BUG is bound to a current-schema REQ, or to no resolvable REQ at all. */
function bugInScope(ctx: LintContext, bug: Bug): boolean {
  const targets = [...asList(bug.fm.linked_req), ...asList(bug.fm.origin_req), ...asList(bug.fm.blocks_req)]
  const resolved = targets.flatMap((id) => {
    const req = ctx.graph.reqs.get(id)
    return req === undefined ? [] : [req]
  })
  return resolved.length === 0 || resolved.some(req => req.v2)
}

/** The one closure exception: a `req_bug` without TCs or a carrier that blocks only exempt REQs. */
function exemptBugException(ctx: LintContext, bug: Bug): boolean {
  const blocks = asList(bug.fm.blocks_req)
  if (textOf(bug.fm.bug_type) !== REQ_BUG || blocks.length === 0) return false
  if (scalar(bug.fm.linked_req) !== undefined || asList(bug.fm.test_case_ref).length > 0) return false
  return blocks.every((id) => {
    const req = ctx.graph.reqs.get(id)
    return req !== undefined && req.tcPolicy === EXEMPT
  })
}

/**
 * Exempt REQs stop only in their reachable states, carry no BUG or TC, and
 * set `pr_number` from `pr_draft`; other REQs set `pr_number` from
 * `req_impl_review`; a waived optional REQ states a reason and has no BUG or TC either.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkTcPolicyExit(ctx: LintContext): Violation[] {
  const rule = 'tc-policy'
  const out: Violation[] = []
  const marker = ctx.contract.review.exemptionMarker
  for (const req of ctx.graph.reqs.values()) {
    if (!req.v2) continue
    const rv = ctx.rvOf(req)
    const carriers = ctx.graph.carriedBugs.get(req.id)
    const carried = carriers === undefined ? [] : carriers
    const owned = ctx.graph.ownTcs.get(req.id)
    const own = owned === undefined ? [] : owned
    const prNumber = positiveInt(req.fm.pr_number)
    const declared = asList(req.fm.test_case_ref)
    const effective = req.effectiveStatus
    if (req.tcPolicy === EXEMPT) {
      const stops = [...reachableStates(ctx.table, EXEMPT)].sort()
      if (!stops.includes(effective)) out.push({ file: req.label, rule, message: `an exempt REQ may only stop in ${list(stops)}; it is in ${quote(effective)}` })
      if (ctx.atOrAfter(req, PR_DRAFT) && !prNumber) out.push({ file: req.label, rule, message: 'an exempt REQ needs pr_number from pr_draft on' })
      for (const bugId of carried) out.push({ file: req.label, rule, message: `an exempt REQ carries no BUG; ${bugId}'s linked_req names it` })
      if (own.length > 0) out.push({ file: req.label, rule, message: `an exempt REQ has no TC; ${list(own)} have linked_req naming it` })
      if (declared.length > 0) out.push({ file: req.label, rule, message: `an exempt REQ's test_case_ref must be empty; it is ${list(declared)}` })
      continue
    }
    if (ctx.atOrAfter(req, REQ_IMPL_REVIEW) && !prNumber) out.push({ file: req.label, rule, message: 'pr_number must be set from req_impl_review on' })
    if (req.tcPolicy !== OPTIONAL || rv === undefined || !rv.exemptionDeclared) continue
    if (rv.exemptionReason === '') out.push({ file: req.label, rule, message: `the RV ${quote(marker)} line has nothing after the colon; the reason must have substance` })
    const stops = [...reachableStates(ctx.table, OPTIONAL_NO_TC)].sort()
    if (!stops.includes(effective)) out.push({ file: req.label, rule, message: `an optional REQ without TCs may only stop in ${list(stops)}; it is in ${quote(effective)}` })
    if (carried.length > 0) out.push({ file: req.label, rule, message: `an optional REQ carrying ${String(carried[0])} must take T03; the RV may not carry a ${quote(marker)} line` })
    if (own.length > 0) out.push({ file: req.label, rule, message: `the RV declares ${quote(marker)} yet TCs ${list(own)} have linked_req naming this REQ` })
    if (declared.length > 0) out.push({ file: req.label, rule, message: `the RV declares ${quote(marker)} yet test_case_ref is ${list(declared)}` })
  }
  return out
}

/**
 * Blocking BUGs are listed in `pending_bugs` until closed, and carried BUGs
 * follow the REQ: not closed in `req_review`, resolved or closed in
 * `req_impl_review`, closed from `pr_draft`, named by an acceptance
 * criterion after `req_review`, and bound to TCs after `tc_design`.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkBugBinding(ctx: LintContext): Violation[] {
  const rule = 'bug-binding'
  const out: Violation[] = []
  for (const req of ctx.graph.reqs.values()) {
    if (!req.v2) continue
    const pending = new Set(asList(req.fm.pending_bugs))
    const effective = req.effectiveStatus
    for (const bug of ctx.graph.bugs.values()) {
      const selfCarried = ctx.graph.resolveReq(bug.fm.linked_req) === req
      const blocksMe = asList(bug.fm.blocks_req).includes(req.id)
      const exception = selfCarried && bug.status === RESOLVED && effective === REQ_REVIEW
      if (blocksMe && bug.status !== CLOSED && !exception && !pending.has(bug.id)) {
        out.push({ file: req.label, rule, message: `${bug.id} blocks this REQ with status ${quote(bug.status)} but is not listed in pending_bugs` })
      }
      if (!selfCarried) continue
      if (effective === REQ_REVIEW && bug.status === CLOSED) {
        out.push({ file: req.label, rule, message: `REQ is in req_review; carried ${bug.id} may not be closed (verification happens at T13)` })
      }
      if (effective === REQ_IMPL_REVIEW && bug.status !== RESOLVED && bug.status !== CLOSED) {
        out.push({ file: req.label, rule, message: `REQ is in req_impl_review; carried ${bug.id} should be resolved or closed, it is ${quote(bug.status)}` })
      }
      if (ctx.atOrAfter(req, PR_DRAFT) && bug.status !== CLOSED) {
        out.push({ file: req.label, rule, message: `REQ is in ${effective}; carried ${bug.id} must be closed, it is ${quote(bug.status)}` })
      }
      if (ctx.hasLeft(req, REQ_REVIEW) && acsNaming(req, bug.id).length === 0) {
        out.push({ file: req.label, rule, message: `REQ has left req_review, yet no acceptance criterion names carried ${bug.id}` })
      }
      if (ctx.hasLeft(req, TC_DESIGN) && asList(bug.fm.test_case_ref).length === 0) {
        out.push({ file: req.label, rule, message: `REQ has left tc_design, yet carried ${bug.id} has an empty test_case_ref` })
      }
    }
  }
  return out
}

/**
 * Reference fields present and scalar where required, `severity`,
 * `bug_type`, and `found_in` legal, and every referenced REQ or TC existing,
 * for BUGs bound to current-schema or unresolvable REQs.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkBugFrontmatter(ctx: LintContext): Violation[] {
  const rule = 'bug-frontmatter'
  const out: Violation[] = []
  const severities = [...ctx.contract.bug.severities].sort()
  const foundIn = [...ctx.reqStatuses, REGRESSION].sort()
  const enumerations: readonly (readonly [field: string, legal: readonly string[]])[] = [['severity', severities], ['bug_type', BUG_TYPES], ['found_in', foundIn]]
  for (const bug of ctx.graph.bugs.values()) {
    if (!bugInScope(ctx, bug)) continue
    for (const field of BUG_REF_FIELDS) {
      if (!(field in bug.fm)) out.push({ file: bug.label, rule, message: `missing frontmatter field ${quote(field)}` })
    }
    for (const field of SCALAR_REF_FIELDS) {
      const value = bug.fm[field]
      if (asList(value).length > 0 && typeof value !== 'string') out.push({ file: bug.label, rule, message: `${field} must be a scalar REQ id; it is ${JSON.stringify(value)}` })
    }
    for (const [field, legal] of enumerations) {
      if (field in bug.fm && !legal.includes(textOf(bug.fm[field]))) {
        out.push({ file: bug.label, rule, message: `${field} ${quote(textOf(bug.fm[field]))} is illegal; legal values ${list(legal)}` })
      }
    }
    for (const [field, kind] of BUG_REFERENCES) {
      for (const item of asList(bug.fm[field])) {
        if (!idShapeOf(kind).test(item)) out.push({ file: bug.label, rule, message: `${field} item ${item} does not match the ${kind} id format` })
        else if (ctx.graph.resolve(item, kind).resolved === undefined) out.push({ file: bug.label, rule, message: `${field} item ${item} does not resolve to an existing artifact` })
      }
    }
  }
  return out
}

/**
 * A `req_bug` of a done legacy REQ is resolved or closed, and a high or
 * critical BUG closes only with TCs, save for the exempt-REQ exception.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkBugClosure(ctx: LintContext): Violation[] {
  const rule = 'bug-closure'
  const out: Violation[] = []
  for (const bug of ctx.graph.bugs.values()) {
    const linked = scalar(bug.fm.linked_req)
    const target = linked === undefined ? undefined : ctx.graph.reqs.get(linked)
    const settled = bug.status === RESOLVED || bug.status === CLOSED
    if (target !== undefined && !target.v2 && target.status === DONE && textOf(bug.fm.bug_type) === REQ_BUG && !settled) {
      out.push({ file: bug.label, rule, message: `linked_req names the done legacy REQ ${target.id}; a req_bug's status must be resolved or closed, it is ${quote(bug.status)}` })
    }
    const severity = textOf(bug.fm.severity)
    if (!HIGH_SEVERITIES.includes(severity) || !settled || asList(bug.fm.test_case_ref).length > 0) continue
    if (!exemptBugException(ctx, bug)) {
      out.push({
        file: bug.label,
        rule,
        message: `a ${quote(severity)} BUG in ${bug.status} needs a non-empty test_case_ref (sole exception: a req_bug blocking only exempt REQs with an empty linked_req)`,
      })
    }
  }
  return out
}

/**
 * A closed BUG's listed TCs are passing unless an open regression BUG holds
 * them, and for BUGs in scope the loop closes: a listed TC verifies an
 * acceptance criterion of the carrier that names the BUG.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkBugClosedConsistency(ctx: LintContext): Violation[] {
  const rule = 'bug-closed'
  const out: Violation[] = []
  for (const bug of ctx.graph.bugs.values()) {
    if (bug.status !== CLOSED) continue
    const openRegression = new Set<string>()
    for (const other of ctx.graph.bugs.values()) {
      if (other === bug || textOf(other.fm.found_in) !== REGRESSION || other.status === CLOSED) continue
      for (const tcId of asList(other.fm.test_case_ref)) openRegression.add(tcId)
    }
    const listed = asList(bug.fm.test_case_ref)
    for (const tcId of listed) {
      const tc = ctx.graph.tcs.get(tcId)
      if (tc === undefined || openRegression.has(tcId)) continue
      if (tc.status !== PASSING) out.push({ file: bug.label, rule, message: `is closed, but listed ${tcId} has status ${quote(tc.status)} (expected passing)` })
    }
    if (ctx.graph.reqs.size === 0 || !bugInScope(ctx, bug) || exemptBugException(ctx, bug)) continue
    const carrier = ctx.graph.resolveReq(bug.fm.linked_req)
    const naming = carrier === undefined ? [] : acsNaming(carrier, bug.id)
    const verified = new Set<string>()
    for (const tcId of listed) {
      const tc = ctx.graph.tcs.get(tcId)
      if (tc === undefined) continue
      const heads = ctx.expectationHeads(tc)
      for (const number of tc.verifies) if (heads.has(number)) verified.add(number)
    }
    if (naming.length === 0) out.push({ file: bug.label, rule, message: 'is closed, but no acceptance criterion names it; the loop is not closed' })
    else if (!naming.some(number => verified.has(number))) {
      out.push({ file: bug.label, rule, message: `is closed, but no listed TC's verifies contains an acceptance criterion naming it ${list(naming)}` })
    }
  }
  return out
}
