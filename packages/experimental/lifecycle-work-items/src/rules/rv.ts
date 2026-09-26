/**
 * Review-record rules: the RV exists once a REQ is reviewed and mirrors its
 * REQ, sections carry one well-formed conclusion and the fixed fields in
 * order, signers match the table's gates and the round matches
 * `review_round`, the gates a state requires have PASSed with substantive
 * evidence, budgets hold, regression lines agree with TC and BUG facts, and
 * the optional external-review section parses.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/rv
 */

import type { Req, Rv, Tc } from '../artifacts.ts'
import { asList, isIsoDate } from '../frontmatter.ts'
import { REGRESSION_SECTION, type RegressionLine, type ReviewSection } from '../review.ts'
import { codePointLength, duplicateHeadings, sectionHeadings, sectionSlices, visibleLines } from '../text.ts'
import { list, quote, sameSequence, textOf, type LintContext, type Violation } from './context.ts'

const EXTERNAL_REVIEW = 'external_review'
const REQ_REVIEW = 'req_review'
const REQ_IMPL_REVIEW = 'req_impl_review'
const TC_IMPL_REVIEW = 'tc_impl_review'
const REQ_IMPL = 'req_impl'
const PR_DRAFT = 'pr_draft'
const SUPERSEDED = 'archive/superseded'
const EVALUATOR = 'evaluator'
const OPTIONAL = 'optional'
const PASSING = 'passing'
const FAILING = 'failing'
const CLOSED = 'closed'
const REGRESSION = 'regression'
const CHECKED = 'x'
const EXTERNAL_REVIEW_SIGNERS: readonly string[] = ['evaluator', 'human']
const EXTERNAL_REVIEW_COLUMNS = 6
const REGRESSION_RESULTS: readonly string[] = ['passed', 'failed']
const REGRESSION_OPEN_BUG = /^passed \((BUG-[A-Z]+-\d{3}) open\)$/
const RESULT_PASSED = /(?<![A-Za-z])passed(?![A-Za-z])/
const RESULT_FAILED = /(?<![A-Za-z])failed(?![A-Za-z])/
const DIGIT = /\d/
const ISO_DATE_IN_TEXT = /\d{4}-\d{2}-\d{2}/g
const AC_ID_IN_TEXT = /AC-[A-Z]+-\d{3}-\d{2}/g
const ARTIFACT_ID_IN_TEXT = /(?:AC|TC|REQ|BUG|RV|PL)-[A-Z]+-\d{3}(?:-\d{2})?/g
const TOKEN_TAIL = /^[A-Za-z0-9-]/
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/
const TABLE_EDGE = /^\|+|\|+$/g
const EVIDENCE_TRIM = /^[\s,.;:()]+|[\s,.;:()]+$/g

function gateNames(ctx: LintContext): string[] {
  return ctx.table.gates.map(gate => gate.section)
}

function malformedHint(ctx: LintContext): string {
  const { conclusionLabel, verdicts } = ctx.contract.review
  return `it should be '${conclusionLabel} ${verdicts.pass} | ${verdicts.reject} (round N, YYYY-MM-DD, UID)'`
}

function rvRequired(ctx: LintContext, req: Req): boolean {
  const round = req.fm.review_round
  return (typeof round === 'number' && Number.isInteger(round) && round >= 1) || ctx.hasLeft(req, REQ_REVIEW)
}

function fieldText(section: ReviewSection, label: string): string {
  const text = section.fields[label]
  return text === undefined ? '' : text
}

function startsWithToken(entry: string, token: string): boolean {
  return entry.startsWith(token) && !TOKEN_TAIL.test(entry.slice(token.length))
}

/** Independent evidence entries: top-level visible lines with their bullet removed. */
function evidenceEntries(evidence: string): string[] {
  const entries: string[] = []
  for (const line of visibleLines(evidence)) {
    if (line.startsWith(' ') || line.startsWith('\t')) continue
    const entry = line.trim().replace(/^- /, '').trim()
    if (entry !== '') entries.push(entry)
  }
  return entries
}

function hasEvidence(number: string, entries: readonly string[]): boolean {
  return entries.some(entry => startsWithToken(entry, number) && entry.replace(AC_ID_IN_TEXT, '').replace(EVIDENCE_TRIM, '') !== '')
}

function isManualEvidence(entry: string, tcId: string): boolean {
  if (!startsWithToken(entry, tcId) || RESULT_FAILED.test(entry) || !RESULT_PASSED.test(entry)) return false
  return DIGIT.test(entry.replace(ARTIFACT_ID_IN_TEXT, '').replace(ISO_DATE_IN_TEXT, ''))
}

/**
 * The RV of every current-schema REQ exists once required, mirrors the REQ's
 * id and scope, carries only allowed sections once each, and every gate
 * section opens with exactly one well-formed conclusion followed by the fixed fields in order.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkRvStructure(ctx: LintContext): Violation[] {
  const rule = 'rv-structure'
  const out: Violation[] = []
  const { conclusionLabel, fields } = ctx.contract.review
  const gates = gateNames(ctx)
  const allowed = [...gates, REGRESSION_SECTION, EXTERNAL_REVIEW]
  for (const req of ctx.graph.reqs.values()) {
    if (!req.v2) continue
    const rv = ctx.rvOf(req)
    if (rv === undefined) {
      if (rvRequired(ctx, req)) {
        out.push({ file: ctx.rvLabel(req), rule, message: `REQ ${req.id} has review rounds or has left req_review; the same-numbered RV is missing` })
      }
      continue
    }
    const id = textOf(rv.fm.rv_id)
    if (id !== rv.id) out.push({ file: rv.label, rule, message: `rv_id ${quote(id)} does not match the file name` })
    const tool = textOf(rv.fm.tool)
    if (tool !== rv.scopeDir) out.push({ file: rv.label, rule, message: `tool ${quote(tool)} does not match the directory ${quote(rv.scopeDir)}` })
    const linked = textOf(rv.fm.linked_req)
    if (linked !== req.id) out.push({ file: rv.label, rule, message: `linked_req ${quote(linked)} is not the same-numbered REQ` })
    if (rv.scopeDir !== req.tool) {
      out.push({ file: rv.label, rule, message: `RV sits in directory ${quote(rv.scopeDir)}; it must match REQ ${req.id}'s scope ${quote(req.tool)}` })
    }
    for (const heading of sectionHeadings(rv.body)) {
      if (!allowed.includes(heading)) out.push({ file: rv.label, rule, message: `contains H2 heading ${quote(heading)} outside the allowed review sections` })
    }
    for (const repeated of duplicateHeadings(rv.body)) {
      out.push({ file: rv.label, rule, message: `section ${quote(repeated)} appears more than once; a section shows only the latest round` })
    }
    for (const [gate, section] of Object.entries(rv.sections)) {
      if (!gates.includes(gate) && gate !== EXTERNAL_REVIEW) continue
      if (!section.firstItem.startsWith(conclusionLabel)) {
        out.push({ file: rv.label, rule, message: `section ${quote(gate)} does not open with a ${conclusionLabel} line; its first item is ${quote(section.firstItem)}` })
      }
      if (section.conclusions.length > 1) out.push({ file: rv.label, rule, message: `section ${quote(gate)} has ${section.conclusions.length} conclusion lines; exactly one` })
      else if (section.verdict === '') out.push({ file: rv.label, rule, message: `section ${quote(gate)} conclusion line is malformed; ${malformedHint(ctx)}` })
      for (const label of fields) {
        if (!(label in section.fields)) out.push({ file: rv.label, rule, message: `section ${quote(gate)} lacks fixed field ${quote(label)}` })
      }
      const present = fields.filter(label => section.fieldOrder.includes(label))
      if (!sameSequence(section.fieldOrder, present)) {
        out.push({ file: rv.label, rule, message: `section ${quote(gate)} fixed fields are out of order; got ${list(section.fieldOrder)}, expected ${list(fields)}` })
      }
    }
  }
  return out
}

function checklistProblems(ctx: LintContext, rv: Rv, gate: string, section: ReviewSection, out: Violation[]): void {
  const rule = 'rv-signatures'
  const count = ctx.contract.review.checklistCount
  const listed = section.checks.map(([, number]) => number)
  const last = `CHK${String(count).padStart(2, '0')}`
  if (gate !== REQ_REVIEW) {
    if (listed.length > 0) out.push({ file: rv.label, rule, message: `fixed items CHK01–${last} belong only in req_review; found in ${quote(gate)}` })
    return
  }
  const expected = Array.from({ length: count }, (_, index) => `CHK${String(index + 1).padStart(2, '0')}`)
  const missing = expected.filter(number => !listed.includes(number))
  if (missing.length > 0) out.push({ file: rv.label, rule, message: `section 'req_review' lacks fixed items ${list(missing)}` })
  const repeated = [...new Set(listed.filter((number, index) => listed.indexOf(number) !== index))].sort()
  if (repeated.length > 0) out.push({ file: rv.label, rule, message: `section 'req_review' fixed items ${list(repeated)} appear more than once` })
  const unexpected = [...new Set(listed.filter(number => !expected.includes(number)))].sort()
  if (unexpected.length > 0) out.push({ file: rv.label, rule, message: `section 'req_review' has unexpected fixed items ${list(unexpected)}` })
  const pass = ctx.contract.review.verdicts.pass
  if (section.verdict !== pass) return
  const unchecked = section.checks.filter(([mark]) => mark !== CHECKED).map(([, number]) => number)
  if (unchecked.length > 0) out.push({ file: rv.label, rule, message: `section 'req_review' concludes ${pass} but ${list(unchecked)} are unchecked` })
}

/**
 * Every gate section is signed by a registered agent of the gate's role, the
 * `req_review` round equals the REQ's `review_round`, and the fixed
 * checklist items appear once each in `req_review` only, all checked under PASS.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkRvSignatures(ctx: LintContext): Violation[] {
  const rule = 'rv-signatures'
  const out: Violation[] = []
  for (const req of ctx.graph.reqs.values()) {
    const rv = ctx.rvOf(req)
    if (!req.v2 || rv === undefined) continue
    for (const gate of ctx.table.gates) {
      const section = rv.sections[gate.section]
      if (section === undefined) continue
      if (section.verdict === '') {
        if (section.conclusions.length > 0) {
          out.push({ file: rv.label, rule, message: `section ${quote(gate.section)} conclusion line ${quote(String(section.conclusions[0]))} is malformed; ${malformedHint(ctx)} with no trailing text` })
        }
        checklistProblems(ctx, rv, gate.section, section, out)
        continue
      }
      if (ctx.registry !== undefined) {
        const agent = ctx.agents.get(section.uid)
        if (agent === undefined || agent.role !== gate.signer) {
          out.push({ file: rv.label, rule, message: `section ${quote(gate.section)} conclusion is signed by ${quote(section.uid)}; a registered ${gate.signer} must sign` })
        }
      }
      if (gate.section === REQ_REVIEW) {
        const declared = req.fm.review_round
        if (section.round === undefined) out.push({ file: rv.label, rule, message: "section 'req_review' conclusion line must state the round" })
        else if (typeof declared === 'number' && Number.isInteger(declared) && declared !== section.round) {
          out.push({ file: rv.label, rule, message: `section 'req_review' round ${section.round} does not equal the REQ review_round ${declared}` })
        }
      }
      checklistProblems(ctx, rv, gate.section, section, out)
    }
  }
  return out
}

function exemptEvidenceProblems(ctx: LintContext, req: Req, rv: Rv | undefined, out: Violation[]): void {
  const { evidenceField, verdicts } = ctx.contract.review
  if (req.tcPolicy !== OPTIONAL || rv === undefined || rv.exemptionReason === '') return
  const section = rv.sections[REQ_IMPL_REVIEW]
  if (section === undefined || section.verdict !== verdicts.pass) return
  const entries = evidenceEntries(fieldText(section, evidenceField))
  const missing = req.acIds.filter(number => !hasEvidence(number, entries))
  if (missing.length > 0) {
    out.push({ file: req.label, rule: 'rv-gate-pass', message: `a REQ without TCs lacks req_impl_review ${evidenceField} entries for acceptance criteria ${list(missing)}` })
  }
}

function manualEvidenceProblems(ctx: LintContext, req: Req, rv: Rv | undefined, out: Violation[]): void {
  const { evidenceField } = ctx.contract.review
  if (!ctx.atOrAfter(req, PR_DRAFT)) return
  const section = rv === undefined ? undefined : rv.sections[REQ_IMPL_REVIEW]
  const entries = evidenceEntries(section === undefined ? '' : fieldText(section, evidenceField))
  const carried = ctx.carriedTcs(req)
  for (const tc of ctx.graph.tcs.values()) {
    if (tc.fm.automated !== false || tc.status !== PASSING) continue
    if (ctx.graph.resolveReq(tc.fm.linked_req) !== req && !carried.has(tc.id)) continue
    if (entries.some(entry => isManualEvidence(entry, tc.id))) continue
    out.push({
      file: req.label,
      rule: 'rv-gate-pass',
      message: `manual TC ${tc.id} is passing but the req_impl_review ${evidenceField} has no entry starting with its id that states the result and a key number`,
    })
  }
}

/**
 * The gates a REQ's effective state requires have PASSed, PASS sections
 * carry a review scope and evidence (with a number for `req_impl_review`),
 * a waived optional REQ declares its waiver and shows per-criterion
 * evidence, and every passing manual TC has an evidence entry.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkRvGatePass(ctx: LintContext): Violation[] {
  const rule = 'rv-gate-pass'
  const out: Violation[] = []
  const { scopeField, evidenceField, exemptionMarker, verdicts } = ctx.contract.review
  const gates = gateNames(ctx)
  for (const req of ctx.graph.reqs.values()) {
    if (!req.v2) continue
    const rv = ctx.rvOf(req)
    const sections: Readonly<Record<string, ReviewSection>> = rv === undefined ? {} : rv.sections
    for (const gate of [...ctx.requiredGatesOf(req)].sort()) {
      const section = sections[gate]
      if (section === undefined) {
        out.push({ file: req.label, rule, message: `status ${quote(req.status)} requires RV section ${quote(gate)} to have ${verdicts.pass}ed; the section is missing` })
        continue
      }
      if (section.verdict !== verdicts.pass) {
        const verdict = section.verdict === '' ? '(no well-formed conclusion line)' : section.verdict
        out.push({ file: req.label, rule, message: `status ${quote(req.status)} requires section ${quote(gate)} ${verdicts.pass}; it is ${verdict}` })
      }
    }
    for (const [gate, section] of Object.entries(sections)) {
      if (!gates.includes(gate) || section.verdict !== verdicts.pass) continue
      for (const field of [scopeField, evidenceField]) {
        if (fieldText(section, field).trim() === '') out.push({ file: req.label, rule, message: `section ${quote(gate)} concludes ${verdicts.pass} but ${field} is empty after the colon` })
      }
      if (gate === REQ_IMPL_REVIEW && !DIGIT.test(fieldText(section, evidenceField))) {
        out.push({ file: req.label, rule, message: `section 'req_impl_review' ${verdicts.pass} evidence must contain at least one entry with a number` })
      }
    }
    const waived = rv !== undefined && rv.exemptionReason !== ''
    if (req.tcPolicy === OPTIONAL && ctx.atOrAfter(req, REQ_IMPL) && !(TC_IMPL_REVIEW in sections) && !waived) {
      out.push({ file: req.label, rule, message: `an optional REQ without TCs (T03c) needs a ${quote(exemptionMarker)} line in the RV req_review section` })
    }
    exemptEvidenceProblems(ctx, req, rv, out)
    manualEvidenceProblems(ctx, req, rv, out)
  }
  return out
}

function regressionFacts(ctx: LintContext, rv: Rv, line: RegressionLine, tc: Tc, out: Violation[]): void {
  const rule = 'rv-regression'
  const open = REGRESSION_OPEN_BUG.exec(line.result)
  if (open === null) {
    if (!REGRESSION_RESULTS.includes(line.result)) return
    const expected = line.result === 'passed' ? PASSING : FAILING
    if (tc.status !== expected) {
      out.push({ file: rv.label, rule, message: `regression line records ${line.result}, but ${line.tc}'s status is ${quote(tc.status)} (expected ${expected})` })
    }
    return
  }
  const bugId = String(open[1])
  const bug = ctx.graph.bugs.get(bugId)
  if (bug === undefined) {
    out.push({ file: rv.label, rule, message: `regression line ${line.tc} cites ${bugId}, which does not resolve to an existing BUG` })
    return
  }
  const reasons: string[] = []
  if (bug.status === CLOSED) reasons.push('is closed')
  if (textOf(bug.fm.found_in) !== REGRESSION) reasons.push(`has found_in ${quote(textOf(bug.fm.found_in))}, not regression`)
  if (!asList(bug.fm.test_case_ref).includes(line.tc)) reasons.push(`has a test_case_ref without ${line.tc}`)
  if (tc.status === PASSING) reasons.push(`leaves ${line.tc} still passing`)
  if (reasons.length > 0) out.push({ file: rv.label, rule, message: `regression line ${line.tc} records ${quote(line.result)}, but ${bugId} ${reasons.join('; ')}` })
}

function regressionProblems(ctx: LintContext, rv: Rv, out: Violation[]): void {
  const rule = 'rv-regression'
  const seen = new Map<string, number>()
  const hasTcs = ctx.graph.tcs.size > 0
  for (const line of rv.regression) {
    if (!line.wellFormed) {
      out.push({ file: rv.label, rule, message: `regression line ${quote(line.raw)} does not have five segments (date | UID | sample | TC | result)` })
      continue
    }
    if (!isIsoDate(line.when)) out.push({ file: rv.label, rule, message: `regression line date ${quote(line.when)} is not a valid YYYY-MM-DD` })
    if (!REGRESSION_RESULTS.includes(line.result) && !REGRESSION_OPEN_BUG.test(line.result)) {
      out.push({ file: rv.label, rule, message: `regression line result ${quote(line.result)} is illegal; only passed, failed, or passed (BUG-… open)` })
    }
    if (ctx.registry !== undefined) {
      const agent = ctx.agents.get(line.uid)
      if (agent === undefined) out.push({ file: rv.label, rule, message: `regression line UID ${quote(line.uid)} is not registered in agent-registry.yml` })
      else if (agent.role !== EVALUATOR) {
        out.push({ file: rv.label, rule, message: `regression line ${line.tc} UID ${quote(line.uid)} is not an evaluator; only evaluators run regressions` })
      }
    }
    if (line.sample === '') out.push({ file: rv.label, rule, message: `regression line ${quote(line.raw)} has an empty sample segment` })
    if (hasTcs) {
      const tc = ctx.graph.tcs.get(line.tc)
      if (tc === undefined) out.push({ file: rv.label, rule, message: `regression line ${line.tc} does not resolve to an existing TC` })
      else regressionFacts(ctx, rv, line, tc, out)
    }
    const count = seen.get(line.tc)
    seen.set(line.tc, count === undefined ? 1 : count + 1)
  }
  for (const [tcId, count] of [...seen].sort()) {
    if (count > 1) out.push({ file: rv.label, rule, message: `${tcId} appears ${count} times in the regression section; keep only the latest run per TC` })
  }
}

/**
 * Awaiting-sample conclusions only in `req_impl_review` while the REQ stays
 * there, the section, regression, and body budgets, and the regression
 * lines' syntax and facts, for the RV of every current-schema REQ that is not superseded.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkRvBudgets(ctx: LintContext): Violation[] {
  const rule = 'rv-budgets'
  const out: Violation[] = []
  const { sectionBudget, bodyBudget, regressionBudget, verdicts } = ctx.contract.review
  for (const req of ctx.graph.reqs.values()) {
    const rv = ctx.rvOf(req)
    if (!req.v2 || req.location === SUPERSEDED || rv === undefined) continue
    for (const [gate, section] of Object.entries(rv.sections)) {
      if (section.verdict === verdicts.awaitingSample) {
        if (gate !== REQ_IMPL_REVIEW) out.push({ file: rv.label, rule, message: `${quote(verdicts.awaitingSample)} may conclude only req_impl_review; found in ${quote(gate)}` })
        else if (req.status !== REQ_IMPL_REVIEW) {
          out.push({ file: rv.label, rule, message: `${quote(verdicts.awaitingSample)} requires the REQ to stay in req_impl_review; it is ${quote(req.status)}` })
        }
      }
      const size = codePointLength(section.raw)
      if (size > sectionBudget) out.push({ file: rv.label, rule, message: `section ${quote(gate)} is ${size} characters, over the budget of ${sectionBudget}` })
    }
    const regressionRaw = sectionSlices(rv.body)[REGRESSION_SECTION]
    const regressionSize = regressionRaw === undefined ? 0 : codePointLength(regressionRaw)
    if (regressionSize > regressionBudget) {
      out.push({ file: rv.label, rule, message: `section 'regression' is ${regressionSize} characters, over the budget of ${regressionBudget}` })
    }
    regressionProblems(ctx, rv, out)
    const rest = codePointLength(rv.body) - regressionSize
    if (rest > bodyBudget) out.push({ file: rv.label, rule, message: `body without the regression section is ${rest} characters, over the budget of ${bodyBudget}` })
  }
  return out
}

function plainCell(text: string): string {
  return text.replaceAll('`', '').trim()
}

/**
 * An `external_review` section's findings table has six-column rows with a
 * disposition, and its conclusion is signed by a human or evaluator role.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkRvExternalReview(ctx: LintContext): Violation[] {
  const rule = 'rv-external-review'
  const out: Violation[] = []
  for (const rv of ctx.graph.rvs.values()) {
    const section = rv.sections[EXTERNAL_REVIEW]
    if (section === undefined) continue
    const rows = visibleLines(section.raw).filter(line => line.trimStart().startsWith('|') && !TABLE_SEPARATOR.test(line.trim()))
    if (rows.length === 1) out.push({ file: rv.label, rule, message: "section 'external_review' declares a findings table but no finding row parses" })
    for (const [offset, row] of rows.slice(1).entries()) {
      const index = offset + 2
      const cells = row.trim().replace(TABLE_EDGE, '').split('|').map(cell => cell.trim())
      if (cells.length !== EXTERNAL_REVIEW_COLUMNS) {
        out.push({ file: rv.label, rule, message: `section 'external_review' row ${index} has ${cells.length} columns; the findings table has exactly ${EXTERNAL_REVIEW_COLUMNS}` })
        continue
      }
      if (plainCell(String(cells[EXTERNAL_REVIEW_COLUMNS - 1])) === '') out.push({ file: rv.label, rule, message: `section 'external_review' row ${index} has an empty Disposition` })
    }
    const { uid } = section
    if (uid === '') continue
    const agent = ctx.agents.get(uid)
    const role = ctx.registry === undefined ? String(uid.split('-')[0]) : agent === undefined ? '' : agent.role
    if (!EXTERNAL_REVIEW_SIGNERS.includes(role)) {
      out.push({ file: rv.label, rule, message: `section 'external_review' conclusion is signed by ${quote(uid)}; only ${list(EXTERNAL_REVIEW_SIGNERS)} roles may sign` })
    }
  }
  return out
}
