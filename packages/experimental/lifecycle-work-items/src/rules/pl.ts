/**
 * Design-plan (PL) rules: exactly three frontmatter fields agreeing with the
 * file, a same-numbered `linked_req` that resolves, the four fixed H2
 * headings once each in order, and the body budget.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/pl
 */

import { reqOfSameNumber } from '../ids.ts'
import { codePointLength, sectionHeadings } from '../text.ts'
import { list, quote, sameSequence, textOf, type LintContext, type Violation } from './context.ts'

const PL_FIELDS: readonly string[] = ['pl_id', 'tool', 'linked_req']

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.every(item => right.includes(item)) && right.every(item => left.includes(item))
}

/**
 * Every PL of the graph against the plan contract.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkPl(ctx: LintContext): Violation[] {
  const rule = 'pl'
  const out: Violation[] = []
  const { headings: expected, bodyBudget } = ctx.contract.pl
  for (const pl of ctx.graph.pls.values()) {
    for (const field of Object.keys(pl.fm)) {
      if (!PL_FIELDS.includes(field)) out.push({ file: pl.label, rule, message: `frontmatter has extra field ${quote(field)}; only ${list(PL_FIELDS)} are allowed` })
    }
    for (const field of PL_FIELDS) {
      if (!(field in pl.fm)) out.push({ file: pl.label, rule, message: `frontmatter lacks field ${quote(field)}` })
    }
    const id = textOf(pl.fm.pl_id)
    if (id !== pl.id) out.push({ file: pl.label, rule, message: `pl_id ${quote(id)} does not match the file name` })
    const tool = textOf(pl.fm.tool)
    if (tool !== pl.scopeDir) out.push({ file: pl.label, rule, message: `tool ${quote(tool)} does not match the directory ${quote(pl.scopeDir)}` })
    const expectedReq = reqOfSameNumber(pl.id)
    const linked = textOf(pl.fm.linked_req)
    if (linked !== expectedReq) {
      out.push({ file: pl.label, rule, message: `linked_req ${quote(linked)} should be the same-numbered ${expectedReq}` })
    } else if (ctx.graph.reqs.size > 0 && !ctx.graph.reqs.has(linked)) {
      out.push({ file: pl.label, rule, message: `linked_req ${linked} does not resolve to an existing REQ; orphan PL` })
    }
    const found = sectionHeadings(pl.body)
    for (const heading of expected) {
      if (!found.includes(heading)) out.push({ file: pl.label, rule, message: `body lacks fixed H2 heading ${quote(heading)}` })
    }
    for (const heading of found) {
      if (!expected.includes(heading)) out.push({ file: pl.label, rule, message: `body contains H2 heading ${quote(heading)} outside the fixed four` })
    }
    if (!sameSequence(found, expected) && sameSet(found, expected)) {
      out.push({ file: pl.label, rule, message: `the four fixed H2 headings must appear once each in order; got ${list(found)}` })
    }
    const size = codePointLength(pl.body)
    if (size > bodyBudget) out.push({ file: pl.label, rule, message: `body is ${size} characters, over the budget of ${bodyBudget}` })
  }
  return out
}
