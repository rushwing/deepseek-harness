import type { StepDecisions } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import { BUG_003, REQ_009, REQ_010, RV_009, TC_009_01, appendBody, editBody, replaceSection, setField, type Files } from './lint-helper.ts'

/** One lifecycle step: the pre-step tree, the child's edits, the applier's expected edits, and the decisions the applier needs. */
export interface Scenario {
  readonly id: string
  readonly kind: 'transition' | 'event'
  readonly reqId: string
  readonly eventPr?: number
  readonly pre: (files: Files) => unknown
  readonly child: (files: Files) => unknown
  readonly effects: (files: Files) => unknown
  readonly decisions: StepDecisions
}

export const RV_010 = 'lifecycle/tasks/reviews/platform/RV-PLAT-010.md'
export const RV_008 = 'lifecycle/tasks/reviews/platform/RV-PLAT-008.md'
export const BUG_007 = 'lifecycle/tasks/bugs/platform/BUG-PLAT-007.md'
const SIGN_DATE = '2026-09-14'
const REGRESSION_LINE = '2026-09-13 | evaluator-002 | sample-1 | TC-PLAT-009-01 | passed'

const OWN_TCS = Array.from({ length: 21 }, (_, index) => `lifecycle/tasks/test-cases/platform/TC-PLAT-009-${String(index + 1).padStart(2, '0')}.md`)
const CARRIED_BUGS = ['003', '004', '005', '006'].map(number => `lifecycle/tasks/bugs/platform/BUG-PLAT-${number}.md`)

/** A review record for REQ-PLAT-010 with one signed `req_review` section. */
export function rv010(verdict: string, round: number, uid: string, topLine = ''): string {
  return [
    '---', 'rv_id: RV-PLAT-010', 'tool: platform', 'linked_req: REQ-PLAT-010', '---', '', '## req_review', '',
    `Conclusion: ${verdict} (round ${String(round)}, ${SIGN_DATE}, ${uid})`, '', ...(topLine === '' ? [] : [topLine, '']),
    'Review scope: the whole REQ', '', 'Evidence: 1 read', '', 'Findings: None', '', 'Pending human-001: None', '',
  ].join('\n')
}

/** A BUG that blocks REQ-PLAT-009; `linkedReq` names its carrier when self-carried. */
export function bug007(status: string, linkedReq = ''): string {
  return [
    '---', 'bug_id: BUG-PLAT-007', 'tool: platform', 'title: "Blocking defect"', `status: ${status}`, 'severity: low', 'bug_type: req_bug',
    'owner: human-001', `linked_req: ${linkedReq === '' ? '""' : linkedReq}`, 'origin_req: ""', 'blocks_req: [REQ-PLAT-009]', 'found_in: req_review',
    'test_case_ref: []', '---', '', '## Symptom', '', 'A defect.', '',
  ].join('\n')
}

/** A review record for the legacy REQ-PLAT-008 holding one regression line that cites a TC of REQ-PLAT-009. */
export function rv008(withLine: boolean): string {
  return [
    '---', 'rv_id: RV-PLAT-008', 'tool: platform', 'linked_req: REQ-PLAT-008', '---', '', '## regression', '',
    ...(withLine ? [REGRESSION_LINE] : []), '',
  ].join('\n')
}

/** Re-sign one gate section of an RV: a new conclusion line changes the section and bumps the round. */
export function sign(files: Files, path: string, section: string, verdict: string, round: number, uid: string): Files {
  return editBody(files, path, body => body.replace(
    new RegExp(`(## ${section}\\n\\n)Conclusion: [^\\n]*`),
    `$1Conclusion: ${verdict} (round ${String(round)}, ${SIGN_DATE}, ${uid})`,
  ))
}

function req009(files: Files, status: string, owner: string): Files {
  setField(files, REQ_009, 'status', status)
  return setField(files, REQ_009, 'owner', owner)
}

function req010(files: Files, status: string, owner: string): Files {
  setField(files, REQ_010, 'status', status)
  return setField(files, REQ_010, 'owner', owner)
}

function ownTcs(files: Files, status: string): Files {
  for (const path of OWN_TCS) setField(files, path, 'status', status)
  return files
}

function carriedBugs(files: Files, status: string): Files {
  for (const path of CARRIED_BUGS) setField(files, path, 'status', status)
  return files
}

function block009(files: Files, restoreState: string, restoreOwner: string): Files {
  req009(files, 'blocked', 'human-001')
  setField(files, REQ_009, 'pending_bugs', '[BUG-PLAT-007]')
  setField(files, REQ_009, 'blocked_reason', 'waiting on BUG-PLAT-007')
  setField(files, REQ_009, 'blocked_from_status', restoreState)
  setField(files, REQ_009, 'blocked_from_owner', restoreOwner)
  files[BUG_007] = bug007('closed')
  return files
}

function unblock009(files: Files, status: string, owner: string): Files {
  req009(files, status, owner)
  setField(files, REQ_009, 'pending_bugs', '[]')
  setField(files, REQ_009, 'blocked_reason', '""')
  setField(files, REQ_009, 'blocked_from_status', '""')
  return setField(files, REQ_009, 'blocked_from_owner', '""')
}

const none = (): undefined => undefined

/** Every transition and event of the fixture table with a satisfying step. */
export const SCENARIOS: readonly Scenario[] = [
  { id: 'T01', kind: 'transition', reqId: 'REQ-PLAT-010', pre: none, child: none, effects: files => req010(files, 'req_review', 'planner-001'), decisions: {} },
  { id: 'T02', kind: 'transition', reqId: 'REQ-PLAT-010', pre: files => req010(files, 'req_review', 'planner-001'), child: none, effects: files => setField(files, REQ_010, 'owner', 'evaluator-001'), decisions: {} },
  {
    id: 'T03', kind: 'transition', reqId: 'REQ-PLAT-010',
    pre: files => req010(files, 'req_review', 'evaluator-001'),
    child: (files) => { files[RV_010] = rv010('PASS', 1, 'evaluator-001') },
    effects: (files) => { req010(files, 'tc_design', 'evaluator-001'); setField(files, REQ_010, 'review_round', '1') },
    decisions: {},
  },
  {
    id: 'T03b', kind: 'transition', reqId: 'REQ-PLAT-010', eventPr: 42,
    pre: (files) => { req010(files, 'req_review', 'evaluator-001'); setField(files, REQ_010, 'tc_policy', 'exempt'); setField(files, REQ_010, 'exempt_reason', '"docs only"') },
    child: (files) => { files[RV_010] = rv010('PASS', 1, 'evaluator-001') },
    effects: (files) => { req010(files, 'pr_draft', 'human-001'); setField(files, REQ_010, 'review_round', '1'); setField(files, REQ_010, 'pr_number', '42') },
    decisions: {},
  },
  {
    id: 'T03c', kind: 'transition', reqId: 'REQ-PLAT-010',
    pre: (files) => { req010(files, 'req_review', 'evaluator-001'); setField(files, REQ_010, 'tc_policy', 'optional') },
    child: (files) => { files[RV_010] = rv010('PASS', 1, 'evaluator-001', 'TC waiver reason: documentation only') },
    effects: (files) => { req010(files, 'req_impl', 'generator-001'); setField(files, REQ_010, 'review_round', '1') },
    decisions: {},
  },
  {
    id: 'T04', kind: 'transition', reqId: 'REQ-PLAT-010',
    pre: files => req010(files, 'req_review', 'evaluator-001'),
    child: (files) => { files[RV_010] = rv010('REJECT', 1, 'evaluator-001') },
    effects: (files) => { req010(files, 'req_review', 'planner-001'); setField(files, REQ_010, 'review_round', '1') },
    decisions: {},
  },
  { id: 'T05', kind: 'transition', reqId: 'REQ-PLAT-009', pre: files => req009(files, 'tc_design', 'evaluator-001'), child: none, effects: files => req009(files, 'tc_review', 'generator-001'), decisions: {} },
  {
    id: 'T06', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: (files) => { req009(files, 'tc_review', 'generator-001'); ownTcs(files, 'draft') },
    child: files => sign(files, RV_009, 'tc_review', 'PASS', 3, 'generator-001'),
    effects: (files) => { req009(files, 'tc_impl', 'generator-001'); ownTcs(files, 'reviewed') },
    decisions: {},
  },
  {
    id: 'T07', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => req009(files, 'tc_review', 'generator-001'),
    child: files => sign(files, RV_009, 'tc_review', 'REJECT', 3, 'generator-001'),
    effects: files => req009(files, 'tc_design', 'evaluator-001'),
    decisions: {},
  },
  {
    id: 'T08', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: (files) => { req009(files, 'tc_impl', 'generator-001'); ownTcs(files, 'reviewed') },
    child: none,
    effects: (files) => { req009(files, 'tc_impl_review', 'evaluator-001'); setField(files, TC_009_01, 'status', 'implemented') },
    decisions: { tcStatuses: { 'TC-PLAT-009-01': 'implemented' } },
  },
  {
    id: 'T09', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => req009(files, 'tc_impl_review', 'evaluator-001'),
    child: files => sign(files, RV_009, 'tc_impl_review', 'PASS', 3, 'evaluator-001'),
    effects: files => req009(files, 'req_impl', 'generator-001'),
    decisions: {},
  },
  {
    id: 'T10', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => req009(files, 'tc_impl_review', 'evaluator-001'),
    child: files => sign(files, RV_009, 'tc_impl_review', 'REJECT', 3, 'evaluator-001'),
    effects: files => req009(files, 'tc_impl', 'generator-001'),
    decisions: {},
  },
  {
    id: 'T11', kind: 'transition', reqId: 'REQ-PLAT-009', eventPr: 26,
    pre: (files) => { req009(files, 'req_impl', 'generator-001'); setField(files, REQ_009, 'pr_number', 'null') },
    child: none,
    effects: (files) => { req009(files, 'req_impl_review', 'evaluator-001'); setField(files, REQ_009, 'pr_number', '26') },
    decisions: {},
  },
  {
    id: 'T12', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => req009(files, 'req_impl_review', 'evaluator-001'),
    child: files => sign(files, RV_009, 'req_impl_review', 'REJECT', 4, 'evaluator-002'),
    effects: (files) => { req009(files, 'req_impl', 'generator-001'); setField(files, TC_009_01, 'status', 'failing') },
    decisions: { tcStatuses: { 'TC-PLAT-009-01': 'failing' } },
  },
  {
    id: 'T13', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: (files) => { req009(files, 'req_impl_review', 'evaluator-001'); setField(files, BUG_003, 'status', 'resolved'); setField(files, TC_009_01, 'status', 'failing') },
    child: files => sign(files, RV_009, 'req_impl_review', 'PASS', 4, 'evaluator-002'),
    effects: (files) => { req009(files, 'pr_draft', 'human-001'); setField(files, BUG_003, 'status', 'closed'); setField(files, TC_009_01, 'status', 'passing') },
    decisions: { tcStatuses: { 'TC-PLAT-009-01': 'passing' }, bugStatuses: { 'BUG-PLAT-003': 'closed' } },
  },
  { id: 'T14', kind: 'transition', reqId: 'REQ-PLAT-009', pre: files => req009(files, 'pr_draft', 'human-001'), child: none, effects: files => req009(files, 'done', 'human-001'), decisions: {} },
  {
    id: 'T15', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => req009(files, 'req_review', 'evaluator-001'),
    child: (files) => { files[BUG_007] = bug007('open'); sign(files, RV_009, 'req_review', 'REJECT', 9, 'evaluator-002') },
    effects: (files) => {
      req009(files, 'blocked', 'human-001')
      setField(files, REQ_009, 'pending_bugs', '[BUG-PLAT-007]')
      setField(files, REQ_009, 'blocked_reason', 'waiting on BUG-PLAT-007')
      setField(files, REQ_009, 'blocked_from_status', 'req_review')
      setField(files, REQ_009, 'blocked_from_owner', 'planner')
      setField(files, REQ_009, 'review_round', '9')
    },
    decisions: { fields: { pending_bugs: ['BUG-PLAT-007'], blocked_reason: 'waiting on BUG-PLAT-007' } },
  },
  {
    id: 'T15@pr_draft', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => req009(files, 'pr_draft', 'human-001'),
    child: (files) => { files[BUG_007] = bug007('open') },
    effects: (files) => {
      req009(files, 'blocked', 'human-001')
      setField(files, REQ_009, 'pending_bugs', '[BUG-PLAT-007]')
      setField(files, REQ_009, 'blocked_reason', 'waiting on BUG-PLAT-007')
      setField(files, REQ_009, 'blocked_from_status', 'req_impl')
      setField(files, REQ_009, 'blocked_from_owner', 'generator')
    },
    decisions: { fields: { pending_bugs: ['BUG-PLAT-007'], blocked_reason: 'waiting on BUG-PLAT-007' } },
  },
  {
    id: 'T15@self-carried', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => req009(files, 'tc_impl_review', 'evaluator-001'),
    child: (files) => { files[BUG_007] = bug007('open', 'REQ-PLAT-009') },
    effects: (files) => {
      req009(files, 'blocked', 'human-001')
      setField(files, REQ_009, 'pending_bugs', '[BUG-PLAT-007]')
      setField(files, REQ_009, 'blocked_reason', 'waiting on BUG-PLAT-007')
      setField(files, REQ_009, 'blocked_from_status', 'req_review')
      setField(files, REQ_009, 'blocked_from_owner', 'planner')
    },
    decisions: { fields: { pending_bugs: ['BUG-PLAT-007'], blocked_reason: 'waiting on BUG-PLAT-007' } },
  },
  {
    id: 'T16', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: (files) => { block009(files, 'req_review', 'planner'); files[RV_008] = rv008(true) },
    child: none,
    effects: (files) => { unblock009(files, 'req_review', 'planner-001'); ownTcs(files, 'draft'); carriedBugs(files, 'resolved'); files[RV_008] = rv008(false) },
    decisions: {},
  },
  {
    id: 'T16@tc_impl', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: files => block009(files, 'tc_impl', 'generator'),
    child: none,
    effects: files => unblock009(files, 'tc_impl', 'generator-001'),
    decisions: {},
  },
  { id: 'T17', kind: 'transition', reqId: 'REQ-PLAT-010', pre: files => req010(files, 'req_review', 'planner-001'), child: none, effects: files => setField(files, REQ_010, 'owner', 'human-001'), decisions: {} },
  { id: 'T18', kind: 'transition', reqId: 'REQ-PLAT-010', pre: files => req010(files, 'req_review', 'human-001'), child: none, effects: files => setField(files, REQ_010, 'owner', 'planner-001'), decisions: {} },
  {
    id: 'T19', kind: 'transition', reqId: 'REQ-PLAT-009',
    pre: (files) => { req009(files, 'tc_impl', 'generator-001'); files[RV_008] = rv008(true) },
    child: none,
    effects: (files) => { req009(files, 'req_review', 'planner-001'); ownTcs(files, 'draft'); carriedBugs(files, 'resolved'); files[RV_008] = rv008(false) },
    decisions: {},
  },
  { id: 'bug_fix', kind: 'event', reqId: 'REQ-PLAT-009', pre: none, child: none, effects: files => setField(files, BUG_003, 'status', 'resolved'), decisions: { bugStatuses: { 'BUG-PLAT-003': 'resolved' } } },
  { id: 'bug_verify', kind: 'event', reqId: 'REQ-PLAT-009', pre: files => setField(files, BUG_003, 'status', 'resolved'), child: none, effects: files => setField(files, BUG_003, 'status', 'closed'), decisions: { bugStatuses: { 'BUG-PLAT-003': 'closed' } } },
  { id: 'regression', kind: 'event', reqId: 'REQ-PLAT-009', pre: none, child: none, effects: files => setField(files, TC_009_01, 'status', 'failing'), decisions: { tcStatuses: { 'TC-PLAT-009-01': 'failing' } } },
  {
    id: 'external_review', kind: 'event', reqId: 'REQ-PLAT-009', pre: none,
    child: files => appendBody(files, RV_009, '\n## external_review\n\nConclusion: PASS (2026-09-14, human-001)\n\nReview scope: all\n\nEvidence: read\n\nFindings: None\n\nPending human-001: None\n'),
    effects: none,
    decisions: {},
  },
  {
    id: 'bug_redirect', kind: 'event', reqId: 'REQ-PLAT-009',
    pre: files => block009(files, 'tc_impl', 'generator'),
    child: none,
    effects: (files) => { setField(files, REQ_009, 'blocked_from_status', 'req_review'); setField(files, REQ_009, 'blocked_from_owner', 'planner') },
    decisions: {},
  },
]

/** The pending-decisions section text that keeps a REQ from leaving review. */
export function openQuestion(files: Files, path: string): Files {
  return replaceSection(files, path, 'Pending decisions', '- **Q-01** (planner-001, 2026-09-13) Which store? | Options SQLite / files | Default files | Deadline 2026-09-20')
}
