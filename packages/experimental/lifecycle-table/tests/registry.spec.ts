import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import {
  effortFor,
  loadAgentRegistry,
  loadIdScheme,
  loadLifecycleTable,
  seatFor,
  type AgentRegistry,
  type LifecycleTable,
} from '@deepseek-ai/dsh-experimental-lifecycle-table'

type Yaml = Record<string, unknown>

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
const tableText = read('lifecycle.yml')
const registryText = read('agent-registry.yml')

function table(): LifecycleTable {
  const load = loadLifecycleTable(tableText)
  if (load.table === undefined) throw new Error(load.problems.join('\n'))
  return load.table
}

function edited(edit: (doc: Yaml) => void): string {
  const doc = parse(registryText) as Yaml
  edit(doc)
  return stringify(doc)
}

function agent(doc: Yaml, uid: string): Yaml {
  const found = (doc.agents as Yaml[]).find(entry => entry.uid === uid)
  if (found === undefined) throw new Error(`fixture has no agent ${uid}`)
  return found
}

function registry(text = registryText): AgentRegistry {
  const load = loadAgentRegistry(text, table(), 'agent-registry.yml')
  if (load.registry === undefined) throw new Error(load.problems.join('\n'))
  return load.registry
}

describe('loadAgentRegistry on the English fixture', () => {
  it('loads every agent with its declared route, vendor, effort, fallbacks, and handles', () => {
    const loaded = registry()
    expect(loaded.activeSet).toBe('mixed')
    expect(Object.keys(loaded.providerSets)).toEqual(['anthropic', 'openai', 'mixed'])
    expect(loaded.providerSets.mixed).toEqual({ kind: 'cross_vendor', planner: 'planner-001', generator: 'generator-001', evaluator: 'evaluator-002' })
    expect(loaded.seats).toEqual({ tc_impl_review: 'evaluator-001' })
    const planner = loaded.agents.find(entry => entry.uid === 'planner-001')
    expect(planner).toMatchObject({
      role: 'planner',
      vendor: 'anthropic',
      route: { provider: 'claude-code', model: 'opus' },
      effort: { default: 'xhigh' },
      fallbacks: [
        { provider: 'claude-code', model: 'sonnet', vendor: 'anthropic' },
        { provider: 'codex', model: 'gpt-5.6-sol', vendor: 'openai' },
      ],
      handles: ['req_review'],
    })
    expect(planner?.notes).toContain('Do not over-prescribe')
    const human = loaded.agents.find(entry => entry.uid === 'human-001')
    expect(human).toMatchObject({ role: 'human', fallbacks: [], handles: ['draft', 'req_review', 'pr_draft', 'blocked', 'done'] })
    expect(human?.route).toBeUndefined()
    expect(human?.effort).toBeUndefined()
    expect(human?.vendor).toBeUndefined()
  })

  it('seats the active set\'s member for a state unless a seat overrides it, and resolves per-state efforts', () => {
    const loaded = registry()
    expect(seatFor(loaded, 'evaluator', 'req_review')).toBe('evaluator-002')
    expect(seatFor(loaded, 'evaluator', 'tc_impl_review')).toBe('evaluator-001')
    expect(seatFor(loaded, 'generator', 'tc_impl')).toBe('generator-001')
    expect(seatFor(loaded, 'human', 'draft')).toBe('human-001')
    expect(seatFor(loaded, 'planner', 'req_review')).toBe('planner-001')
    expect(seatFor(loaded, 'generator', 'tc_impl_review')).toBe('generator-001')
    const generator = loaded.agents.find(entry => entry.uid === 'generator-001')!
    expect(effortFor(generator, 'tc_impl')).toBe('high')
    expect(effortFor(generator, 'req_impl')).toBe('xhigh')
    expect(effortFor(loaded.agents.find(entry => entry.uid === 'human-001')!, 'draft')).toBeUndefined()
  })

  it('falls back to the only agent of a role when no provider sets are declared', () => {
    const loaded = registry(edited((doc) => {
      delete doc.provider_sets
      delete doc.active_set
      delete doc.seats
      delete agent(doc, 'planner-002').description
    }))
    expect(loaded.activeSet).toBeUndefined()
    expect(loaded.providerSets).toEqual({})
    expect(loaded.agents.find(entry => entry.uid === 'planner-002')?.description).toBeUndefined()
    expect(seatFor(loaded, 'human', 'draft')).toBe('human-001')
    expect(seatFor(loaded, 'planner', 'req_review')).toBeUndefined()
  })
})

describe('loadAgentRegistry names each violation', () => {
  it.each<[string, (doc: Yaml) => void, RegExp]>([
    ['a roles section that differs from the table', (doc) => { (doc.roles as Yaml).auditor = 'x' }, /roles differ from lifecycle\.yml: extra \[auditor\]/],
    ['a uid outside <role>-NNN', (doc) => { agent(doc, 'planner-002').uid = 'planner-2' }, /uid 'planner-2' does not match <role>-NNN/],
    ['a uid whose prefix is not its role', (doc) => { agent(doc, 'planner-002').role = 'generator'; agent(doc, 'planner-002').handles = ['tc_review', 'tc_impl', 'req_impl']; delete (doc.provider_sets as Yaml).openai }, /planner-002: uid prefix 'planner' is not its role 'generator'/],
    ['a non-human agent without a route', (doc) => { delete agent(doc, 'planner-002').route }, /planner-002: route \{ provider, model \} is required for a planner/],
    ['a non-human agent without a vendor', (doc) => { delete agent(doc, 'planner-002').vendor }, /planner-002: vendor is required for a planner/],
    ['a non-human agent without an effort', (doc) => { delete agent(doc, 'planner-002').effort }, /planner-002: effort is required for a planner/],
    ['an illegal effort', (doc) => { agent(doc, 'planner-002').effort = 'turbo' }, /planner-002: effort 'turbo' is not one of low, medium, high, xhigh, max/],
    ['a per-state effort without a default', (doc) => { agent(doc, 'planner-002').effort = { req_review: 'high' } }, /planner-002: a per-state effort must declare default/],
    ['a per-state effort keyed by a non-state', (doc) => { agent(doc, 'planner-002').effort = { default: 'high', lunch: 'low' } }, /planner-002: effort key 'lunch' is not a registered state/],
    ['fallbacks that are not routes', (doc) => { agent(doc, 'planner-002').fallbacks = ['gpt-5.6-sol'] }, /planner-002: fallbacks must be a list of \{ provider, model, vendor \} routes/],
    ['handles outside the legal states', (doc) => { (agent(doc, 'planner-002').handles as string[]).push('limbo') }, /planner-002: handles contain unregistered states \[limbo\]/],
    ['handles that differ from the derived role states', (doc) => { agent(doc, 'planner-002').handles = ['req_review', 'tc_design'] }, /planner-002: handles differ from the states lifecycle\.yml derives for planner: extra \[tc_design\], missing \[\]/],
    ['a uid registered twice', (doc) => { (doc.agents as Yaml[]).push({ ...agent(doc, 'generator-002') }) }, /uid generator-002 is registered twice/],
    ['a provider set without a kind', (doc) => { delete ((doc.provider_sets as Yaml).openai as Yaml).kind }, /provider_sets\.openai is missing kind; kinds are same_vendor, cross_vendor/],
    ['a provider set missing a role', (doc) => { delete ((doc.provider_sets as Yaml).openai as Yaml).generator }, /provider_sets\.openai is missing generator/],
    ['a provider set pointing at an unknown uid', (doc) => { ((doc.provider_sets as Yaml).openai as Yaml).generator = 'generator-009' }, /provider_sets\.openai\.generator names the unregistered uid 'generator-009'/],
    ['a provider set seat with the wrong role', (doc) => { ((doc.provider_sets as Yaml).openai as Yaml).generator = 'planner-002' }, /provider_sets\.openai\.generator names planner-002, whose role is planner/],
    ['a same-vendor set mixing vendors', (doc) => { ((doc.provider_sets as Yaml).openai as Yaml).planner = 'planner-001' }, /provider_sets\.openai is same_vendor but mixes \[anthropic, openai\]: \[planner\] is not openai/],
    ['a cross-vendor set whose generator and evaluator share a vendor', (doc) => { ((doc.provider_sets as Yaml).mixed as Yaml).evaluator = 'evaluator-001' }, /provider_sets\.mixed is cross_vendor but its generator and evaluator are both anthropic/],
    ['an active set that is not registered', (doc) => { doc.active_set = 'google' }, /active_set 'google' is not one of the provider sets/],
    ['a seat for an unregistered state', (doc) => { (doc.seats as Yaml).limbo = 'evaluator-001' }, /seats\.limbo is not a registered state/],
    ['a seat naming an unknown uid', (doc) => { (doc.seats as Yaml).tc_impl_review = 'evaluator-009' }, /seats\.tc_impl_review names the unregistered uid 'evaluator-009'/],
    ['a seat whose agent cannot handle the state', (doc) => { (doc.seats as Yaml).tc_impl_review = 'generator-001' }, /seats\.tc_impl_review names generator-001, whose role generator has no legal work at tc_impl_review/],
    ['a per-state effort with an illegal value', (doc) => { agent(doc, 'planner-002').effort = { default: 'high', tc_impl: 'turbo' } }, /planner-002: effort 'turbo' is not one of low, medium, high, xhigh, max/],
    ['an agent entry that is not a mapping', (doc) => { (doc.agents as unknown[]).push(7) }, /agents entries must be mappings with uid and role strings; found 7/],
    ['an agent with unregistered keys', (doc) => { agent(doc, 'planner-002').color = 'x' }, /planner-002: unregistered keys \[color\]/],
    ['an agent whose role the table does not register', (doc) => { (doc.agents as Yaml[]).push({ uid: 'auditor-001', role: 'auditor', handles: [] }) }, /auditor-001: role 'auditor' is not a registered role/],
    ['handles that are not a list', (doc) => { agent(doc, 'planner-002').handles = 'x' }, /planner-002: handles must be a list of states/],
    ['a provider set that is not a mapping', (doc) => { (doc.provider_sets as Yaml).openai = 7 }, /provider_sets\.openai must be a mapping/],
    ['a provider set with an unknown kind', (doc) => { ((doc.provider_sets as Yaml).openai as Yaml).kind = 'weird' }, /provider_sets\.openai kind "weird" is not one of same_vendor, cross_vendor/],
    ['provider sets without an active set', (doc) => { delete doc.active_set }, /active_set is required when provider sets are declared/],
    ['a seat that is not a uid', (doc) => { (doc.seats as Yaml).tc_impl_review = 7 }, /seats\.tc_impl_review names the unregistered uid '7'/],
  ])('reports %s', (_case, edit, expected) => {
    const load = loadAgentRegistry(edited(edit), table(), 'agent-registry.yml')
    expect(load.registry).toBeUndefined()
    expect(load.problems).toHaveLength(1)
    expect(load.problems[0]).toMatch(expected)
    expect(load.problems[0]?.startsWith('agent-registry.yml: ')).toBe(true)
  })

  it('reports a document that is not a registry as one problem', () => {
    expect(loadAgentRegistry('- nope\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: top level is not a mapping'])
    expect(loadAgentRegistry('version: 1\nroles: {}\nagents: 3\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: agents must be a list of agent mappings'])
    expect(loadAgentRegistry('version: 2\nroles: {}\nagents: []\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: version 2 is not supported; supported integer versions are [1]'])
    expect(loadAgentRegistry('version: 1\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: missing sections [roles, agents]'])
    expect(loadAgentRegistry('version: 1\nroles: { planner: 1 }\nagents: []\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: roles must map role names to descriptions'])
    expect(loadAgentRegistry('version: 1\nroles: {}\nagents: []\nprovider_sets: []\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: provider_sets must map set names to planner / generator / evaluator trios'])
    expect(loadAgentRegistry('version: 1\nroles: {}\nagents: []\nseats: []\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: seats must map states to uids'])
    expect(loadAgentRegistry('version: 1\nroles: {}\nagents: []\nactive_set: 7\n', table(), 'agent-registry.yml').problems).toEqual(['agent-registry.yml: active_set must name a provider set'])
    expect(loadAgentRegistry('version: [', table(), 'agent-registry.yml').problems[0]).toMatch(/agent-registry\.yml: not valid YAML/)
  })
})

describe('loadIdScheme', () => {
  it('loads scope directories with their prefixes and rejects duplicates and non-prefix values', () => {
    const scheme = loadIdScheme(read('id-scheme.yml'), 'id-scheme.yml')
    expect(scheme.problems).toEqual([])
    expect(scheme.scheme?.scopes).toEqual({ 'canonical-bom': 'CBOM', platform: 'PLAT' })
    expect(loadIdScheme('scopes:\n  a: CBOM\n  b: CBOM\n', 'id-scheme.yml').problems).toEqual(['id-scheme.yml: prefix CBOM is declared for both a and b'])
    expect(loadIdScheme('scopes:\n  a: cbom\n', 'id-scheme.yml').problems).toEqual(['id-scheme.yml: scopes.a prefix \'cbom\' must be 1 to 6 uppercase letters'])
    expect(loadIdScheme('scopes: []\n', 'id-scheme.yml').problems).toEqual(['id-scheme.yml: scopes must map scope directories to prefixes'])
    expect(loadIdScheme('- x\n', 'id-scheme.yml').problems).toEqual(['id-scheme.yml: top level is not a mapping'])
  })
})
