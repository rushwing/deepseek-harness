import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import {
  loadLifecycleTable,
  reachableStates,
  requiredGates,
  restoreRoles,
  roleStates,
  sensitiveKinds,
  signerOf,
  statusIndex,
  transitionById,
  type LifecycleTable,
} from '@deepseek-ai/dsh-experimental-lifecycle-table'

const fixtureText = readFileSync(fileURLToPath(new URL('./fixtures/lifecycle.yml', import.meta.url)), 'utf8')

type Yaml = Record<string, unknown>

/** The fixture with one structural edit applied to its parsed document. */
function edited(edit: (doc: Yaml) => void): string {
  const doc = parse(fixtureText) as Yaml
  edit(doc)
  return stringify(doc)
}

function transitions(doc: Yaml): Yaml[] {
  return doc.transitions as Yaml[]
}

function transition(doc: Yaml, id: string): Yaml {
  const found = transitions(doc).find(entry => entry.id === id)
  if (found === undefined) throw new Error(`fixture has no transition ${id}`)
  return found
}

function problemsOf(text: string): readonly string[] {
  return loadLifecycleTable(text, 'lifecycle.yml').problems
}

function tableOf(text: string): LifecycleTable {
  const load = loadLifecycleTable(text, 'lifecycle.yml')
  if (load.table === undefined) throw new Error(load.problems.join('\n'))
  return load.table
}

describe('loadLifecycleTable on the English fixture', () => {
  const table = tableOf(fixtureText)

  it('loads the version 2 table with every registered section', () => {
    expect(table.version).toBe(2)
    expect(table.states.req).toEqual(['draft', 'req_review', 'tc_design', 'tc_review', 'tc_impl', 'tc_impl_review', 'req_impl', 'req_impl_review', 'pr_draft', 'done'])
    expect(table.states.reqOffChain).toEqual(['blocked'])
    expect(table.roles).toEqual(['planner', 'generator', 'evaluator', 'human'])
    expect(table.transitions.map(entry => entry.id)).toEqual([
      'T01', 'T02', 'T03', 'T03b', 'T03c', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17', 'T18', 'T19',
    ])
    expect(Object.keys(table.events)).toEqual(['bug_fix', 'bug_verify', 'regression', 'external_review', 'bug_redirect'])
    expect(table.predicates.code).toEqual(['req.restore_pair_set'])
    expect(table.predicates.data['tc.status_to']).toEqual(['scope', 'to', 'exclude_carried_origin', 'optional', 'only_restore'])
  })

  it('keeps the structured slots of T15, T16, and T19', () => {
    expect(transitionById(table, 'T15')).toMatchObject({
      from: { kind: 'any-of', states: ['req_review', 'tc_review', 'tc_impl_review', 'req_impl_review', 'pr_draft'] },
      actor: { kind: 'special', name: 'current_owner' },
      to: { kind: 'name', name: 'blocked' },
      ownerAfter: { kind: 'name', name: 'human' },
    })
    expect(transitionById(table, 'T16')).toMatchObject({
      to: { kind: 'special', name: 'restore_state' },
      ownerAfter: { kind: 'special', name: 'restore_owner' },
    })
    expect(transitionById(table, 'T19')).toMatchObject({ exemptFromHardStop: true })
    expect(transitionById(table, 'T01')).toMatchObject({ exemptFromHardStop: false, guards: [{ name: 'req.status_in', args: { states: ['draft'] } }, { name: 'req.owner_role_is', args: { role: 'human' } }] })
    expect(transitionById(table, 'T99')).toBeUndefined()
  })

  it('derives each role\'s legal states from named actors and hand-overs only', () => {
    expect(roleStates(table)).toEqual({
      planner: ['req_review'],
      generator: ['tc_review', 'tc_impl', 'req_impl'],
      evaluator: ['req_review', 'tc_design', 'tc_impl_review', 'req_impl_review'],
      human: ['draft', 'req_review', 'pr_draft', 'done', 'blocked'],
    })
  })

  it('derives the review gates a state requires and the states each tc_policy can reach', () => {
    expect(requiredGates(table, 'with_tc', 'req_impl')).toEqual(['req_review', 'tc_review', 'tc_impl_review'])
    expect(requiredGates(table, 'exempt', 'done')).toEqual(['req_review'])
    expect(requiredGates(table, 'optional_no_tc', 'done')).toEqual(['req_review', 'req_impl_review'])
    expect(requiredGates(table, 'with_tc', 'blocked')).toEqual([])
    expect(requiredGates(table, 'unknown', 'done')).toEqual([])
    expect(reachableStates(table, 'required')).toEqual(table.states.req)
    expect(reachableStates(table, 'unknown')).toEqual(['draft', 'req_review'])
    expect(reachableStates(table, 'optional_no_tc')).toEqual(['draft', 'req_review', 'req_impl', 'req_impl_review', 'pr_draft', 'done'])
    expect(reachableStates(table, 'exempt')).toEqual(['draft', 'req_review', 'pr_draft', 'done'])
    expect(statusIndex(table, 'tc_impl')).toBe(4)
    expect(statusIndex(table, 'blocked')).toBe(-1)
    expect(signerOf(table, 'tc_review')).toBe('generator')
    expect(signerOf(table, 'regression')).toBeUndefined()
    expect(restoreRoles(table)).toEqual({ req_review: 'planner', tc_design: 'evaluator', tc_impl: 'generator', req_impl: 'generator' })
  })

  it('lists the lifecycle-sensitive kinds may_change may name', () => {
    const kinds = sensitiveKinds(table)
    for (const kind of ['req.status', 'req.blocked_from_owner', 'tc_status:passing', 'bug_status:closed', 'rv:req_review', 'rv:regression', 'rv:external_review']) {
      expect(kinds).toContain(kind)
    }
    expect(kinds).not.toContain('rv:回归')
  })
})

describe('loadLifecycleTable reports one problem per root cause', () => {
  it.each<[string, string, RegExp]>([
    ['invalid YAML', 'version: [2', /not valid YAML/],
    ['a non-mapping document', '- just\n- a list\n', /top level is not a mapping/],
    ['an unsupported version', edited((doc) => { doc.version = 3 }), /version 3 is not supported/],
    ['a boolean version', edited((doc) => { doc.version = true }), /version true is not supported/],
    ['an unknown top-level key', edited((doc) => { doc.extras = [] }), /unknown top-level keys \[extras\]/],
    ['a missing section', edited((doc) => { delete doc.gates }), /missing sections \[gates\]/],
    ['a states section that is not a mapping', edited((doc) => { doc.states = [] }), /section states must be a mapping/],
    ['an unregistered states key', edited((doc) => { (doc.states as Yaml).epic = [] }), /states has unregistered keys \[epic\]/],
    ['a duplicated main-chain state', edited((doc) => { ((doc.states as Yaml).req as string[]).push('draft') }), /states\.req has duplicates \[draft\]/],
    ['an extra main-chain state', edited((doc) => { ((doc.states as Yaml).req as string[]).push('shipped') }), /states\.req has extra items \[shipped\]/],
    ['a reordered main chain', edited((doc) => { const req = (doc.states as Yaml).req as string[]; [req[0], req[1]] = [req[1]!, req[0]!] }), /states\.req order differs .* item 1 is 'req_review', version 1 fixed 'draft'/],
    ['a missing main-chain state', edited((doc) => { (doc.states as Yaml).req = ((doc.states as Yaml).req as string[]).filter(state => state !== 'pr_draft') }), /states\.req is missing \[pr_draft\]/],
    ['a transition with unregistered keys', edited((doc) => { transition(doc, 'T01').note = 'x' }), /transition T01 has unregistered keys \[note\]/],
    ['a transition slot that is neither a name nor a special value', edited((doc) => { transition(doc, 'T01').from = 7 }), /transition T01: from is not a state name, a role name, or a structured special value/],
    ['an unregistered predicate', edited((doc) => { (transition(doc, 'T01').guards as Yaml[]).push({ 'req.is_shiny': {} }) }), /transition T01: guards reference the unregistered predicate 'req\.is_shiny'/],
    ['a may_change kind outside the closed set', edited((doc) => { (transition(doc, 'T01').may_change as string[]).push('req.mood') }), /transition T01: may_change names 'req\.mood', which is not a registered lifecycle-sensitive kind/],
    ['a may_change value that is not a registered status', edited((doc) => { (transition(doc, 'T01').may_change as string[]).push('tc_status:golden') }), /transition T01: may_change names 'tc_status:golden', whose value is not a registered status or review section/],
    ['a subject shape without the line anchor', edited((doc) => { transition(doc, 'T01').subjects = ['lifecycle: T01 — \\S'] }), /transition T01: subject shape 'lifecycle: T01 — \\S' does not start with '\^'/],
    ['a subject shape naming the wrong transition', edited((doc) => { transition(doc, 'T01').subjects = ['^lifecycle: T02 — \\S'] }), /transition T01: subject shape .* names transitions \[T02\]; each shape must name exactly T01/],
    ['an event subject naming a transition', edited((doc) => { ((doc.events as Yaml).regression as Yaml).subjects = ['^lifecycle: T13 regression — \\S'] }), /event regression: subject shape .* names transitions \[T13\]; event subjects never name a transition/],
    ['overlapping subject shapes', edited((doc) => { ((doc.events as Yaml).bug_verify as Yaml).subjects = ['^fix: BUG-[A-Z]+-\\d{3} — \\S'] }), /subject shapes \['\^fix: BUG-\[A-Z\]\+-\\d\{3\} — \\S'\] overlap between bug_fix and bug_verify/],
    ['an event touching the REQ status', edited((doc) => { (((doc.events as Yaml).bug_fix as Yaml).may_change as string[]).push('req.status') }), /event bug_fix: may_change touches \[req\.status\]; events never change the REQ status or owner/],
    ['a table without the events section', edited((doc) => { delete doc.events }), /missing sections \[events\]/],
    ['a table without the predicates section', edited((doc) => { delete doc.predicates }), /missing sections \[predicates\]/],
    ['a transition without its registrations', edited((doc) => { delete transition(doc, 'T05').guards; delete transition(doc, 'T05').effects }), /transition T05 is missing registrations \[guards, effects\]/],
    ['a states list that is not a list', edited((doc) => { (doc.states as Yaml).tc = 'x' }), /states \[tc\] must be lists of state names/],
    ['a roles section that is not a list', edited((doc) => { doc.roles = {} }), /section roles must be a list of role names/],
    ['a gates section that is not a list', edited((doc) => { doc.gates = {} }), /section gates must be a list/],
    ['a gate entry without its two strings', edited((doc) => { (doc.gates as unknown[]).push(7) }), /gates entries carry exactly a section and a signer string; found 7/],
    ['an exits section that is not a mapping', edited((doc) => { doc.exits = [] }), /section exits must be a mapping \(got array\)/],
    ['a TC status matrix that is not a mapping', edited((doc) => { doc.tc_status_by_state = null }), /section tc_status_by_state must be a mapping \(got null\)/],
    ['an exit column that is not a list', edited((doc) => { (doc.exits as Yaml).exempt = 'T03b' }), /exits\.exempt must be a list of transition ids/],
    ['a pass_to_enter section that is not a mapping', edited((doc) => { doc.pass_to_enter = [] }), /section pass_to_enter must be a mapping/],
    ['a pass_to_enter column that is not a mapping', edited((doc) => { (doc.pass_to_enter as Yaml).exempt = [] }), /section pass_to_enter\.exempt must be a mapping/],
    ['a restore target without its three strings', edited((doc) => { (doc.restore_targets as unknown[]).push({ via: 'T04' }) }), /restore_targets entries carry exactly via, state, and owner strings/],
    ['a transition entry without an id', edited((doc) => { transitions(doc).push({ from: 'draft' }) }), /transitions entries must be mappings with a string id/],
    ['an empty any_of slot', edited((doc) => { transition(doc, 'T01').from = { any_of: [] } }), /transition T01: from is not a state name/],
    ['a non-boolean exemption', edited((doc) => { transition(doc, 'T19').exempt_from_hard_stop = 'yes' }), /transition T19: exempt_from_hard_stop must be a boolean/],
    ['subjects that are not strings', edited((doc) => { transition(doc, 'T01').subjects = 'x' }), /transition T01: subjects and may_change must be lists of strings/],
    ['guards that are not a list', edited((doc) => { transition(doc, 'T01').guards = 7 }), /transition T01: guards and effects must be lists of single-key predicate mappings/],
    ['a guard that is not a mapping', edited((doc) => { transition(doc, 'T01').guards = [7] }), /transition T01: guards and effects must be lists/],
    ['a guard with two predicate names', edited((doc) => { transition(doc, 'T01').guards = [{ a: {}, b: {} }] }), /transition T01: guards and effects must be lists/],
    ['a guard whose arguments are not a mapping', edited((doc) => { transition(doc, 'T01').guards = [{ 'req.status_in': 3 }] }), /transition T01: guards and effects must be lists/],
    ['an events section that is not a mapping', edited((doc) => { doc.events = [] }), /section events must be a mapping/],
    ['an event that is not a mapping', edited((doc) => { (doc.events as Yaml).bug_fix = 7 }), /event bug_fix must be a mapping/],
    ['an event with unregistered keys', edited((doc) => { ((doc.events as Yaml).bug_fix as Yaml).note = 'x' }), /event bug_fix has unregistered keys \[note\]/],
    ['an event without req_unchanged', edited((doc) => { delete ((doc.events as Yaml).bug_fix as Yaml).req_unchanged }), /event bug_fix must declare req_unchanged: true/],
    ['an event whose subjects are not strings', edited((doc) => { ((doc.events as Yaml).bug_fix as Yaml).subjects = 7 }), /event bug_fix: subjects and may_change must be lists of strings/],
    ['an event without effects', edited((doc) => { ((doc.events as Yaml).bug_fix as Yaml).effects = [] }), /event bug_fix is missing registrations \[effects\]/],
    ['an event effect changing the REQ status', edited((doc) => { (((doc.events as Yaml).bug_fix as Yaml).effects as Yaml[]).push({ 'req.status_to': { state: 'done' } }) }), /event bug_fix: effects \[req\.status_to\] change the REQ status or owner; events never do/],
    ['a predicates section with extra subsections', edited((doc) => { (doc.predicates as Yaml).extra = 1 }), /section predicates carries exactly the data and code subsections/],
    ['predicate data that is not a mapping', edited((doc) => { (doc.predicates as Yaml).data = [] }), /section predicates\.data must be a mapping/],
    ['predicate code that is not a list', edited((doc) => { (doc.predicates as Yaml).code = 'x' }), /predicates\.code must be a list of predicate names/],
  ])('reports %s', (_case, text, expected) => {
    const problems = problemsOf(text)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(expected)
    expect(problems[0]?.startsWith('lifecycle.yml: ')).toBe(true)
  })

  it.each<[string, (doc: Yaml) => void, RegExp]>([
    ['a malformed transition id', (doc) => { const entry = transition(doc, 'T05'); entry.id = 'X5'; entry.subjects = ['^lifecycle: X5 — \\S'] }, /transition id 'X5' does not match T<NN>\[a-z\]/],
    ['a duplicated transition id', (doc) => { transitions(doc).push({ ...transition(doc, 'T05') }) }, /transition T05 is registered twice/],
    ['exempt_from_hard_stop outside T19', (doc) => { transition(doc, 'T03').exempt_from_hard_stop = false }, /transition T03 declares exempt_from_hard_stop; only T19 may/],
    ['T19 without its exemption', (doc) => { delete transition(doc, 'T19').exempt_from_hard_stop }, /transition T19 must declare exempt_from_hard_stop/],
    ['any_of outside T15 and T19', (doc) => { transition(doc, 'T05').from = { any_of: ['tc_design'] } }, /transition T05: from may not use any_of/],
    ['a special value in the wrong slot', (doc) => { transition(doc, 'T05').actor = { special: 'current_owner' } }, /transition T05: actor may not use the special value 'current_owner'/],
    ['an unregistered role in actor', (doc) => { transition(doc, 'T05').actor = 'auditor' }, /transition T05: actor 'auditor' is not a registered role/],
    ['an unregistered state in any_of', (doc) => { (((transition(doc, 'T15').from as Yaml).any_of) as string[]).push('limbo') }, /transition T15: from references unregistered states \[limbo\]/],
    ['an exit that does not start at req_review', (doc) => { (doc.exits as Yaml).exempt = ['T03b', 'T05'] }, /exits\.exempt: exit T05 starts at 'tc_design'; exits start at req_review/],
    ['a forward transition leaving req_review without an exit registration', (doc) => { (doc.exits as Yaml).exempt = [] }, /forward transitions leaving req_review .* \[T03b\]/],
    ['a gate whose signer is not legal at its state', (doc) => { (doc.gates as Yaml[])[1] = { section: 'tc_review', signer: 'planner' } }, /review gate tc_review is signed by planner, but planner has no legal work at tc_review/],
    ['a pass_to_enter reference to an unknown gate', (doc) => { ((doc.pass_to_enter as Yaml).exempt as Yaml).done = ['security_review'] }, /pass_to_enter\.exempt\.done references unregistered review gates \[security_review\]/],
    ['a TC status matrix missing a main-chain state', (doc) => { delete (doc.tc_status_by_state as Yaml).done }, /tc_status_by_state is missing main-chain states \[done\]/],
    ['a restore target whose pair disagrees with its transition', (doc) => { (doc.restore_targets as Yaml[])[0] = { via: 'T04', state: 'req_review', owner: 'evaluator' } }, /restore target T04 records \(req_review, evaluator\), but transition T04 hands over \(req_review, planner\)/],
    ['the wrong number of restore targets', (doc) => { (doc.restore_targets as Yaml[]).pop() }, /restore_targets must have exactly 4 entries, found 3/],
    ['an exit column outside the four tc_policy values', (doc) => { (doc.exits as Yaml).sometimes = ['T03'] }, /exits has unregistered tc_policy columns \[sometimes\]/],
    ['an exit naming an unregistered transition', (doc) => { (doc.exits as Yaml).exempt = ['T03b', 'T77'] }, /exits\.exempt: exit T77 is not a registered transition/],
    ['an exit with a structured origin', (doc) => { (doc.exits as Yaml).exempt = ['T03b', 'T19'] }, /exits\.exempt: exit T19 starts at 'a structured slot'; exits start at req_review/],
    ['an exit that ends off the main chain', (doc) => { transition(doc, 'T03b').to = 'blocked' }, /exits\.exempt: exit T03b does not end on the main chain/],
    ['an exit that stays in req_review', (doc) => { (doc.exits as Yaml).exempt = ['T03b', 'T04'] }, /exits\.exempt: exit T04 still ends at req_review/],
    ['a review gate registered twice', (doc) => { (doc.gates as Yaml[]).push({ section: 'req_review', signer: 'evaluator' }) }, /review gate req_review is registered twice/],
    ['a review gate with an unregistered signer', (doc) => { (doc.gates as Yaml[])[1] = { section: 'tc_review', signer: 'auditor' } }, /review gate tc_review names the unregistered signer 'auditor'/],
    ['a pass_to_enter column outside the three policies', (doc) => { (doc.pass_to_enter as Yaml).sometimes = {} }, /pass_to_enter has the unregistered column 'sometimes'/],
    ['a pass_to_enter state off the main chain', (doc) => { ((doc.pass_to_enter as Yaml).exempt as Yaml).blocked = ['req_review'] }, /pass_to_enter\.exempt keys 'blocked', which is not a main-chain state/],
    ['a TC status matrix keyed off the main chain', (doc) => { (doc.tc_status_by_state as Yaml).blocked = ['draft'] }, /tc_status_by_state keys \[blocked\], which are not main-chain states/],
    ['a TC status matrix naming an unregistered status', (doc) => { ((doc.tc_status_by_state as Yaml).done as string[]).push('golden') }, /tc_status_by_state\.done names unregistered TC statuses \[golden\]/],
    ['a restore target through an unregistered transition', (doc) => { ((doc.restore_targets as Yaml[])[0] as Yaml).via = 'T77' }, /restore target T77 names an unregistered transition/],
    ['a restore target through a transition with a structured hand-over', (doc) => { (doc.restore_targets as Yaml[])[0] = { via: 'T16', state: 'req_review', owner: 'planner' } }, /restore target T16 records \(req_review, planner\), but transition T16 hands over \(a structured slot, a structured slot\)/],
  ])('names %s as the single self-consistency problem', (_case, edit, expected) => {
    const problems = problemsOf(edited(edit))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(expected)
  })

  it('reports independent self-consistency problems together', () => {
    expect(problemsOf(edited((doc) => { delete (doc.exits as Yaml).exempt }))).toEqual([
      'lifecycle.yml: exits is missing tc_policy columns [exempt]',
      'lifecycle.yml: forward transitions leaving req_review without an exit registration [T03b]',
    ])
    expect(problemsOf(edited((doc) => { (doc.restore_targets as Yaml[])[1] = { via: 'T04', state: 'req_review', owner: 'planner' } }))).toEqual([
      'lifecycle.yml: restore targets repeat the transition [T04]; every entry must differ',
      'lifecycle.yml: restore targets repeat the restore state [req_review]; every entry must differ',
    ])
  })
})
