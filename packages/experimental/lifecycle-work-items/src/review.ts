/**
 * Review-record (RV) structure: gate sections with their conclusion line,
 * fixed fields, checklist items, and deferred-verification entries, and the
 * regression section's result lines.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/review
 */

import { isIsoDate } from './frontmatter.ts'
import { sectionSlices, splitLines, visibleLines } from './text.ts'

/** The review sections a gate and the regression section never share a name with. */
export const REGRESSION_SECTION = 'regression'
const TC_ID_IN_TEXT = /TC-[A-Z]+-\d{3}-\d{2}/g
const CHK_ITEM = /^- \[( |x)\] (CHK\d+)\b/
const REGRESSION_SEGMENTS = 5
const REGRESSION_SEPARATOR = '|'

/** The fixed labels a review record uses; the artifact contract supplies them. */
export interface ReviewVocabulary {
  /** The conclusion line prefix, for example `Conclusion:`. */
  readonly conclusionLabel: string
  /** The verdict words in order: pass, reject, awaiting sample. */
  readonly verdicts: readonly [pass: string, reject: string, awaitingSample: string]
  /** The fixed field labels in their required order, without the colon. */
  readonly fieldLabels: readonly string[]
  /** The field label whose entries carry evidence (deferred and awaiting-sample TCs). */
  readonly evidenceLabel: string
  /** The top-line prefix that declares a TC waiver reason in `req_review`. */
  readonly exemptionMarker: string
  /** The evidence-entry prefix whose line lists deferred-verification TCs. */
  readonly deferredMarker: string
}

/** The review vocabulary of the English artifact contract. */
export const DEFAULT_REVIEW_VOCABULARY: ReviewVocabulary = {
  conclusionLabel: 'Conclusion:',
  verdicts: ['PASS', 'REJECT', 'AWAITING SAMPLE'],
  fieldLabels: ['Review scope', 'Evidence', 'Findings', 'Pending human-001'],
  evidenceLabel: 'Evidence',
  exemptionMarker: 'TC waiver reason:',
  deferredMarker: 'Deferred verification:',
}

/** One parsed gate or external-review section. */
export interface ReviewSection {
  readonly name: string
  /** The raw slice including the heading line. */
  readonly raw: string
  /** The first non-blank visible line, trimmed. */
  readonly firstItem: string
  /** Every visible line that starts with the conclusion label, trimmed. */
  readonly conclusions: readonly string[]
  /** The verdict of the single well-formed conclusion, else empty. */
  readonly verdict: string
  /** The round of the single well-formed conclusion when it declares one. */
  readonly round: number | undefined
  readonly signedDate: string
  readonly uid: string
  /** Whether exactly one well-formed conclusion opens the section. */
  readonly conclusionOk: boolean
  /** Field label to its text, newline-joined and trimmed. */
  readonly fields: Readonly<Record<string, string>>
  /** The field labels in the order they appear. */
  readonly fieldOrder: readonly string[]
  /** Checklist items as `[mark, number]`. */
  readonly checks: readonly (readonly [string, string])[]
  /** Non-indented visible lines, trimmed. */
  readonly topLines: readonly string[]
  /** The text after the exemption marker on a top line, else empty. */
  readonly exemptionReason: string
  /** Whether a top line starts with the exemption marker. */
  readonly exemptionDeclared: boolean
  /** TC ids named by deferred-verification evidence entries. */
  readonly deferredTcs: ReadonlySet<string>
}

/** One line of the regression section. */
export interface RegressionLine {
  readonly raw: string
  readonly segments: readonly string[]
  readonly wellFormed: boolean
  readonly when: string
  readonly uid: string
  readonly sample: string
  readonly tc: string
  readonly result: string
}

/** A parsed review record body. */
export interface Review {
  /** Every section except the regression section, by heading. */
  readonly sections: Readonly<Record<string, ReviewSection>>
  readonly regression: readonly RegressionLine[]
  /** One gate section by name. */
  gate(name: string): ReviewSection | undefined
  /** The `req_review` waiver reason, else empty. */
  readonly exemptionReason: string
  /** Whether `req_review` declares a waiver. */
  readonly exemptionDeclared: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function conclusionPattern(vocabulary: ReviewVocabulary): RegExp {
  const verdicts = vocabulary.verdicts.map(escapeRegExp).join('|')
  return new RegExp(`^${escapeRegExp(vocabulary.conclusionLabel)} (${verdicts}) \\((?:round (\\d+), )?(\\d{4}-\\d{2}-\\d{2}), ([a-z]+-\\d{3})\\)$`)
}

function fieldPattern(vocabulary: ReviewVocabulary): RegExp {
  return new RegExp(`^(${vocabulary.fieldLabels.map(escapeRegExp).join('|')}): ?(.*)$`)
}

function isTopLevel(line: string): boolean {
  return line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')
}

function deferredTcsOf(evidence: string, marker: string): ReadonlySet<string> {
  const found = new Set<string>()
  for (const line of visibleLines(evidence)) {
    if (!isTopLevel(line)) continue
    const entry = line.trim().replace(/^- /, '')
    if (!entry.startsWith(marker)) continue
    for (const match of entry.matchAll(TC_ID_IN_TEXT)) found.add(match[0])
  }
  return found
}

/**
 * Parse one review section from its raw slice.
 * @param name - the section heading.
 * @param raw - the slice including the heading line.
 * @param vocabulary - the fixed labels.
 * @returns the parsed section.
 */
export function parseReviewSection(name: string, raw: string, vocabulary: ReviewVocabulary): ReviewSection {
  const rawLines = splitLines(raw).slice(1)
  const lines = visibleLines(rawLines.join('\n'))
  while (lines.length < rawLines.length) lines.push('')
  const conclusionLabel = vocabulary.conclusionLabel
  const first = lines.find(line => line.trim() !== '')
  const firstItem = first === undefined ? '' : first.trim()
  const conclusions = lines.map(line => line.trim()).filter(line => line.startsWith(conclusionLabel))
  let verdict = ''
  let round: number | undefined
  let signedDate = ''
  let uid = ''
  const only = conclusions.length === 1 ? conclusionPattern(vocabulary).exec(String(conclusions[0])) : null
  if (only !== null && isIsoDate(String(only[3]))) {
    verdict = String(only[1])
    round = only[2] === undefined ? undefined : Number(only[2])
    signedDate = String(only[3])
    uid = String(only[4])
  }
  const fields: Record<string, string> = {}
  const fieldOrder: string[] = []
  const checks: (readonly [string, string])[] = []
  const topLines: string[] = []
  const fieldLine = fieldPattern(vocabulary)
  let open: { readonly label: string; readonly buffer: string[] } | undefined
  const close = (): void => {
    if (open !== undefined) fields[open.label] = open.buffer.join('\n').trim()
  }
  for (const line of lines) {
    const stripped = line.trim()
    if (isTopLevel(line)) topLines.push(stripped)
    const check = CHK_ITEM.exec(stripped)
    if (check !== null) checks.push([String(check[1]), String(check[2])])
    const field = fieldLine.exec(line)
    if (field !== null) {
      close()
      const label = String(field[1])
      fieldOrder.push(label)
      open = { label, buffer: [String(field[2])] }
    } else if (open !== undefined) {
      open.buffer.push(line)
    }
  }
  close()
  const exemptionLine = topLines.find(line => line.startsWith(vocabulary.exemptionMarker))
  return {
    name,
    raw,
    firstItem,
    conclusions,
    verdict,
    round,
    signedDate,
    uid,
    conclusionOk: conclusions.length === 1 && verdict !== '' && firstItem.startsWith(conclusionLabel),
    fields,
    fieldOrder,
    checks,
    topLines,
    exemptionReason: exemptionLine === undefined ? '' : exemptionLine.slice(vocabulary.exemptionMarker.length).trim(),
    exemptionDeclared: exemptionLine !== undefined,
    deferredTcs: deferredTcsOf(fields[vocabulary.evidenceLabel] ?? '', vocabulary.deferredMarker),
  }
}

/**
 * Parse the regression section's result lines.
 * @param raw - the slice including the heading line; empty when absent.
 * @returns one line per non-blank visible line.
 */
export function parseRegression(raw: string): RegressionLine[] {
  const lines: RegressionLine[] = []
  for (const line of visibleLines(splitLines(raw).slice(1).join('\n'))) {
    if (line.trim() === '') continue
    const segments = line.trim().split(REGRESSION_SEPARATOR).map(part => part.trim())
    const [when = '', uid = '', sample = '', tc = '', result = ''] = segments.length === REGRESSION_SEGMENTS ? segments : [segments.join(REGRESSION_SEPARATOR)]
    lines.push({ raw: line.trim(), segments, wellFormed: segments.length === REGRESSION_SEGMENTS, when, uid, sample, tc, result })
  }
  return lines
}

/**
 * Parse a review record body.
 * @param body - the Markdown body after the frontmatter.
 * @param vocabulary - the fixed labels.
 * @returns the sections, the regression lines, and the waiver facts.
 */
export function parseReview(body: string, vocabulary: ReviewVocabulary): Review {
  const slices = sectionSlices(body)
  const sections: Record<string, ReviewSection> = {}
  for (const [heading, raw] of Object.entries(slices)) {
    if (heading !== REGRESSION_SECTION) sections[heading] = parseReviewSection(heading, raw, vocabulary)
  }
  const reqReview = sections.req_review
  return {
    sections,
    regression: parseRegression(slices[REGRESSION_SECTION] ?? ''),
    gate: name => sections[name],
    exemptionReason: reqReview === undefined ? '' : reqReview.exemptionReason,
    exemptionDeclared: reqReview !== undefined && reqReview.exemptionDeclared,
  }
}
