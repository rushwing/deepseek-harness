/**
 * The text the lifecycle tools and the `/lifecycle` command show for a
 * status report, a check-in verdict, and a lint report.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/render
 */

import type { CheckInRequest, CheckInResult, LifecycleStatus, ReqStatus } from './workspace.ts'

/** The lint facts the report renders: violations and the per-rule counts as the tool value carries them. */
export interface LintText {
  readonly violations: readonly { readonly file: string; readonly rule: string; readonly message: string }[]
  readonly counts: Readonly<Record<string, unknown>>
}

const NONE = 'none'
const UNREGISTERED = 'unregistered'

function reqLine(req: ReqStatus): string {
  const transitions = req.legalTransitions.length === 0
    ? 'no legal transitions'
    : `legal transitions ${req.legalTransitions.map(transition => transition.id).join(', ')}`
  const role = req.ownerRole === '' ? UNREGISTERED : req.ownerRole
  const seat = req.seat === null ? NONE : req.seat
  return `${req.id}: ${req.status}, owner ${req.owner} (${role}), seat ${seat}; ${transitions}`
}

/**
 * One line per REQ, headed by the count and active set when more than one REQ is reported.
 * @param status - the report.
 * @returns the text.
 */
export function renderStatus(status: LifecycleStatus): string {
  const lines = status.reqs.map(reqLine)
  if (status.reqs.length === 1) return String(lines[0])
  const activeSet = status.activeSet === null ? NONE : status.activeSet
  return [`${status.reqs.length} REQs; active set ${activeSet}`, ...lines].join('\n')
}

/**
 * The check-in verdict with every failed check named.
 * @param request - the check-in request.
 * @param result - the verdict.
 * @returns the text.
 */
export function renderCheckIn(request: CheckInRequest, result: CheckInResult): string {
  const { c1, c2, c3 } = result.checks
  if (result.ok) {
    return result.exempt
      ? `Check-in ok: ${String(request.transition)} is exempt from the hard-stop checks for ${request.uid} on ${request.reqId}.`
      : `Check-in ok: ${request.uid} owns ${request.reqId} in ${request.state}.`
  }
  const reasons: string[] = []
  if (!c1.ok) reasons.push(`${request.reqId} does not exist`)
  if (c1.ok && !c2.ok) reasons.push(`the owner is ${String(c2.expected)}`)
  if (c1.ok && !c3.ok) {
    reasons.push(c3.status === request.state
      ? `${request.state} is outside ${request.uid}'s states [${c3.handles.join(', ')}]`
      : `${request.reqId} is in ${String(c3.status)}, not ${request.state}`)
  }
  return `Check-in refused for ${request.uid} on ${request.reqId}: ${reasons.join('; ')}.`
}

/**
 * The lint report: a one-line verdict, then one line per violation.
 * @param report - the report.
 * @param scope - `all`, or the REQ id the run was scoped to.
 * @returns the text.
 */
export function renderLint(report: LintText, scope: string): string {
  const where = scope === 'all' ? 'across the tasks tree' : `for ${scope}`
  if (report.violations.length === 0) return `Lint clean: 0 violations ${where}.`
  const counts = Object.entries(report.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rule, count]) => `${rule} ${String(count)}`)
    .join(', ')
  return [
    `Lint: ${report.violations.length} violations ${where} (${counts})`,
    ...report.violations.map(violation => `- ${violation.file} [${violation.rule}]: ${violation.message}`),
  ].join('\n')
}
