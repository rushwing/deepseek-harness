import { transitionById, type PredicateClause } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import { describe, expect, it } from 'vitest'
import {
  PREDICATES,
  changedReqs,
  checkClauses,
  checkEvent,
  checkTransition,
  evidence,
  restorePairFor,
  sensitiveDelta,
  type Evidence,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import {
  BUG_003,
  BUG_004,
  REQ_009,
  REQ_010,
  RV_009,
  TC_008_12,
  TC_009_01,
  editBody,
  graphOf,
  loadTables,
  removeFile,
  setField,
  workspaceFiles,
  type Files,
} from './lint-helper.ts'
import { BUG_007, RV_008, RV_010, SCENARIOS, bug007, openQuestion, rv008, rv010, type Scenario } from './step-scenarios.ts'

interface Step {
  readonly pre: Files
  readonly post: Files
  readonly evidence: Evidence
}

function stepOf(scenario: Scenario, mutatePre?: (files: Files) => unknown, mutatePost?: (files: Files) => unknown): Step {
  const pre = workspaceFiles()
  scenario.pre(pre)
  mutatePre?.(pre)
  const post = { ...pre }
  scenario.child(post)
  scenario.effects(post)
  mutatePost?.(post)
  const loaded = loadTables(pre)
  return {
    pre,
    post,
    evidence: evidence({
      pre: graphOf(pre, loaded.contract),
      post: graphOf(post, loaded.contract),
      table: loaded.table,
      contract: loaded.contract,
      registry: loaded.registry,
      reqId: scenario.reqId,
      eventPr: scenario.eventPr,
    }),
  }
}

function problemsOf(scenario: Scenario, step: Step): string[] {
  const { table } = step.evidence
  if (scenario.kind === 'event') {
    const event = table.events[scenario.id]
    if (event === undefined) throw new Error(`no event ${scenario.id}`)
    return checkEvent(step.evidence, event)
  }
  const transition = transitionById(table, scenario.id.split('@')[0] ?? scenario.id)
  if (transition === undefined) throw new Error(`no transition ${scenario.id}`)
  return checkTransition(step.evidence, transition)
}

function clausesOf(scenario: Scenario, table: Evidence['table']): { guards: readonly PredicateClause[]; effects: readonly PredicateClause[] } {
  if (scenario.kind === 'event') {
    const event = table.events[scenario.id]
    if (event === undefined) throw new Error(`no event ${scenario.id}`)
    return event
  }
  const transition = transitionById(table, scenario.id.split('@')[0] ?? scenario.id)
  if (transition === undefined) throw new Error(`no transition ${scenario.id}`)
  return transition
}

function reqPath(scenario: Scenario): string {
  return scenario.reqId === 'REQ-PLAT-010' ? REQ_010 : REQ_009
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [])
const arg = (clause: PredicateClause, name: string): unknown => clause.args[name]

/** A mutation that makes one clause fail, with the message it should produce; `undefined` when the clause is vacuous in the scenario. */
type Tear = (
  scenario: Scenario,
  clause: PredicateClause,
  step: Step,
) => { readonly mutate: (files: Files) => unknown; readonly expected: RegExp } | undefined

const statusIn = (files: Files, path: string): string => String(/^status: (.*)$/m.exec(String(files[path]))?.[1])

const otherThan = (pool: readonly string[], ...avoid: string[]): string => {
  const found = pool.find(item => !avoid.includes(item))
  if (found === undefined) throw new Error('no alternative value')
  return found
}

const GUARD_TEARS: Readonly<Record<string, Tear>> = {
  'req.status_in': (scenario, clause, step) => ({
    mutate: (files) => {
      setField(files, reqPath(scenario), 'status', otherThan(step.evidence.table.states.req, ...list(arg(clause, 'states')), step.evidence.statusBefore()))
    },
    expected: /\.status: the pre-step tree has '[a-z_]+'; the origin must be one of \[/,
  }),
  'req.status_not_in': (scenario, clause) => ({
    mutate: files => setField(files, reqPath(scenario), 'status', String(list(arg(clause, 'states'))[0])),
    expected: /\.status: the pre-step tree has '[a-z_]+'; this transition may not start from \[/,
  }),
  'req.owner_role_is': (scenario, clause, step) => ({
    mutate: (files) => {
      setField(files, reqPath(scenario), 'owner', `${otherThan(step.evidence.table.roles, String(arg(clause, 'role')), step.evidence.roleBefore())}-001`)
    },
    expected: /\.owner: the pre-step owner's role is [a-z]+; the acting role must be [a-z]+/,
  }),
  'req.pending_questions_empty': scenario => ({ mutate: files => openQuestion(files, reqPath(scenario)), expected: /\.Pending decisions: is not 'None'; this transition requires the decisions to be closed/ }),
  'req.pending_bugs_empty': scenario => ({ mutate: files => setField(files, reqPath(scenario), 'pending_bugs', '[BUG-PLAT-003]'), expected: /\.pending_bugs: the pre-step tree still lists \[BUG-PLAT-003\]/ }),
  'req.no_carried_bugs': () => ({
    mutate: (files) => { files['lifecycle/tasks/bugs/platform/BUG-PLAT-008.md'] = bug007('open', 'REQ-PLAT-010').replace('BUG-PLAT-007', 'BUG-PLAT-008') },
    expected: /REQ-PLAT-010: this exit carries no BUG; the pre-step tree carries \[BUG-PLAT-008\]/,
  }),
  'carried_bugs_in': () => ({ mutate: files => setField(files, BUG_003, 'status', 'open'), expected: /REQ-PLAT-009: carried BUGs \[BUG-PLAT-003\] are not yet in \[/ }),
  'pending_bugs_in': () => ({ mutate: (files) => { files[BUG_007] = bug007('open') }, expected: /\.pending_bugs: \[BUG-PLAT-007\] are not yet in the accepted states \[/ }),
}

const EFFECT_TEARS: Readonly<Record<string, Tear>> = {
  'req.status_to': (scenario, clause, step) => ({
    mutate: files => setField(files, reqPath(scenario), 'status', otherThan(step.evidence.table.states.req, String(arg(clause, 'state')), step.evidence.statusAfter())),
    expected: /\.status: after the step it is '[a-z_]+'; this transition ends in '[a-z_]+'/,
  }),
  'req.owner_role_to': (scenario, clause, step) => ({
    mutate: (files) => {
      const role = otherThan(step.evidence.table.roles, String(arg(clause, 'role')), step.evidence.roleAfter(), step.evidence.roleBefore())
      setField(files, reqPath(scenario), 'owner', `${role}-001`)
    },
    expected: /\.owner: after the step the owner's role is [a-z]+; the hand-over role is [a-z]+/,
  }),
  'req.counter_inc': (scenario, clause, step) => {
    const onlyFrom = arg(clause, 'only_from')
    if (typeof onlyFrom === 'string' && step.evidence.statusBefore() !== onlyFrom) return undefined
    return { mutate: files => setField(files, reqPath(scenario), 'review_round', String(Number(step.evidence.fieldAfter('review_round')) + 5)), expected: /\.review_round: \d+ before, \d+ after; expected \d+/ }
  },
  'req.pr_number_eq_event': (scenario, clause, step) => {
    const policy = arg(clause, 'policy')
    const { eventPr } = scenario
    if (eventPr === undefined || (typeof policy === 'string' && step.evidence.policy() !== policy)) return undefined
    return {
      mutate: files => setField(files, reqPath(scenario), 'pr_number', String(eventPr + 77)),
      expected: /\.pr_number: after the step it is \d+; the event PR number is \d+/,
    }
  },
  'req.fields_set': (scenario, clause) => {
    const field = String(list(arg(clause, 'fields'))[0])
    return { mutate: files => setField(files, reqPath(scenario), field, field === 'pending_bugs' ? '[]' : '""'), expected: new RegExp(`\\.${field}: this transition requires it to be set`) }
  },
  'req.fields_cleared': (scenario, clause) => {
    const field = String(list(arg(clause, 'fields'))[0])
    return { mutate: files => setField(files, reqPath(scenario), field, field === 'pending_bugs' ? '[BUG-PLAT-999]' : 'leftover'), expected: new RegExp(`\\.${field}: this transition requires it cleared; it is `) }
  },
  'req.restore_pair_set': scenario => ({
    mutate: (files) => { setField(files, reqPath(scenario), 'blocked_from_status', 'done'); setField(files, reqPath(scenario), 'blocked_from_owner', 'human') },
    expected: /\.blocked_from_status\/blocked_from_owner: after the step they are \[done, human\]; the restore pair for origin '[a-z_]+'/,
  }),
  'req.restore_pair_to': scenario => ({
    mutate: (files) => { setField(files, reqPath(scenario), 'blocked_from_status', 'done'); setField(files, reqPath(scenario), 'blocked_from_owner', 'human') },
    expected: /\.blocked_from_status\/blocked_from_owner: after the step they are \[done, human\]; expected \[req_review, planner\]/,
  }),
  'tc.status_to': (_scenario, clause, step) => {
    const onlyRestore = arg(clause, 'only_restore')
    if (typeof onlyRestore === 'string' && restorePairFor(step.evidence)[0] !== onlyRestore) return undefined
    const outside = otherThan(step.evidence.table.states.tc, ...list(arg(clause, 'to')), statusIn(step.pre, TC_009_01))
    return { mutate: files => setField(files, TC_009_01, 'status', outside), expected: /TC-PLAT-009-01\.status: after the step it is '[a-z_]+'; this effect allows only \[/ }
  },
  'bug.status_to': (_scenario, clause, step) => {
    const onlyRestore = arg(clause, 'only_restore')
    if (typeof onlyRestore === 'string' && restorePairFor(step.evidence)[0] !== onlyRestore) return undefined
    const outside = otherThan(step.evidence.table.states.bug, ...list(arg(clause, 'to')), statusIn(step.pre, BUG_003))
    return { mutate: files => setField(files, BUG_003, 'status', outside), expected: /BUG-PLAT-003\.status: after the step it is '[a-z_]+'; this effect allows only \[/ }
  },
  'rv.gate_signed': (scenario, clause, step) => {
    const onlyFrom = arg(clause, 'only_from')
    if (typeof onlyFrom === 'string' && step.evidence.statusBefore() !== onlyFrom) return undefined
    const path = scenario.reqId === 'REQ-PLAT-010' ? RV_010 : RV_009
    return {
      mutate: (files) => {
        const before = step.pre[path]
        if (before === undefined) removeFile(files, path)
        else files[path] = before
      },
      expected: new RegExp(`RV-PLAT-0(09|10)\\.${String(arg(clause, 'section'))}: this transition signs the section, yet it is unchanged \\(pre-filled or unsigned\\)`),
    }
  },
  'rv.section_changed': (_scenario, clause, step) => ({
    mutate: (files) => { files[RV_009] = String(step.pre[RV_009]) },
    expected: new RegExp(`RV-PLAT-009\\.${String(arg(clause, 'section'))}: this event requires the section to change; it is unchanged`),
  }),
  'rv.regression_withdrawn': (_scenario, clause, step) => {
    const onlyRestore = arg(clause, 'only_restore')
    if (typeof onlyRestore === 'string' && restorePairFor(step.evidence)[0] !== onlyRestore) return undefined
    return {
      mutate: (files) => { files[RV_008] = rv008(true) },
      expected: /RV-PLAT-008\.regression: still holds a line citing this REQ's TC '/,
    }
  },
}

describe('every registered predicate has a check', () => {
  it('covers the fixture table vocabulary', () => {
    const { table } = loadTables(workspaceFiles())
    for (const name of [...Object.keys(table.predicates.data), ...table.predicates.code]) expect(PREDICATES[name], name).toBeDefined()
  })
})

describe.each(SCENARIOS)('$id', (scenario) => {
  it('accepts the satisfying step', () => {
    expect(problemsOf(scenario, stepOf(scenario))).toEqual([])
  })

  it('names every torn guard and effect', () => {
    const base = stepOf(scenario)
    const { guards, effects } = clausesOf(scenario, base.evidence.table)
    for (const clause of guards) {
      const tear = GUARD_TEARS[clause.name]
      if (tear === undefined) throw new Error(`no guard tear for ${clause.name}`)
      const torn = tear(scenario, clause, base)
      if (torn === undefined) continue
      const problems = problemsOf(scenario, stepOf(scenario, torn.mutate))
      expect(problems.join('\n'), `${scenario.id} guard ${clause.name}`).toMatch(torn.expected)
    }
    for (const clause of effects) {
      const tear = EFFECT_TEARS[clause.name]
      if (tear === undefined) throw new Error(`no effect tear for ${clause.name}`)
      const torn = tear(scenario, clause, base)
      if (torn === undefined) continue
      const problems = problemsOf(scenario, stepOf(scenario, undefined, torn.mutate))
      expect(problems.join('\n'), `${scenario.id} effect ${clause.name}`).toMatch(torn.expected)
    }
  })

  it('rejects a change outside may_change', () => {
    const allowsFailingTc = clausesOf(scenario, stepOf(scenario).evidence.table).effects.some(clause => clause.name === 'tc.status_to' && list(arg(clause, 'to')).includes('failing'))
    const mutate = (files: Files): unknown => (allowsFailingTc ? setField(files, BUG_004, 'status', 'in_progress') : setField(files, TC_008_12, 'status', 'failing'))
    const problems = problemsOf(scenario, stepOf(scenario, undefined, mutate))
    expect(problems.join('\n')).toMatch(allowsFailingTc ? /\[BUG-PLAT-004\]: changed bug_status:in_progress, which is not in this step's may_change/ : /\[TC-PLAT-008-12\]: changed tc_status:failing, which is not in this step's may_change/)
  })
})

describe('step-level checks', () => {
  const t01 = SCENARIOS[0]
  if (t01 === undefined) throw new Error('no scenarios')

  it('reports an unknown predicate instead of skipping it', () => {
    const step = stepOf(t01)
    expect(checkClauses(step.evidence, [{ name: 'req.made_up', args: {} }])).toEqual(['req.made_up: no such predicate is implemented'])
  })

  it('rejects a transition step that also moves another REQ, and an event that moves its REQ', () => {
    const moved = stepOf(t01, undefined, files => setField(files, REQ_009, 'owner', 'planner-001'))
    expect(problemsOf(t01, moved)).toEqual(['REQ-PLAT-009: a step changes the status or owner of its own REQ only'])
    const event = SCENARIOS.find(scenario => scenario.id === 'regression')
    if (event === undefined) throw new Error('no regression scenario')
    const own = stepOf(event, undefined, files => setField(files, REQ_009, 'owner', 'planner-001'))
    expect(problemsOf(event, own)).toEqual([
      'REQ-PLAT-009: an event leaves the REQ status and owner unchanged',
      "[REQ-PLAT-009]: changed req.owner, which is not in this step's may_change",
    ])
  })

  it('treats a REQ absent from the pre-step tree as draft owned by a human, and reads roles from uid prefixes without a registry', () => {
    const files = workspaceFiles()
    const loaded = loadTables(files)
    const pre = { ...files }
    removeFile(pre, REQ_010)
    const post = { ...files }
    setField(post, REQ_010, 'status', 'req_review')
    setField(post, REQ_010, 'owner', 'planner-901')
    const created = evidence({ pre: graphOf(pre, loaded.contract), post: graphOf(post, loaded.contract), table: loaded.table, contract: loaded.contract, reqId: 'REQ-PLAT-010' })
    expect(created.statusBefore()).toBe('draft')
    expect(created.roleBefore()).toBe('human')
    expect(created.roleAfter()).toBe('planner')
    expect(created.roleOf('nobody')).toBe('')
    const t01Transition = transitionById(loaded.table, 'T01')
    if (t01Transition === undefined) throw new Error('no T01')
    expect(checkTransition(created, t01Transition)).toEqual([])
    expect(changedReqs(created.pre, created.post)).toEqual(['REQ-PLAT-010'])
  })

  it('relaxes pending_bugs_in only for self-carried BUGs and ignores pending BUGs that do not exist', () => {
    const t16 = SCENARIOS.find(scenario => scenario.id === 'T16')
    if (t16 === undefined) throw new Error('no T16')
    const guard = { name: 'pending_bugs_in', args: { states: ['closed'], self_carried_states: ['resolved', 'closed'] } }
    const foreign = stepOf(t16, (files) => { files[BUG_007] = bug007('resolved') })
    expect(checkClauses(foreign.evidence, [guard])).toEqual(['REQ-PLAT-009.pending_bugs: [BUG-PLAT-007] are not yet in the accepted states [closed] (self-carried BUGs: [closed, resolved])'])
    const self = stepOf(t16, (files) => { files[BUG_007] = bug007('resolved', 'REQ-PLAT-009') })
    expect(checkClauses(self.evidence, [guard])).toEqual([])
    const unknown = stepOf(t16, files => setField(files, REQ_009, 'pending_bugs', '[BUG-PLAT-404]'))
    expect(checkClauses(unknown.evidence, [guard])).toEqual([])
  })

  it('enforces the from state of bug.status_to and names a field-less counter clause', () => {
    const t16 = SCENARIOS.find(scenario => scenario.id === 'T16')
    if (t16 === undefined) throw new Error('no T16')
    const reopened = stepOf(t16, files => setField(files, BUG_003, 'status', 'open'))
    expect(problemsOf(t16, reopened)).toEqual(["BUG-PLAT-003.status: moved from 'open'; this effect moves only from [closed]"])
    expect(checkClauses(reopened.evidence, [{ name: 'req.counter_inc', args: {} }])).toEqual(['req.counter_inc: the field argument is missing'])
  })

  it('checks gate rounds against the pre-step section and the post-step review_round', () => {
    const t03 = SCENARIOS.find(scenario => scenario.id === 'T03')
    if (t03 === undefined) throw new Error('no T03')
    const skipped = stepOf(t03, undefined, (files) => { files[RV_010] = rv010('PASS', 2, 'evaluator-001') })
    expect(problemsOf(t03, skipped)).toEqual(['RV-PLAT-010.req_review: the round is 2; the pre-step section had 0; expected 1'])
    const unsynced = stepOf(t03, undefined, files => setField(files, REQ_010, 'review_round', '2'))
    expect(problemsOf(t03, unsynced)).toEqual([
      'REQ-PLAT-010.review_round: 0 before, 2 after; expected 1',
      'RV-PLAT-010.req_review: round 1 does not equal the post-step review_round 2',
    ])
    const roundless = stepOf(t03, (files) => { files[RV_010] = rv010('REJECT', 1, 'evaluator-001').replace('(round 1, ', '(') })
    expect(problemsOf(t03, roundless)).toEqual([])
    const unsigned = stepOf(t03, undefined, (files) => { files[RV_010] = rv010('PASS', 1, 'evaluator-001').replace('Conclusion: PASS', 'Conclusion: MAYBE') })
    expect(problemsOf(t03, unsigned)).toEqual(['RV-PLAT-010.req_review: the conclusion is missing; the declared transition requires PASS'])
    const rejected = stepOf(t03, undefined, (files) => { files[RV_010] = rv010('REJECT', 1, 'evaluator-001') })
    expect(problemsOf(t03, rejected)).toEqual(['RV-PLAT-010.req_review: the conclusion is REJECT; the declared transition requires PASS'])
  })

  it('treats a REQ deleted by the step as absent', () => {
    const deleted = stepOf(t01, undefined, (files) => { removeFile(files, REQ_010) })
    const problems = problemsOf(t01, deleted)
    expect(problems.slice(0, 2)).toEqual([
      "REQ-PLAT-010.status: after the step it is ''; this transition ends in 'req_review'",
      'REQ-PLAT-010.owner: after the step the owner\'s role is (unregistered); the hand-over role is planner',
    ])
    expect(problems.slice(2)).toHaveLength(6)
    expect(problems.slice(2).every(problem => problem.includes("which is not in this step's may_change"))).toBe(true)
    expect(deleted.evidence.policy()).toBe('')
  })

  it('accepts a withdrawn regression line when the RV disappears and rejects withdrawing unrelated lines', () => {
    const t19 = SCENARIOS.find(scenario => scenario.id === 'T19')
    if (t19 === undefined) throw new Error('no T19')
    expect(problemsOf(t19, stepOf(t19, undefined, (files) => { removeFile(files, RV_008) }))).toEqual([])
    const unrelated = '2026-09-13 | evaluator-002 | sample-2 | TC-PLAT-008-12 | passed'
    const trimmed = stepOf(t19, (files) => { files[RV_008] = rv008(true).replace('## regression\n\n', `## regression\n\n${unrelated}\n`) }, (files) => { files[RV_008] = rv008(false) })
    expect(problemsOf(t19, trimmed)).toEqual([`RV-PLAT-008.regression: withdrew the unrelated line '${unrelated}'`])
  })

  it('judges created and deleted TCs and BUGs, requires a non-optional status effect to move something, and misses a removed section', () => {
    const t15 = SCENARIOS.find(scenario => scenario.id === 'T15')
    if (t15 === undefined) throw new Error('no T15')
    const churn = stepOf(t15, undefined, files => removeFile(files, TC_008_12))
    expect(checkClauses(churn.evidence, [
      { name: 'tc.status_to', args: { scope: 'any', to: 'failing', optional: true } },
      { name: 'bug.status_to', args: { scope: 'any', to: 'open', optional: true } },
    ])).toEqual([])
    const t06 = SCENARIOS.find(scenario => scenario.id === 'T06')
    if (t06 === undefined) throw new Error('no T06')
    const idle = stepOf(t06, undefined, (files) => {
      for (const path of Object.keys(files)) if (/\/TC-PLAT-009-\d{2}\.md$/.test(path)) setField(files, path, 'status', 'draft')
    })
    expect(problemsOf(t06, idle)).toEqual(['REQ-PLAT-009: this effect requires TCs set to [reviewed]; none changed'])
    const removed = stepOf(t06, undefined, files => editBody(files, RV_009, body => body.replace(/\n## tc_review\n[\s\S]*?(?=\n## )/, '')))
    expect(problemsOf(t06, removed)).toContain('RV-PLAT-009.tc_review: the conclusion is missing; the declared transition requires PASS')
  })

  it('treats current_owner as satisfied, skips pending questions of an absent REQ, and handles pr_number reuse and absence', () => {
    const step = stepOf(t01)
    expect(checkClauses(step.evidence, [{ name: 'req.owner_role_is', args: { role: 'current_owner' } }])).toEqual([])
    const files = workspaceFiles()
    const loaded = loadTables(files)
    const before = { ...files }
    removeFile(before, REQ_010)
    const absent = evidence({ pre: graphOf(before, loaded.contract), post: graphOf(files, loaded.contract), table: loaded.table, contract: loaded.contract, reqId: 'REQ-PLAT-010' })
    expect(checkClauses(absent, [{ name: 'req.pending_questions_empty', args: {} }])).toEqual([])
    const t11 = SCENARIOS.find(scenario => scenario.id === 'T11')
    if (t11 === undefined) throw new Error('no T11')
    const clause = { name: 'req.pr_number_eq_event', args: {} }
    const noEvent = stepOf(t11)
    expect(checkClauses({ ...noEvent.evidence, eventPr: undefined }, [clause])).toEqual([])
    const reused = stepOf(t11, files => setField(files, REQ_009, 'pr_number', '26'))
    expect(checkClauses({ ...reused.evidence, eventPr: 99 }, [clause])).toEqual([])
    const renumbered = stepOf(t11, files => setField(files, REQ_009, 'pr_number', '26'), files => setField(files, REQ_009, 'pr_number', '99'))
    expect(checkClauses(renumbered.evidence, [clause])).toEqual(['REQ-PLAT-009.pr_number: after the step it is 99; the event PR number is 26'])
  })

  it('derives restore pairs from the source state, pr_draft, and self-carriage', () => {
    const pairs = SCENARIOS.filter(scenario => scenario.id.startsWith('T15')).map(scenario => [scenario.id, restorePairFor(stepOf(scenario).evidence)])
    expect(pairs).toEqual([
      ['T15', ['req_review', 'planner']],
      ['T15@pr_draft', ['req_impl', 'generator']],
      ['T15@self-carried', ['req_review', 'planner']],
    ])
    expect(restorePairFor(stepOf(t01).evidence)).toEqual(['', ''])
  })

  it('lists every sensitive change between two trees, deletions included', () => {
    const files = workspaceFiles()
    const loaded = loadTables(files)
    const post = { ...files }
    setField(post, REQ_009, 'review_round', '9')
    setField(post, TC_009_01, 'status', 'failing')
    setField(post, BUG_003, 'status', 'resolved')
    removeFile(post, TC_008_12)
    removeFile(post, BUG_004)
    post['lifecycle/tasks/bugs/platform/BUG-PLAT-007.md'] = bug007('open')
    post['lifecycle/tasks/bugs/platform/BUG-PLAT-008.md'] = bug007('resolved').replace('BUG-PLAT-007', 'BUG-PLAT-008')
    post['lifecycle/tasks/test-cases/platform/TC-PLAT-009-22.md'] = String(files[TC_009_01]).replace(/TC-PLAT-009-01/g, 'TC-PLAT-009-22')
    editBody(post, RV_009, body => body.replace('## tc_review\n\nConclusion: PASS (round 2', '## tc_review\n\nConclusion: PASS (round 3'))
    post[RV_008] = rv008(true)
    const delta = sensitiveDelta(graphOf(files, loaded.contract), graphOf(post, loaded.contract), loaded.table)
    expect(delta).toEqual({
      'req.review_round': ['REQ-PLAT-009'],
      'tc_status:failing': ['TC-PLAT-009-01'],
      'tc_status:passing': ['TC-PLAT-008-12'],
      'bug_status:resolved': ['BUG-PLAT-003', 'BUG-PLAT-008'],
      'bug_status:closed': ['BUG-PLAT-004'],
      'rv:tc_review': ['RV-PLAT-009'],
      'rv:regression': ['RV-PLAT-008'],
    })
    const removed = { ...files }
    removeFile(removed, RV_009)
    expect(Object.keys(sensitiveDelta(graphOf(files, loaded.contract), graphOf(removed, loaded.contract), loaded.table)).sort()).toEqual(['rv:req_impl_review', 'rv:req_review', 'rv:tc_impl_review', 'rv:tc_review'])
  })
})
