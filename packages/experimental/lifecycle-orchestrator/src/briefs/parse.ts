/**
 * Reading a workspace's `standards/briefs.md`: one section per role × state
 * with eight fixed fields, four shared sections, and a scan for the phrases
 * the prompting gates forbid.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/briefs/parse
 */

import { roleStates, type LifecycleTable } from '@deepseek-ai/dsh-experimental-lifecycle-table'

/** The eight fields of one role × state brief. */
export interface BriefText {
  readonly whenToUse: string
  readonly checks: string
  readonly read: string
  readonly write: string
  readonly style: string
  readonly checklist: string
  readonly prohibited: string
  readonly deliverable: string
}

/** The sections every brief may append. */
export interface SharedBriefText {
  readonly reviewChecklist: string
  readonly blockingAndRelease: string
  readonly deferredVerification: string
  readonly generalProhibitions: string
}

/** The parsed briefs file. */
export interface Briefs {
  /** The text before the first section: how uids are seated and how the checks are run. */
  readonly intro: string
  /** Brief texts by `<role>@<state>`. */
  readonly roleStates: Readonly<Record<string, BriefText>>
  readonly shared: SharedBriefText
}

/** Result of parsing a briefs file: the briefs, or the problems that prevented them. */
export interface BriefsParse {
  readonly briefs: Briefs | undefined
  readonly problems: readonly string[]
}

/** The phrases the prompting gates forbid in briefs and registry notes, matched case-insensitively. */
export const BANNED_PHRASES: readonly string[] = [
  'only report high-severity',
  'be conservative',
  "don't nitpick",
  'double-check your answer',
  'one more verification pass',
]

/** Field label to its key, in the order the sections list them. */
const FIELDS: readonly (readonly [label: string, key: keyof BriefText])[] = [
  ['When to use', 'whenToUse'],
  ['Three checks before starting', 'checks'],
  ['What to read', 'read'],
  ['What to write and where', 'write'],
  ['Writing style', 'style'],
  ['Checklist', 'checklist'],
  ['Prohibited', 'prohibited'],
  ['Deliverable', 'deliverable'],
]

/** Shared section heading to its key. */
const SHARED: readonly (readonly [heading: string, key: keyof SharedBriefText])[] = [
  ['Review checklist', 'reviewChecklist'],
  ['Blocking and release (T15 / T16)', 'blockingAndRelease'],
  ['Deferred verification (regression runs for integration TCs lacking samples)', 'deferredVerification'],
  ['General prohibitions', 'generalProhibitions'],
]

const ROLE_STATE_HEADING = /^([a-z]+) @ ([a-z_]+)$/
const H2 = '## '
const SEPARATOR = '---'
const HUMAN = 'human'

/**
 * The banned phrases a text contains, in the order the list declares them.
 * @param text - any prompt-bound text.
 * @returns the phrases found.
 */
export function bannedPhrasesIn(text: string): string[] {
  const lower = text.toLowerCase()
  return BANNED_PHRASES.filter(phrase => lower.includes(phrase))
}

function stripSeparators(text: string): string {
  return text.split('\n').filter(line => line.trim() !== SEPARATOR).join('\n').trim()
}

interface Section {
  readonly heading: string
  readonly body: string
}

function sectionsOf(text: string): { intro: string; sections: Section[] } {
  const lines = text.split('\n')
  const sections: Section[] = []
  const introLines: string[] = []
  let current: { heading: string; lines: string[] } | undefined
  for (const line of lines) {
    if (line.startsWith(H2)) {
      if (current !== undefined) sections.push({ heading: current.heading, body: stripSeparators(current.lines.join('\n')) })
      current = { heading: line.slice(H2.length).trim(), lines: [] }
      continue
    }
    if (current === undefined) {
      if (!line.startsWith('# ')) introLines.push(line)
    } else {
      current.lines.push(line)
    }
  }
  if (current !== undefined) sections.push({ heading: current.heading, body: stripSeparators(current.lines.join('\n')) })
  return { intro: stripSeparators(introLines.join('\n')), sections }
}

function fieldsOf(body: string): { fields: Partial<Record<keyof BriefText, string>>; missing: string[] } {
  const pattern = new RegExp(`\\*\\*(${FIELDS.map(([label]) => label).join('|')})\\*\\*:\\s*`, 'g')
  const marks = [...body.matchAll(pattern)].map(match => ({
    label: String(match[1]),
    start: match.index,
    end: match.index + match[0].length,
  }))
  const fields: Partial<Record<keyof BriefText, string>> = {}
  const missing: string[] = []
  for (const [label, key] of FIELDS) {
    const mark = marks.find(entry => entry.label === label)
    if (mark === undefined) {
      missing.push(label)
      continue
    }
    const next = marks.filter(entry => entry.start > mark.start).sort((left, right) => left.start - right.start)[0]
    fields[key] = body.slice(mark.end, next === undefined ? body.length : next.start).trim()
  }
  return { fields, missing }
}

/**
 * Parse a briefs file against the table's role states.
 * @param text - the Markdown text.
 * @param table - the lifecycle table whose non-human role × state pairs each need a section.
 * @param label - the file label prefixed to every problem.
 * @returns the briefs, or every problem.
 */
export function parseBriefs(text: string, table: LifecycleTable, label: string): BriefsParse {
  const problems: string[] = []
  const { intro, sections } = sectionsOf(text)
  const expected = roleStates(table)
  const roleStateTexts: Record<string, BriefText> = {}
  const shared: Partial<Record<keyof SharedBriefText, string>> = {}
  for (const section of sections) {
    const roleState = ROLE_STATE_HEADING.exec(section.heading)
    if (roleState !== null) {
      const role = String(roleState[1])
      const state = String(roleState[2])
      const states = expected[role]
      if (states === undefined) {
        problems.push(`${label}: section '${section.heading}' names a role the table does not register`)
        continue
      }
      if (!states.includes(state)) {
        problems.push(`${label}: section '${section.heading}' names a state the ${role} does not work in`)
        continue
      }
      const { fields, missing } = fieldsOf(section.body)
      for (const field of missing) problems.push(`${label}: section '${section.heading}' lacks the field '${field}'`)
      for (const phrase of bannedPhrasesIn(section.body)) problems.push(`${label}: section '${section.heading}' contains the banned phrase '${phrase}'`)
      if (missing.length === 0) roleStateTexts[`${role}@${state}`] = fields as BriefText
      continue
    }
    const sharedKey = SHARED.find(([heading]) => heading === section.heading)
    if (sharedKey === undefined) continue
    shared[sharedKey[1]] = section.body
    for (const phrase of bannedPhrasesIn(section.body)) problems.push(`${label}: section '${section.heading}' contains the banned phrase '${phrase}'`)
  }
  for (const [role, states] of Object.entries(expected)) {
    if (role === HUMAN) continue
    for (const state of states) {
      if (!(`${role}@${state}` in roleStateTexts) && !problems.some(problem => problem.includes(`'${role} @ ${state}'`))) {
        problems.push(`${label}: no section for ${role} @ ${state}`)
      }
    }
  }
  for (const [heading, key] of SHARED) {
    if (shared[key] === undefined) problems.push(`${label}: lacks the shared section '${heading}'`)
  }
  if (problems.length > 0) return { briefs: undefined, problems }
  return { briefs: { intro, roleStates: roleStateTexts, shared: shared as SharedBriefText }, problems: [] }
}
