import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLifecycleTable } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import { BRIEFS, LIFECYCLE_TABLE, LifecycleError, bannedPhrasesIn, parseBriefs, renderBrief } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { cleanup, setup, workspace, writeText } from './workspace-helper.ts'

afterEach(cleanup)

const table = (() => {
  const load = loadLifecycleTable(LIFECYCLE_TABLE)
  if (load.table === undefined) throw new Error(load.problems.join('\n'))
  return load.table
})()

const ROLE_STATES = [
  'planner@req_review', 'evaluator@req_review', 'evaluator@tc_design', 'generator@tc_review',
  'generator@tc_impl', 'evaluator@tc_impl_review', 'generator@req_impl', 'evaluator@req_impl_review',
]
const FIELDS = ['whenToUse', 'checks', 'read', 'write', 'style', 'checklist', 'prohibited', 'deliverable'] as const
const HEADINGS = ['When to use', 'Three checks before starting', 'What to read', 'What to write and where', 'Writing style', 'Checklist', 'Prohibited', 'Deliverable']

describe('parseBriefs', () => {
  it('reads every role × state section, its eight fields, and the shared sections of the default briefs', () => {
    const parsed = parseBriefs(BRIEFS, table, 'lifecycle/standards/briefs.md')
    expect(parsed.problems).toEqual([])
    if (parsed.briefs === undefined) throw new Error('no briefs')
    expect(Object.keys(parsed.briefs.roleStates).sort()).toEqual([...ROLE_STATES].sort())
    for (const key of ROLE_STATES) {
      const brief = parsed.briefs.roleStates[key]
      if (brief === undefined) throw new Error(key)
      for (const field of FIELDS) expect(brief[field].length, `${key}.${field}`).toBeGreaterThan(20)
    }
    expect(parsed.briefs.roleStates['planner@req_review']?.deliverable).toContain('hand back the proposal `T02`')
    expect(Object.keys(parsed.briefs.shared).sort()).toEqual(['blockingAndRelease', 'deferredVerification', 'generalProhibitions', 'reviewChecklist'])
    expect(parsed.briefs.shared.reviewChecklist).toContain('A1 fail-open')
    expect(parsed.briefs.intro).toContain('lifecycle_check_in')
    expect(bannedPhrasesIn(BRIEFS)).toEqual([])
  })

  it('names a missing field, a missing or foreign section, a missing shared section, and a banned phrase', () => {
    const label = 'briefs.md'
    const withoutField = BRIEFS.replace('**Deliverable**: Pending decisions is None', '**Delivered**: Pending decisions is None')
    expect(parseBriefs(withoutField, table, label).problems).toEqual(["briefs.md: section 'planner @ req_review' lacks the field 'Deliverable'"])
    const withoutSection = BRIEFS.replace('## evaluator @ tc_design', '## evaluator @ done')
    expect(parseBriefs(withoutSection, table, label).problems).toEqual([
      "briefs.md: section 'evaluator @ done' names a state the evaluator does not work in",
      'briefs.md: no section for evaluator @ tc_design',
    ])
    const withoutShared = BRIEFS.replace('## General prohibitions', '## Prohibitions')
    expect(parseBriefs(withoutShared, table, label).problems).toEqual(["briefs.md: lacks the shared section 'General prohibitions'"])
    const banned = BRIEFS.replace(
      '**Writing style**: do only what this state requires.',
      '**Writing style**: do only what this state requires. Double-check your answer.',
    )
    expect(parseBriefs(banned, table, label).problems).toEqual(["briefs.md: section 'generator @ tc_review' contains the banned phrase 'double-check your answer'"])
    expect(bannedPhrasesIn("Only report high-severity findings and be conservative; don't nitpick.")).toEqual(['only report high-severity', 'be conservative', "don't nitpick"])
    const foreignRole = BRIEFS.replace('## generator @ tc_impl', '## builder @ tc_impl')
    expect(parseBriefs(foreignRole, table, label).problems).toEqual([
      "briefs.md: section 'builder @ tc_impl' names a role the table does not register",
      'briefs.md: no section for generator @ tc_impl',
    ])
    const sharedBanned = BRIEFS.replace('Applies to every role, every state.', 'Applies to every role, every state. Be conservative.')
    expect(parseBriefs(sharedBanned, table, label).problems).toEqual(["briefs.md: section 'General prohibitions' contains the banned phrase 'be conservative'"])
    const extraSection = `${BRIEFS}\n---\n\n## Local conventions\n\nTeam-specific notes the orchestrator ignores.\n`
    expect(parseBriefs(extraSection, table, label).problems).toEqual([])
    expect(parseBriefs('# nothing\n', table, label).problems.length).toBeGreaterThan(8)
    expect(parseBriefs('# nothing\n', table, label).briefs).toBeUndefined()
  })
})

describe('ctx.lifecycle.briefs', () => {
  it('loads the workspace briefs and scans the registry notes', async () => {
    const ctx = await setup()
    const root = await workspace()
    const loaded = ctx.lifecycle.briefs(root)
    expect(loaded.problems).toEqual([])
    expect(loaded.briefs?.roleStates['generator@tc_impl']?.style).toContain('implement only the assertions')
    const registry = await readFile(join(root, 'lifecycle', 'agent-registry.yml'), 'utf8')
    await writeText(root, 'lifecycle/agent-registry.yml', registry.replace(
      'Do not over-prescribe steps; an over-prescriptive prompt lowers the quality of the output.',
      'Be conservative and only report high-severity findings.',
    ))
    const noted = ctx.lifecycle.briefs(root)
    expect(noted.briefs).toBeUndefined()
    expect(noted.problems).toEqual([
      "lifecycle/agent-registry.yml: planner-001 notes contain the banned phrase 'only report high-severity'",
      "lifecycle/agent-registry.yml: planner-001 notes contain the banned phrase 'be conservative'",
    ])
    const bare = await workspace()
    await rm(join(bare, 'lifecycle', 'standards', 'briefs.md'))
    expect(ctx.lifecycle.briefs(bare).problems).toEqual(['lifecycle/standards/briefs.md: missing'])
    const broken = await workspace()
    await writeText(broken, 'lifecycle/artifact-contract.yml', 'version: 9\n')
    expect(ctx.lifecycle.briefs(broken).problems.join('\n')).toMatch(/^lifecycle\/artifact-contract\.yml: version/m)
  })
})

describe('renderBrief', () => {
  const parsed = parseBriefs(BRIEFS, table, 'briefs.md')
  if (parsed.briefs === undefined) throw new Error(parsed.problems.join('\n'))
  const briefs = parsed.briefs

  it('assembles the role × state brief with the shared sections it cites, the hand-over, and the registry notes', () => {
    const text = renderBrief(briefs, {
      role: 'evaluator',
      state: 'req_review',
      reqId: 'REQ-PLAT-010',
      uid: 'evaluator-002',
      legalTransitions: ['T03', 'T03b', 'T03c', 'T04', 'T15'],
      lifecycleDir: 'lifecycle',
      notes: 'Report every finding with a severity and a confidence.',
    })
    expect(text).toMatch(/^# Brief: evaluator @ req_review — REQ-PLAT-010\n/)
    expect(text).toContain('You are `evaluator-002`, the evaluator of REQ-PLAT-010, which is in `req_review`.')
    for (const heading of HEADINGS) expect(text).toContain(`## ${heading}\n`)
    expect(text).toContain('## Review checklist\n')
    expect(text).toContain('## Blocking and release (T15 / T16)\n')
    expect(text).not.toContain('## Deferred verification')
    expect(text).toContain('## General prohibitions\n')
    expect(text).toContain('## Hand-over\n')
    expect(text).toContain('Legal transitions from here: T03, T03b, T03c, T04, T15.')
    expect(text).toContain('```json\n{ "transition": "T03", "summary": "one sentence", "decisions": {} }\n```')
    expect(text).toContain('## Notes from the registry\nReport every finding with a severity and a confidence.')
    expect(text.trimEnd().endsWith('Report every finding with a severity and a confidence.')).toBe(true)
  })

  it('omits the sections a brief does not cite and the notes when there are none', () => {
    const text = renderBrief(briefs, {
      role: 'generator', state: 'tc_impl', reqId: 'REQ-PLAT-009', uid: 'generator-001', legalTransitions: ['T08', 'T15'], lifecycleDir: 'lifecycle',
    })
    expect(text).not.toContain('## Review checklist')
    expect(text).not.toContain('## Notes from the registry')
    expect(text).toContain('## General prohibitions\n')
    const review = renderBrief(briefs, {
      role: 'evaluator', state: 'req_impl_review', reqId: 'REQ-PLAT-009', uid: 'evaluator-002', legalTransitions: ['T12', 'T13', 'T15'], lifecycleDir: 'lifecycle',
    })
    expect(review).toContain('## Deferred verification (regression runs for integration TCs lacking samples)\n')
    const idle = renderBrief(briefs, { role: 'generator', state: 'tc_impl', reqId: 'REQ-PLAT-009', uid: 'generator-001', legalTransitions: [], lifecycleDir: 'lifecycle' })
    expect(idle).toContain('No transition is legal from here; report to human-001 instead of proposing one.')
  })

  it('refuses a role × state without a brief', () => {
    let code = ''
    try {
      renderBrief(briefs, { role: 'planner', state: 'tc_impl', reqId: 'REQ-PLAT-010', uid: 'planner-001', legalTransitions: [], lifecycleDir: 'lifecycle' })
    } catch (error: unknown) {
      code = error instanceof LifecycleError ? error.code : String(error)
    }
    expect(code).toBe('NO_BRIEF')
  })
})
