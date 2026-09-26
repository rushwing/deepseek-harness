/**
 * Test-case rules: frontmatter typing and references, acceptance coverage
 * with `test_case_ref` synchronisation, body sections, budgets, and
 * expected-result entries, the TC status path per REQ state, and deferred
 * verification from `pr_draft` on.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/tc
 */

import { tcHeadingList } from '../contract.ts'
import { asList } from '../frontmatter.ts'
import { codePointLength, duplicateHeadings, sectionContent, sectionHeadings, visibleLines, visibleSectionContent } from '../text.ts'
import { list, quote, sameSequence, textOf, type LintContext, type Violation } from './context.ts'

const TC_LEVELS: readonly string[] = ['e2e', 'integration', 'unit']
const EVALUATOR = 'evaluator'
const TC_DESIGN = 'tc_design'
const PR_DRAFT = 'pr_draft'
const REQ_IMPL_REVIEW = 'req_impl_review'
const BLOCKED = 'blocked'
const IMPLEMENTED = 'implemented'
const FAILING = 'failing'
const INTEGRATION = 'integration'
const REGRESSION = 'regression'
const CLOSED = 'closed'
const LINE_WIDTH = 24
const ENTRY_BULLET = '- '
const EXPECTATION_SEPARATOR = ':'

function v2ReqIds(ctx: LintContext): ReadonlySet<string> {
  return new Set([...ctx.graph.reqs.values()].filter(req => req.v2).map(req => req.id))
}

/**
 * `automated` and `level` typing, a `linked_req` that resolves to the
 * same-numbered REQ, `verifies` that resolve globally, and for TCs of
 * current-schema REQs a non-empty `verifies` asserted in the expected results
 * and an evaluator owner.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkTcFrontmatter(ctx: LintContext): Violation[] {
  const rule = 'tc-frontmatter'
  const out: Violation[] = []
  const expectedResults = ctx.contract.tc.headings.expectedResults
  const v2 = v2ReqIds(ctx)
  const known = new Set<string>()
  for (const req of ctx.graph.reqs.values()) for (const item of req.acceptance) known.add(item.number)
  for (const tc of ctx.graph.tcs.values()) {
    if (!tc.automatedOk) out.push({ file: tc.label, rule, message: `automated must be a boolean; got ${quote(tc.fm.automated)}` })
    if (!tc.levelOk) out.push({ file: tc.label, rule, message: `level ${quote(tc.fm.level)} is not one of ${list(TC_LEVELS)}` })
    const ref = ctx.graph.resolve(tc.fm.linked_req, 'REQ')
    if (ref.resolved === undefined) {
      out.push({ file: tc.label, rule, message: `linked_req ${quote(textOf(tc.fm.linked_req))} is ${ref.reason}` })
      continue
    }
    if (!tc.numberMatches) out.push({ file: tc.label, rule, message: `tc_id and linked_req ${ref.resolved} carry different numbers; they must agree` })
    for (const item of tc.verifies) {
      if (!known.has(item)) out.push({ file: tc.label, rule, message: `verifies ${item} does not resolve to an existing acceptance criterion` })
    }
    if (!v2.has(ref.resolved)) continue
    if (tc.verifies.length === 0) out.push({ file: tc.label, rule, message: 'verifies is empty; every TC verifies at least one acceptance criterion' })
    const declared = ctx.expectationHeads(tc)
    for (const item of tc.verifies) {
      if (!declared.has(item)) out.push({ file: tc.label, rule, message: `verifies ${item} has no matching entry in ${expectedResults}` })
    }
    if (ctx.registry === undefined) continue
    const owner = textOf(tc.fm.owner)
    const agent = ctx.agents.get(owner)
    if (agent === undefined || agent.role !== EVALUATOR) out.push({ file: tc.label, rule, message: `owner ${quote(owner)} is not a registered evaluator` })
  }
  return out
}

/**
 * Every acceptance criterion of a current-schema REQ past `tc_design` is
 * verified by an own TC or a carried BUG's origin TC that asserts it, and
 * `test_case_ref` lists exactly the own TCs plus carried origin TCs.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkAcCoverage(ctx: LintContext): Violation[] {
  const rule = 'ac-coverage'
  const out: Violation[] = []
  const expectedResults = ctx.contract.tc.headings.expectedResults
  for (const req of ctx.graph.reqs.values()) {
    if (!req.v2 || !ctx.coverageApplies(req) || !ctx.hasLeft(req, TC_DESIGN)) continue
    const carried = ctx.carriedTcs(req)
    const mine = new Set(req.acceptance.map(item => item.number))
    const covered = new Set<string>()
    const own: string[] = []
    for (const tc of ctx.graph.tcs.values()) {
      const owner = ctx.graph.resolveReq(tc.fm.linked_req)
      if (owner === undefined) continue
      if (owner === req) {
        if (tc.wellFormed) {
          own.push(tc.id)
          for (const item of tc.verifies) covered.add(item)
        }
        continue
      }
      const cited = tc.verifies.filter(item => mine.has(item)).sort()
      if (carried.has(tc.id) && tc.wellFormed) {
        const asserted = ctx.expectationHeads(tc)
        for (const item of cited) {
          if (asserted.has(item)) covered.add(item)
          else {
            out.push({ file: req.label, rule, message: `carried BUG's origin TC ${tc.id} lists ${item} in verifies but ${expectedResults} has no matching entry; it does not count as coverage` })
          }
        }
      } else if (cited.length > 0) {
        out.push({ file: req.label, rule, message: `${tc.id} has linked_req ${owner.id} and cites ${list(cited)}; it is not eligible to cover them` })
      }
    }
    for (const number of req.acIds) {
      if (!covered.has(number)) out.push({ file: req.label, rule, message: `acceptance criterion ${number} is not referenced by any TC's verifies` })
    }
    const declared = asList(req.fm.test_case_ref)
    for (const tcId of own) {
      if (!declared.includes(tcId)) out.push({ file: req.label, rule, message: `test_case_ref lacks ${tcId}, whose linked_req names this REQ` })
    }
    for (const tcId of declared) {
      if (!own.includes(tcId) && !carried.has(tcId)) {
        out.push({ file: req.label, rule, message: `test_case_ref lists ${tcId}, which is neither an own TC nor a carried BUG's origin TC` })
      }
    }
  }
  return out
}

/**
 * The four TC sections in order and non-empty, the precondition and body
 * budgets, expected-result entries headed by ids from `verifies`, and the
 * manual-TC facts, for TCs of current-schema REQs and orphan TCs.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkTcBody(ctx: LintContext): Violation[] {
  const rule = 'tc-body'
  const out: Violation[] = []
  const { headings, preconditionBudget, bodyBudget, manualMarker } = ctx.contract.tc
  const expected = tcHeadingList(ctx.contract)
  const nonEmpty = [headings.preconditions, headings.steps, headings.implementationLocation]
  for (const tc of ctx.graph.tcs.values()) {
    const owner = ctx.graph.resolveReq(tc.fm.linked_req)
    if (owner !== undefined && !owner.v2) continue
    const found = sectionHeadings(tc.body)
    if (!sameSequence(found, expected)) {
      out.push({ file: tc.label, rule, message: `H2 headings are not the four sections in order; expected ${list(expected)}, got ${list(found)}` })
    }
    for (const repeated of duplicateHeadings(tc.body)) out.push({ file: tc.label, rule, message: `H2 heading ${quote(repeated)} appears more than once` })
    for (const section of nonEmpty) {
      if (found.includes(section) && visibleSectionContent(tc.body, section) === '') {
        out.push({ file: tc.label, rule, message: `${section} has a heading but no content; it must not be empty` })
      }
    }
    const preconditions = codePointLength(sectionContent(tc.body, headings.preconditions))
    if (preconditions > preconditionBudget) {
      out.push({ file: tc.label, rule, message: `${headings.preconditions} is ${preconditions} characters, over the budget of ${preconditionBudget}` })
    }
    const size = codePointLength(tc.body)
    if (size > bodyBudget) out.push({ file: tc.label, rule, message: `body is ${size} characters, over the budget of ${bodyBudget}` })
    let entries = 0
    for (const line of visibleLines(sectionContent(tc.body, headings.expectedResults))) {
      if (line.trim() === '') continue
      if (line.startsWith(' ') || line.startsWith('\t')) {
        if (entries === 0) {
          out.push({ file: tc.label, rule, message: `indented line ${quote(line.trim().slice(0, LINE_WIDTH))} in ${headings.expectedResults} has no preceding top-level entry` })
        }
        continue
      }
      if (!line.startsWith(ENTRY_BULLET)) {
        out.push({ file: tc.label, rule, message: `${quote(line.trim().slice(0, LINE_WIDTH))} in ${headings.expectedResults} is not an entry starting with an id` })
        continue
      }
      entries += 1
      const entry = line.slice(ENTRY_BULLET.length)
      const separator = entry.indexOf(EXPECTATION_SEPARATOR)
      const head = (separator < 0 ? entry : entry.slice(0, separator)).trim()
      const tail = separator < 0 ? '' : entry.slice(separator + 1)
      if (!tc.verifies.includes(head)) {
        out.push({ file: tc.label, rule, message: `${headings.expectedResults} entry ${quote(head)} does not start with an id from verifies` })
      } else if (tail.trim() === '') {
        out.push({ file: tc.label, rule, message: `${headings.expectedResults} entry ${head} has nothing after its id` })
      }
    }
    if (entries === 0) out.push({ file: tc.label, rule, message: `${headings.expectedResults} has no top-level entry` })
    if (tc.fm.automated === false) {
      if (!sectionContent(tc.body, headings.implementationLocation).includes(manualMarker)) {
        out.push({ file: tc.label, rule, message: `automated is false; ${headings.implementationLocation} must state ${quote(manualMarker)}` })
      }
      if (tc.status === IMPLEMENTED) out.push({ file: tc.label, rule, message: "a manual TC's status cannot be implemented; it stops at reviewed" })
    }
  }
  return out
}

/**
 * Every well-formed own TC of a current-schema REQ has a status the table
 * allows for the REQ's effective state.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkTcStatusPath(ctx: LintContext): Violation[] {
  const rule = 'tc-status'
  const out: Violation[] = []
  for (const req of ctx.graph.reqs.values()) {
    if (!req.v2) continue
    const allowed = ctx.table.tcStatusByState[req.effectiveStatus]
    if (allowed === undefined) continue
    const note = req.status === BLOCKED ? ' (status blocked, judged by the restore target)' : ''
    for (const tc of ctx.graph.tcs.values()) {
      if (ctx.graph.resolveReq(tc.fm.linked_req) !== req || !tc.wellFormed || allowed.includes(tc.status)) continue
      out.push({
        file: tc.label,
        rule,
        message: `status ${quote(tc.status)} is not in the set ${list([...allowed].sort())} allowed while REQ ${req.id} is in ${quote(req.effectiveStatus)}${note}`,
      })
    }
  }
  return out
}

/**
 * From `pr_draft` on, an implemented TC is an integration TC listed in the
 * RV's deferred-verification evidence, and a failing TC is either forbidden
 * (`pr_draft`) or held by an open regression BUG.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkDeferredVerification(ctx: LintContext): Violation[] {
  const rule = 'deferred-verification'
  const out: Violation[] = []
  const evidenceField = ctx.contract.review.evidenceField
  const openRegression = new Set<string>()
  for (const bug of ctx.graph.bugs.values()) {
    if (textOf(bug.fm.found_in) !== REGRESSION || bug.status === CLOSED) continue
    for (const tcId of asList(bug.fm.test_case_ref)) openRegression.add(tcId)
  }
  for (const req of ctx.graph.reqs.values()) {
    if (!req.v2 || !ctx.atOrAfter(req, PR_DRAFT)) continue
    const status = req.effectiveStatus
    const rv = ctx.rvOf(req)
    const section = rv === undefined ? undefined : rv.sections[REQ_IMPL_REVIEW]
    const deferred = section === undefined ? new Set<string>() : section.deferredTcs
    for (const tc of ctx.graph.tcs.values()) {
      if (ctx.graph.resolveReq(tc.fm.linked_req) !== req) continue
      if (tc.status === IMPLEMENTED) {
        if (textOf(tc.fm.level) !== INTEGRATION) out.push({ file: tc.label, rule, message: `REQ ${req.id} is in ${status}; a TC with status implemented must be integration` })
        if (!deferred.has(tc.id)) out.push({ file: tc.label, rule, message: `is not listed in the RV req_impl_review ${evidenceField} deferred-verification entry` })
      }
      if (tc.status === FAILING) {
        if (status === PR_DRAFT) out.push({ file: tc.label, rule, message: 'a pr_draft REQ may not have a failing TC' })
        else if (!openRegression.has(tc.id)) {
          out.push({ file: tc.label, rule, message: 'a failing TC of a done REQ must be listed in the test_case_ref of an open regression BUG' })
        }
      }
    }
  }
  return out
}
