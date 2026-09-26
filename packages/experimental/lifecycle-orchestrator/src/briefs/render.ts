/**
 * Assembling the first message of a role child from the parsed briefs: the
 * role × state fields, the shared sections the brief cites, the hand-over
 * that replaces committing, and the agent's registry notes.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/briefs/render
 */

import { LifecycleError } from '../errors.ts'
import type { BriefText, Briefs, SharedBriefText } from './parse.ts'

/** What a brief is rendered for. */
export interface BriefRequest {
  readonly role: string
  readonly state: string
  readonly reqId: string
  /** The seated uid. */
  readonly uid: string
  /** The transition ids the seated role may propose from the REQ's state. */
  readonly legalTransitions: readonly string[]
  /** The lifecycle directory relative to the workspace. */
  readonly lifecycleDir: string
  /** The agent's registry notes, appended last. */
  readonly notes?: string | undefined
}

/** Field key to the heading it renders under, in order. */
const FIELD_HEADINGS: readonly (readonly [key: keyof BriefText, heading: string])[] = [
  ['whenToUse', 'When to use'],
  ['checks', 'Three checks before starting'],
  ['read', 'What to read'],
  ['write', 'What to write and where'],
  ['style', 'Writing style'],
  ['checklist', 'Checklist'],
  ['prohibited', 'Prohibited'],
  ['deliverable', 'Deliverable'],
]

/** Shared sections a brief includes when its own text cites them, with the heading and the cue. */
const CITED_SHARED: readonly (readonly [key: keyof SharedBriefText, heading: string, cue: string])[] = [
  ['reviewChecklist', 'Review checklist', 'Review checklist'],
  ['blockingAndRelease', 'Blocking and release (T15 / T16)', 'Blocking and release'],
  ['deferredVerification', 'Deferred verification (regression runs for integration TCs lacking samples)', 'Deferred verification'],
]

function handOver(request: BriefRequest): string {
  const lines = [
    'Do not change `status`, `owner`, `review_round`, `pending_bugs`, or the `blocked_*` fields of any REQ, nor the `status` of any TC or BUG: '
    + 'the orchestrator applies the transition you propose and lints the result.',
  ]
  if (request.legalTransitions.length === 0) {
    lines.push('No transition is legal from here; report to human-001 instead of proposing one.')
    return lines.join('\n')
  }
  lines.push(
    `Legal transitions from here: ${request.legalTransitions.join(', ')}. End your final message with one fenced JSON block:`,
    '```json',
    `{ "transition": "${String(request.legalTransitions[0])}", "summary": "one sentence", "decisions": {} }`,
    '```',
    '`decisions` carries the choices the transition leaves open: `fields` (for T15: `pending_bugs`, `blocked_reason`), `tcStatuses`, and `bugStatuses`, '
    + 'each keyed by id. When you need a human ruling instead, end with `{ "needsHuman": true, "question": "..." }`.',
  )
  return lines.join('\n')
}

/**
 * Render the brief of one role × state for one REQ.
 * @param briefs - the parsed briefs.
 * @param request - the role, state, REQ, seated uid, legal transitions, and notes.
 * @returns the Markdown brief.
 * @throws `NO_BRIEF` when the briefs have no section for the role × state.
 */
export function renderBrief(briefs: Briefs, request: BriefRequest): string {
  const brief = briefs.roleStates[`${request.role}@${request.state}`]
  if (brief === undefined) throw new LifecycleError('NO_BRIEF', `the briefs have no section for ${request.role} @ ${request.state}`)
  const own = FIELD_HEADINGS.map(([key]) => brief[key]).join('\n')
  const parts = [
    `# Brief: ${request.role} @ ${request.state} — ${request.reqId}`,
    `You are \`${request.uid}\`, the ${request.role} of ${request.reqId}, which is in \`${request.state}\`. `
    + `Read this brief fully before acting; the lifecycle directory of this workspace is \`${request.lifecycleDir}/\`.`,
    briefs.intro,
    ...FIELD_HEADINGS.map(([key, heading]) => `## ${heading}\n${brief[key]}`),
    `## Hand-over\n${handOver(request)}`,
    ...CITED_SHARED.filter(([, , cue]) => own.includes(cue)).map(([key, heading]) => `## ${heading}\n${briefs.shared[key]}`),
    `## General prohibitions\n${briefs.shared.generalProhibitions}`,
  ]
  if (request.notes !== undefined && request.notes.trim() !== '') parts.push(`## Notes from the registry\n${request.notes.trim()}`)
  return `${parts.join('\n\n')}\n`
}
