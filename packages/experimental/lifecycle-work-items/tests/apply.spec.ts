import { transitionById, type PredicateClause } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import { describe, expect, it } from 'vitest'
import {
  checkEvent,
  checkTransition,
  editFrontmatter,
  evidence,
  planEffects,
  type ArtifactGraph,
  type EffectPlanInputs,
  type StepDecisions,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import {
  BUG_003,
  BUG_004,
  BUG_005,
  REQ_009,
  REQ_010,
  TC_009_01,
  dropField,
  graphOf,
  loadTables,
  setField,
  workspaceFiles,
  type Files,
  type Loaded,
} from './lint-helper.ts'

const BUG_006 = 'lifecycle/tasks/bugs/platform/BUG-PLAT-006.md'
import { SCENARIOS, type Scenario } from './step-scenarios.ts'

const ownerFor = (role: string): string | undefined => (role === 'nobody' ? undefined : role === 'human' ? 'human-001' : `${role}-001`)

function clausesOf(scenario: Scenario, loaded: Loaded): readonly PredicateClause[] {
  if (scenario.kind === 'event') {
    const event = loaded.table.events[scenario.id]
    if (event === undefined) throw new Error(`no event ${scenario.id}`)
    return event.effects
  }
  const transition = transitionById(loaded.table, scenario.id.split('@')[0] ?? scenario.id)
  if (transition === undefined) throw new Error(`no transition ${scenario.id}`)
  return transition.effects
}

function plan(
  files: Files,
  loaded: Loaded,
  reqId: string,
  clauses: readonly PredicateClause[],
  decisions: StepDecisions,
  eventPr?: number,
  owner = ownerFor,
): ReturnType<typeof planEffects> {
  const graph = graphOf(files, loaded.contract)
  const inputs: EffectPlanInputs = {
    graph,
    table: loaded.table,
    contract: loaded.contract,
    registry: loaded.registry,
    reqId,
    clauses,
    decisions,
    eventPr,
    ownerFor: owner,
    read: label => String(files[label]),
  }
  return planEffects(inputs)
}

function applied(files: Files, writes: ReturnType<typeof planEffects>['writes']): Files {
  const next = { ...files }
  for (const write of writes) next[write.path] = write.text
  return next
}

function facts(graph: ArtifactGraph, reqId: string): unknown {
  return {
    req: graph.reqs.get(reqId)?.fm,
    tcs: [...graph.tcs.values()].map(tc => [tc.id, tc.status]),
    bugs: [...graph.bugs.values()].map(bug => [bug.id, bug.status]),
    regressions: [...graph.rvs.values()].map(rv => [rv.id, rv.regression.map(line => line.raw)]),
  }
}

describe.each(SCENARIOS)('$id', (scenario) => {
  it('plans the effect edits that make the step complete', () => {
    const pre = workspaceFiles()
    scenario.pre(pre)
    const child = { ...pre }
    scenario.child(child)
    const loaded = loadTables(pre)
    const result = plan(child, loaded, scenario.reqId, clausesOf(scenario, loaded), scenario.decisions, scenario.eventPr)
    expect(result.problems).toEqual([])
    const post = applied(child, result.writes)
    const expected = { ...child }
    scenario.effects(expected)
    expect(facts(graphOf(post, loaded.contract), scenario.reqId)).toEqual(facts(graphOf(expected, loaded.contract), scenario.reqId))
    const step = evidence({
      pre: graphOf(pre, loaded.contract),
      post: graphOf(post, loaded.contract),
      table: loaded.table,
      contract: loaded.contract,
      registry: loaded.registry,
      reqId: scenario.reqId,
      eventPr: scenario.eventPr,
    })
    if (scenario.kind === 'event') {
      const event = loaded.table.events[scenario.id]
      if (event === undefined) throw new Error(`no event ${scenario.id}`)
      expect(checkEvent(step, event)).toEqual([])
    } else {
      const transition = transitionById(loaded.table, scenario.id.split('@')[0] ?? scenario.id)
      if (transition === undefined) throw new Error(`no transition ${scenario.id}`)
      expect(checkTransition(step, transition)).toEqual([])
    }
    for (const write of result.writes) expect(write.text, write.path).not.toBe(child[write.path])
  })
})

describe('planEffects', () => {
  const t01 = SCENARIOS[0]
  if (t01 === undefined) throw new Error('no scenarios')

  it('reports what it cannot decide, apply, or resolve', () => {
    const files = workspaceFiles()
    const loaded = loadTables(files)
    const t15 = transitionById(loaded.table, 'T15')
    if (t15 === undefined) throw new Error('no T15')
    setField(files, REQ_009, 'status', 'req_review')
    const undecided = plan(files, loaded, 'REQ-PLAT-009', t15.effects, {})
    expect(undecided.problems).toEqual(['req.fields_set: no value decided for pending_bugs', 'req.fields_set: no value decided for blocked_reason'])
    const nobody = plan(files, loaded, 'REQ-PLAT-010', [{ name: 'req.owner_role_to', args: { role: 'nobody' } }], {})
    expect(nobody.problems).toEqual(['req.owner_role_to: no agent takes role nobody at draft'])
    const unknown = plan(files, loaded, 'REQ-PLAT-010', [{ name: 'req.made_up', args: {} }], {})
    expect(unknown.problems).toEqual(['req.made_up: no such effect can be applied'])
    const missing = plan(files, loaded, 'REQ-PLAT-404', [{ name: 'req.status_to', args: { state: 'done' } }], {})
    expect(missing.problems).toEqual(['REQ-PLAT-404: not in the tree'])
    expect(missing.writes).toEqual([])
    expect(plan(files, loaded, 'REQ-PLAT-010', [{ name: 'req.counter_inc', args: {} }], {}).problems).toEqual(['req.counter_inc: the field argument is missing'])
    expect(plan(files, loaded, 'REQ-PLAT-009', [{ name: 'bug.status_to', args: { scope: 'own', to: 'closed' } }], {}).problems).toEqual(["bug.status_to: unknown scope 'own'; BUG scopes are [carried, any]"])
    expect(plan(files, loaded, 'REQ-PLAT-009', [{ name: 'tc.status_to', args: { scope: 'carried', to: 'draft' } }], {}).problems).toEqual(["tc.status_to: unknown scope 'carried'; TC scopes are [own, own_and_carried, any]"])
  })

  it('validates decided TC and BUG statuses against scope and allowed values, and asks for decisions when an effect admits several values', () => {
    const files = workspaceFiles()
    const loaded = loadTables(files)
    const own: PredicateClause = { name: 'tc.status_to', args: { scope: 'own', to: 'reviewed' } }
    const outside = plan(files, loaded, 'REQ-PLAT-009', [own], { tcStatuses: { 'TC-PLAT-008-12': 'reviewed' } })
    expect(outside.problems).toEqual(["tc.status_to: TC-PLAT-008-12 is outside this effect's scope (own)"])
    const illegal = plan(files, loaded, 'REQ-PLAT-009', [own], { tcStatuses: { 'TC-PLAT-009-01': 'failing' } })
    expect(illegal.problems).toEqual(["tc.status_to: TC-PLAT-009-01 status 'failing' is not one of [reviewed]"])
    const several: PredicateClause = { name: 'tc.status_to', args: { scope: 'own', to: ['passing', 'failing'] } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [several], {}).problems).toEqual(['tc.status_to: decide a status for each TC in scope own; allowed [passing, failing]'])
    const optional: PredicateClause = { name: 'tc.status_to', args: { scope: 'own', to: ['passing', 'failing'], optional: true } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [optional], {})).toEqual({ writes: [], problems: [] })
    const carried: PredicateClause = { name: 'bug.status_to', args: { scope: 'carried', to: 'resolved' } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [carried], { bugStatuses: { 'BUG-PLAT-007': 'resolved' } }).problems).toEqual(["bug.status_to: BUG-PLAT-007 is outside this effect's scope (carried)"])
    const anyBug: PredicateClause = { name: 'bug.status_to', args: { scope: 'any', to: 'resolved' } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [anyBug], {}).writes.map(write => write.path)).toHaveLength(4)
    const excluding: PredicateClause = { name: 'tc.status_to', args: { scope: 'own', to: 'reviewed', exclude_carried_origin: true } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [excluding], {}).writes).toHaveLength(21)
    const withCarried: PredicateClause = { name: 'tc.status_to', args: { scope: 'own_and_carried', to: 'failing' } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [withCarried], {}).writes).toHaveLength(22)
    const any: PredicateClause = { name: 'tc.status_to', args: { scope: 'any', to: 'failing' } }
    const everywhere = plan(files, loaded, 'REQ-PLAT-009', [any], { tcStatuses: { 'TC-PLAT-008-12': 'failing' } })
    expect(everywhere.writes.map(write => write.path)).toEqual(['lifecycle/tasks/test-cases/platform/TC-PLAT-008-12.md'])
    const keep: PredicateClause = { name: 'tc.status_to', args: { scope: 'any', to: 'passing' } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [keep], { tcStatuses: { 'TC-PLAT-009-01': 'passing' } })).toEqual({ writes: [], problems: [] })
    setField(files, BUG_003, 'status', 'open')
    const reopen: PredicateClause = { name: 'bug.status_to', args: { scope: 'carried', from: 'closed', to: 'resolved' } }
    expect(plan(files, loaded, 'REQ-PLAT-009', [reopen], {}).writes.map(write => write.path)).toEqual([BUG_004, BUG_005, BUG_006])
    dropField(files, REQ_010, 'review_round')
    const counted = plan(files, loaded, 'REQ-PLAT-010', [{ name: 'req.counter_inc', args: { field: 'review_round' } }], {})
    expect(String(counted.writes[0]?.text)).toContain('\nreview_round: 1\n')
  })

  it('reuses an existing pr_number and skips the PR effect without an event number', () => {
    const files = workspaceFiles()
    const loaded = loadTables(files)
    const clause: PredicateClause = { name: 'req.pr_number_eq_event', args: {} }
    expect(plan(files, loaded, 'REQ-PLAT-009', [clause], {}, 99).writes).toEqual([])
    expect(plan(files, loaded, 'REQ-PLAT-010', [clause], {}).writes).toEqual([])
    const set = plan(files, loaded, 'REQ-PLAT-010', [clause], {}, 99)
    expect(set.writes.map(write => write.path)).toEqual([REQ_010])
    expect(String(set.writes[0]?.text)).toContain('\npr_number: 99\n')
  })

  it('skips restore-bound effects when the restore target differs and writes verify-only effects nowhere', () => {
    const files = workspaceFiles()
    const loaded = loadTables(files)
    setField(files, REQ_009, 'status', 'blocked')
    setField(files, REQ_009, 'blocked_from_status', 'tc_impl')
    setField(files, REQ_009, 'blocked_from_owner', 'generator')
    const gated: PredicateClause[] = [
      { name: 'tc.status_to', args: { scope: 'own', to: 'draft', only_restore: 'req_review', optional: true } },
      { name: 'rv.regression_withdrawn', args: { only_restore: 'req_review' } },
      { name: 'rv.gate_signed', args: { section: 'req_review', verdict: 'PASS' } },
      { name: 'rv.section_changed', args: { section: 'external_review' } },
      { name: 'req.counter_inc', args: { field: 'review_round', only_from: 'req_review' } },
    ]
    expect(plan(files, loaded, 'REQ-PLAT-009', gated, {})).toEqual({ writes: [], problems: [] })
    setField(files, REQ_009, 'blocked_from_status', 'req_review')
    setField(files, REQ_009, 'blocked_from_owner', 'planner')
    expect(plan(files, loaded, 'REQ-PLAT-009', gated, {}).writes).toHaveLength(21)
  })

  it('keeps the frontmatter layout, comments, and scalar quoting when editing fields', () => {
    const text = [
      '---',
      'req_id: REQ-PLAT-001 # the id',
      "title: 'quoted title'",
      'status: draft',
      'pending_bugs: []',
      'blocked_reason: ""',
      'pr_number: null',
      '---',
      '',
      '## Goal',
      '',
      'Body stays byte-identical.',
      '',
    ].join('\n')
    const edited = editFrontmatter(text, { status: 'blocked', pending_bugs: ['BUG-PLAT-001', 'BUG-PLAT-002'], blocked_reason: 'waiting', pr_number: 7, owner: 'human-001' })
    expect(edited).toBe([
      '---',
      'req_id: REQ-PLAT-001 # the id',
      "title: 'quoted title'",
      'status: blocked',
      'pending_bugs: [ BUG-PLAT-001, BUG-PLAT-002 ]',
      'blocked_reason: "waiting"',
      'pr_number: 7',
      'owner: human-001',
      '---',
      '',
      '## Goal',
      '',
      'Body stays byte-identical.',
      '',
    ].join('\n'))
    expect(editFrontmatter(edited, { pending_bugs: [], blocked_reason: '', pr_number: null })).toContain('pending_bugs: []\nblocked_reason: ""\npr_number: null\n')
    expect(() => editFrontmatter('no frontmatter', { status: 'x' })).toThrow('missing YAML frontmatter')
    expect(String(workspaceFiles()[TC_009_01])).toContain('\nstatus: passing\n')
  })
})
