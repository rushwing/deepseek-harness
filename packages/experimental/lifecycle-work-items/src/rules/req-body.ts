/**
 * REQ body rules for live REQs on the current schema: the seven H2 sections
 * in order, budgets, acceptance-criterion ids, the implementation lexicon,
 * and the pending-decisions section.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/req-body
 */

import { reqHeadingList } from '../contract.ts'
import { isIsoDate } from '../frontmatter.ts'
import { acIdParts } from '../ids.ts'
import { INLINE_CODE, blankLinkTargets } from '../markdown-links.ts'
import {
  codePointLength,
  duplicateHeadings,
  sectionContent,
  sectionHeadings,
  sectionSlices,
  visibleLines,
  visibleSectionContent,
} from '../text.ts'
import { list, quote, sameSequence, textOf, type LintContext, type Violation } from './context.ts'

const H2 = '## '
const H3 = '### '
const START_OF_BODY = '(start of body)'
const FENCE = '```'
const REVIEW_STATE = 'req_review'
const LINE_WIDTH = 24
const SEGMENT_WIDTH = 12
const ENTRY_LABEL_WIDTH = 20
const QUESTION = 'question'
const SEGMENT_SEPARATOR = '|'
const Q_ENTRY = /^- \*\*Q-\d{2}\*\* \(([^,)]*),\s*([^,)]*)\)(.*)$/
const Q_ID = /Q-\d{2}/
const ISO_DATE_IN_TEXT = /\d{4}-\d{2}-\d{2}/g

/**
 * The seven H2 sections in order, no banned or repeated heading, at least one
 * acceptance entry, a non-empty non-goals section, and H3 headings only inside the behavior section.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkReqBody(ctx: LintContext): Violation[] {
  const rule = 'req-body'
  const out: Violation[] = []
  const { headings, bannedHeadings } = ctx.contract.req
  const expected = reqHeadingList(ctx.contract)
  for (const req of ctx.graph.reqs.values()) {
    if (!ctx.bodyRulesApply(req)) continue
    const found = sectionHeadings(req.body)
    for (const heading of found) {
      if (bannedHeadings.includes(heading)) out.push({ file: req.label, rule, message: `contains banned H2 heading ${quote(heading)}` })
    }
    if (!sameSequence(found, expected)) {
      out.push({ file: req.label, rule, message: `H2 headings are not the seven sections in order; expected ${list(expected)}, got ${list(found)}` })
    }
    for (const repeated of duplicateHeadings(req.body)) out.push({ file: req.label, rule, message: `H2 heading ${quote(repeated)} appears more than once` })
    if (req.acceptance.length === 0) {
      out.push({ file: req.label, rule, message: `${headings.acceptance} has no '- **AC-…**' entry; an empty set is not a verifiable requirement` })
    }
    if (visibleSectionContent(req.body, headings.nonGoals) === '') out.push({ file: req.label, rule, message: `${headings.nonGoals} must not be empty` })
    let current = START_OF_BODY
    for (const line of visibleLines(req.body)) {
      if (line.startsWith(H2)) {
        current = line.slice(H2.length).trim()
      } else if (line.startsWith(H3) && current !== headings.behavior) {
        out.push({ file: req.label, rule, message: `H3 heading ${quote(line.slice(H3.length).trim())} appears inside ${current}; only ${headings.behavior} may contain H3 headings` })
      }
    }
  }
  return out
}

/**
 * Section, body, and acceptance-item budgets in code points.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkReqBudgets(ctx: LintContext): Violation[] {
  const rule = 'req-budgets'
  const out: Violation[] = []
  const { sectionBudgets, bodyBudget, acceptanceEntryBudget } = ctx.contract.req
  for (const req of ctx.graph.reqs.values()) {
    if (!ctx.bodyRulesApply(req)) continue
    const slices = sectionSlices(req.body)
    for (const [section, budget] of Object.entries(sectionBudgets)) {
      const raw = slices[section]
      if (raw === undefined) continue
      const size = codePointLength(raw)
      if (size > budget) out.push({ file: req.label, rule, message: `section ${quote(section)} is ${size} characters, over the budget of ${budget}` })
    }
    const size = codePointLength(req.body)
    if (size > bodyBudget) out.push({ file: req.label, rule, message: `body is ${size} characters, over the budget of ${bodyBudget}` })
    for (const item of req.acceptance) {
      const length = codePointLength(item.text)
      if (length > acceptanceEntryBudget) {
        out.push({ file: req.label, rule, message: `acceptance item ${item.label} is ${length} characters, over the budget of ${acceptanceEntryBudget}` })
      }
    }
  }
  return out
}

/**
 * Acceptance-criterion ids: the bold `AC-<PREFIX>-NNN-SS` form with the
 * owning REQ's prefix and number, increasing within a live REQ, and unique
 * across every REQ of the tree, archived and legacy ones included.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkAcIds(ctx: LintContext): Violation[] {
  const rule = 'ac-ids'
  const out: Violation[] = []
  const heading = ctx.contract.req.headings.acceptance
  const seen = new Map<string, string>()
  for (const req of ctx.graph.reqs.values()) {
    const inScope = ctx.bodyRulesApply(req)
    const expectedNumber = req.id.slice(req.id.lastIndexOf('-') + 1)
    let previous = 0
    const local = new Set<string>()
    for (const item of req.acceptance) {
      const parts = item.wellFormed ? acIdParts(item.number) : undefined
      if (parts === undefined) {
        if (inScope) {
          out.push({ file: req.label, rule, message: `top-level entry ${quote(item.head)} in ${heading} is not of the form - **AC-<PREFIX>-NNN-SS** (bold, starting with AC, a space after **)` })
        }
        continue
      }
      if (inScope && (parts.prefix !== req.prefix || parts.req !== expectedNumber)) {
        out.push({ file: req.label, rule, message: `acceptance id ${item.number} must be AC-<PREFIX>-NNN-SS with the owning REQ's prefix and number` })
      }
      const owner = seen.get(item.number)
      if (local.has(item.number)) {
        out.push({ file: req.label, rule, message: `acceptance id ${item.number} is duplicated within this REQ` })
      } else if (owner !== undefined) {
        out.push({ file: req.label, rule, message: `acceptance id ${item.number} duplicates ${owner}; ids are unique across the tasks tree` })
      }
      local.add(item.number)
      if (owner === undefined) seen.set(item.number, req.label)
      if (inScope && item.order <= previous) {
        out.push({ file: req.label, rule, message: `acceptance id ${item.number} does not increase (the previous item was ${String(previous).padStart(2, '0')})` })
      }
      previous = Math.max(previous, item.order)
    }
  }
  return out
}

function stripAllowed(text: string, allowed: ReadonlySet<string>): string {
  return blankLinkTargets(text).replace(INLINE_CODE, (whole, inner: string) => (allowed.has(inner) ? ' ' : whole))
}

/**
 * `intent`, `acceptance`, and every section except the design references
 * hit none of the implementation lexicon and carry no code fence.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkHowLexicon(ctx: LintContext): Violation[] {
  const rule = 'how-lexicon'
  const out: Violation[] = []
  const { designReferences } = ctx.contract.req.headings
  const allowed = new Set(ctx.contract.lexicon.allowedTerms)
  const categories = Object.entries(ctx.contract.lexicon.categories)
    .map(([category, patterns]) => [category, patterns.map(pattern => new RegExp(pattern))] as const)
  for (const req of ctx.graph.reqs.values()) {
    if (!ctx.bodyRulesApply(req)) continue
    const targets: [where: string, raw: string][] = [['intent', textOf(req.fm.intent)], ['acceptance', textOf(req.fm.acceptance)]]
    for (const [section, raw] of Object.entries(sectionSlices(req.body))) {
      if (section !== designReferences) targets.push([section, raw])
    }
    for (const [where, raw] of targets) {
      const cleaned = stripAllowed(raw, allowed)
      for (const [category, patterns] of categories) {
        for (const pattern of patterns) {
          const found = pattern.exec(cleaned)
          if (found === null) continue
          out.push({ file: req.label, rule, message: `${where} hits the implementation lexicon ${quote(category)}: ${quote(found[0])}` })
          break
        }
      }
      if (raw.includes(FENCE)) out.push({ file: req.label, rule, message: `${where} contains a code fence; only ${designReferences} allows one` })
    }
  }
  return out
}

function questionProblems(file: string, line: string, names: readonly string[], out: Violation[]): void {
  const rule = 'pending-decisions'
  const id = Q_ID.exec(line)
  const label = id === null ? line.slice(0, ENTRY_LABEL_WIDTH) : id[0]
  const head = Q_ENTRY.exec(line)
  if (head === null) {
    const [, options, fallback, deadline] = names
    out.push({ file, rule, message: `entry ${quote(label)} is malformed; it should be - **Q-NN** (proposer, YYYY-MM-DD) question | ${String(options)} … | ${String(fallback)} … | ${String(deadline)} YYYY-MM-DD` })
    return
  }
  const who = String(head[1])
  const when = String(head[2])
  if (who.trim() === '') out.push({ file, rule, message: `entry ${label} has an empty proposer; the parentheses must name a person` })
  if (!isIsoDate(when)) out.push({ file, rule, message: `entry ${label} proposal date ${quote(when)} is not a valid calendar date` })
  const segments = String(head[3]).split(SEGMENT_SEPARATOR).map(segment => segment.trim())
  if (segments.length !== names.length) {
    out.push({ file, rule, message: `entry ${label} has ${segments.length} segments; it must have exactly four: ${names.join(` ${SEGMENT_SEPARATOR} `)}` })
    return
  }
  for (const [index, segment] of segments.entries()) {
    const name = String(names[index])
    if (segment === '') {
      out.push({ file, rule, message: `entry ${label} segment ${quote(name)} is empty` })
    } else if (index > 0 && !segment.startsWith(name)) {
      out.push({ file, rule, message: `entry ${label} segment ${index + 1} ${quote(segment.slice(0, SEGMENT_WIDTH))} does not start with ${quote(name)}` })
    } else if (index > 0 && segment.slice(name.length).trim() === '') {
      out.push({ file, rule, message: `entry ${label} segment ${quote(name)} has only its label and no content` })
    }
  }
  const deadline = String(segments[segments.length - 1])
  if (deadline !== '' && ![...deadline.matchAll(ISO_DATE_IN_TEXT)].some(match => isIsoDate(match[0]))) {
    out.push({ file, rule, message: `entry ${label} deadline ${quote(deadline)} has no valid YYYY-MM-DD date` })
  }
}

/**
 * The pending-decisions section is exactly the none word, or every non-blank
 * line is a well-formed `Q-NN` entry, and only a REQ in review may carry entries.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkPendingDecisions(ctx: LintContext): Violation[] {
  const rule = 'pending-decisions'
  const out: Violation[] = []
  const heading = ctx.contract.req.headings.pendingDecisions
  const none = ctx.contract.words.none
  const labels = ctx.contract.req.pendingDecisionLabels
  const names = [QUESTION, labels.options, labels.default, labels.deadline]
  for (const req of ctx.graph.reqs.values()) {
    if (!ctx.bodyRulesApply(req)) continue
    const content = sectionContent(req.body, heading)
    const stripped = content.trim()
    if (stripped === '' || stripped === none) continue
    if (req.effectiveStatus !== REVIEW_STATE) {
      out.push({ file: req.label, rule, message: `${heading} is not ${quote(none)} while status is ${quote(req.status)}; only ${REVIEW_STATE} may have pending decisions` })
    }
    let entries = 0
    for (const line of visibleLines(content)) {
      if (line.trim() === '') continue
      if (line.startsWith(' ') || line.startsWith('\t')) {
        if (entries === 0) out.push({ file: req.label, rule, message: `indented line ${quote(line.trim().slice(0, LINE_WIDTH))} in ${heading} has no preceding top-level Q-NN entry` })
        continue
      }
      if (!line.startsWith('-')) {
        out.push({ file: req.label, rule, message: `${quote(line.trim().slice(0, LINE_WIDTH))} in ${heading} is not a Q-NN entry; the section is either exactly ${quote(none)} or every non-blank line is an entry` })
        continue
      }
      entries += 1
      questionProblems(req.label, line.trim(), names, out)
    }
    if (entries === 0) out.push({ file: req.label, rule, message: `${heading} is not ${quote(none)} yet has no top-level Q-NN entry` })
  }
  return out
}
