/**
 * The agent registry: which registered agent takes each role seat, on which
 * dsh route, with which reasoning effort and fallbacks. Loading checks the
 * registry against the lifecycle table so `handles` never drifts from the
 * states the table derives for a role.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-table/registry
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { legalReqStatuses, roleStates } from './table.ts'
import type {
  AgentRegistry,
  AgentRegistryLoad,
  AgentRoute,
  AgentUid,
  FallbackRoute,
  LifecycleTable,
  ProviderSet,
  ReasoningEffort,
  RegisteredAgent,
} from './types.ts'
import { fail, isMapping, list, ok, readMapping, stringList, type Parsed, type YamlMapping } from './yaml.ts'

const SUPPORTED_VERSIONS: readonly number[] = [1]
const SECTIONS = ['roles', 'agents'] as const
const HUMAN_ROLE = 'human'
const UID = /^[a-z]+-\d{3}$/
const EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_SET: ReadonlySet<string> = new Set(EFFORTS)
const DEFAULT_EFFORT_KEY = 'default'
const SET_KINDS: readonly ProviderSet['kind'][] = ['same_vendor', 'cross_vendor']
const SET_ROLES = ['planner', 'generator', 'evaluator'] as const
type SetRole = (typeof SET_ROLES)[number]
const AGENT_KEYS: ReadonlySet<string> = new Set(['uid', 'role', 'description', 'notes', 'vendor', 'route', 'effort', 'fallbacks', 'handles'])


function isEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && EFFORT_SET.has(value)
}

function isRoute(value: unknown): value is AgentRoute & YamlMapping {
  return isMapping(value) && typeof value.provider === 'string' && typeof value.model === 'string'
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseEffort(who: string, raw: unknown, states: ReadonlySet<string>): Parsed<Readonly<Record<string, ReasoningEffort>>> {
  if (isEffort(raw)) return ok({ [DEFAULT_EFFORT_KEY]: raw })
  if (!isMapping(raw)) return fail(`${who}: effort '${String(raw)}' is not one of ${EFFORTS.join(', ')}`)
  if (!(DEFAULT_EFFORT_KEY in raw)) return fail(`${who}: a per-state effort must declare ${DEFAULT_EFFORT_KEY}`)
  const effort: Record<string, ReasoningEffort> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key !== DEFAULT_EFFORT_KEY && !states.has(key)) return fail(`${who}: effort key '${key}' is not a registered state`)
    if (!isEffort(value)) return fail(`${who}: effort '${String(value)}' is not one of ${EFFORTS.join(', ')}`)
    effort[key] = value
  }
  return ok(effort)
}

function parseFallbacks(who: string, raw: unknown): Parsed<readonly FallbackRoute[]> {
  const entries = raw ?? []
  if (!Array.isArray(entries) || !entries.every((entry): entry is FallbackRoute & YamlMapping => isRoute(entry) && typeof entry.vendor === 'string')) {
    return fail(`${who}: fallbacks must be a list of { provider, model, vendor } routes`)
  }
  return ok(entries.map(entry => ({ provider: entry.provider, model: entry.model, vendor: entry.vendor })))
}

function parseAgent(entry: unknown, table: LifecycleTable, derived: Readonly<Record<string, readonly string[]>>): Parsed<RegisteredAgent> {
  if (!isMapping(entry) || typeof entry.uid !== 'string' || typeof entry.role !== 'string') {
    return fail(`agents entries must be mappings with uid and role strings; found ${JSON.stringify(entry)}`)
  }
  const { uid, role } = entry
  const unknown = Object.keys(entry).filter(key => !AGENT_KEYS.has(key))
  if (unknown.length > 0) return fail(`${uid}: unregistered keys ${list(unknown)}`)
  if (!UID.test(uid)) return fail(`uid '${uid}' does not match <role>-NNN`)
  const prefix = uid.slice(0, uid.lastIndexOf('-'))
  if (prefix !== role) return fail(`${uid}: uid prefix '${prefix}' is not its role '${role}'`)
  const legal = derived[role]
  if (legal === undefined) return fail(`${uid}: role '${role}' is not a registered role`)
  const handles = stringList(entry.handles)
  if (handles === undefined) return fail(`${uid}: handles must be a list of states`)
  const states = new Set(legalReqStatuses(table))
  const illegal = handles.filter(state => !states.has(state))
  if (illegal.length > 0) return fail(`${uid}: handles contain unregistered states ${list(illegal)}`)
  const extra = handles.filter(state => !legal.includes(state))
  const missing = legal.filter(state => !handles.includes(state))
  if (extra.length > 0 || missing.length > 0) {
    return fail(`${uid}: handles differ from the states lifecycle.yml derives for ${role}: extra ${list(extra)}, missing ${list(missing)}`)
  }
  const fallbacks = parseFallbacks(uid, entry.fallbacks)
  if (!fallbacks.ok) return fail(fallbacks.problem)
  const common = {
    uid: brandString<AgentUid>(uid),
    role,
    fallbacks: fallbacks.value,
    handles,
    ...optionalString(entry.description) === undefined ? {} : { description: String(entry.description) },
    ...optionalString(entry.notes) === undefined ? {} : { notes: String(entry.notes) },
  }
  if (role === HUMAN_ROLE) return ok(common)
  if (!isRoute(entry.route)) return fail(`${uid}: route { provider, model } is required for a ${role}`)
  if (typeof entry.vendor !== 'string') return fail(`${uid}: vendor is required for a ${role}`)
  if (entry.effort === undefined) return fail(`${uid}: effort is required for a ${role}`)
  const effort = parseEffort(uid, entry.effort, states)
  if (!effort.ok) return fail(effort.problem)
  return ok({
    ...common,
    vendor: entry.vendor,
    route: { provider: entry.route.provider, model: entry.route.model },
    effort: effort.value,
  })
}

function memberOf(set: ProviderSet, role: string): AgentUid | undefined {
  switch (role) {
    case 'planner':
      return set.planner
    case 'generator':
      return set.generator
    case 'evaluator':
      return set.evaluator
    default:
      return undefined
  }
}

function parseProviderSet(name: string, raw: unknown, agents: ReadonlyMap<string, RegisteredAgent>): Parsed<ProviderSet> {
  const where = `provider_sets.${name}`
  if (!isMapping(raw)) return fail(`${where} must be a mapping`)
  const kind = raw.kind
  if (kind === undefined) return fail(`${where} is missing kind; kinds are ${SET_KINDS.join(', ')}`)
  if (kind !== 'same_vendor' && kind !== 'cross_vendor') {
    return fail(`${where} kind ${JSON.stringify(kind)} is not one of ${SET_KINDS.join(', ')}`)
  }
  const members: Partial<Record<SetRole, AgentUid>> = {}
  const vendors: Partial<Record<SetRole, string>> = {}
  for (const role of SET_ROLES) {
    const uid = raw[role]
    if (typeof uid !== 'string') return fail(`${where} is missing ${role}`)
    const agent = agents.get(uid)
    if (agent === undefined) return fail(`${where}.${role} names the unregistered uid '${uid}'`)
    if (agent.role !== role) return fail(`${where}.${role} names ${uid}, whose role is ${agent.role}`)
    members[role] = agent.uid
    vendors[role] = String(agent.vendor)
  }
  const distinct = [...new Set(Object.values(vendors))].sort()
  if (kind === 'same_vendor' && distinct.length > 1) {
    const all = Object.values(vendors)
    const count = (vendor: string): number => all.filter(candidate => candidate === vendor).length
    const majority = String([...distinct].sort((a, b) => count(b) - count(a))[0])
    const odd = SET_ROLES.filter(role => vendors[role] !== majority)
    return fail(`${where} is same_vendor but mixes ${list(distinct)}: ${list(odd)} is not ${majority}`)
  }
  if (kind === 'cross_vendor' && vendors.generator === vendors.evaluator) {
    return fail(`${where} is cross_vendor but its generator and evaluator are both ${String(vendors.generator)}`)
  }
  return ok({
    kind,
    planner: brandString<AgentUid>(String(members.planner)),
    generator: brandString<AgentUid>(String(members.generator)),
    evaluator: brandString<AgentUid>(String(members.evaluator)),
  })
}

interface Shape {
  readonly roles: YamlMapping
  readonly agents: readonly unknown[]
  readonly providerSets: YamlMapping
  readonly seats: YamlMapping
  readonly activeSet: string | undefined
}

function parseShape(doc: YamlMapping, table: LifecycleTable): Parsed<Shape> {
  const version = doc.version
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.includes(version)) {
    return fail(`version ${String(version)} is not supported; supported integer versions are ${list(SUPPORTED_VERSIONS.map(String))}`)
  }
  const missing = SECTIONS.filter(section => !(section in doc))
  if (missing.length > 0) return fail(`missing sections ${list(missing)}`)
  const { roles, agents } = doc
  const providerSets = doc.provider_sets ?? {}
  const seats = doc.seats ?? {}
  const activeSet = doc.active_set
  if (!isMapping(roles) || !Object.values(roles).every(value => typeof value === 'string')) return fail('roles must map role names to descriptions')
  if (!Array.isArray(agents)) return fail('agents must be a list of agent mappings')
  if (!isMapping(providerSets)) return fail('provider_sets must map set names to planner / generator / evaluator trios')
  if (!isMapping(seats)) return fail('seats must map states to uids')
  if (activeSet !== undefined && typeof activeSet !== 'string') return fail('active_set must name a provider set')
  const extra = Object.keys(roles).filter(role => !table.roles.includes(role))
  const absent = table.roles.filter(role => !(role in roles))
  if (extra.length > 0 || absent.length > 0) return fail(`roles differ from lifecycle.yml: extra ${list(extra)}, missing ${list(absent)}`)
  return ok({ roles, agents, providerSets, seats, activeSet })
}

/**
 * Load an agent registry from its YAML text and check it against the loaded
 * lifecycle table. A structural failure reports the first root cause only;
 * agent problems are reported together before the provider sets and seats,
 * which reference agents, are checked.
 * @param text - the `agent-registry.yml` text.
 * @param table - the loaded lifecycle table the registry must agree with.
 * @param label - file label prefixed to every problem.
 * @returns the registry with no problems, or no registry with the problems.
 */
export function loadAgentRegistry(text: string, table: LifecycleTable, label = 'agent-registry.yml'): AgentRegistryLoad {
  const read = readMapping(text, label)
  if (read.doc === undefined) return { registry: undefined, problems: [read.problem] }
  const shape = parseShape(read.doc, table)
  if (!shape.ok) return { registry: undefined, problems: [`${label}: ${shape.problem}`] }
  const roles = Object.fromEntries(Object.entries(shape.value.roles).map(([role, description]) => [role, String(description)]))
  const derived = roleStates(table)
  const agents = new Map<string, RegisteredAgent>()
  const problems: string[] = []
  for (const entry of shape.value.agents) {
    const parsed = parseAgent(entry, table, derived)
    if (!parsed.ok) {
      problems.push(`${label}: ${parsed.problem}`)
      continue
    }
    if (agents.has(parsed.value.uid)) problems.push(`${label}: uid ${parsed.value.uid} is registered twice`)
    agents.set(parsed.value.uid, parsed.value)
  }
  if (problems.length > 0) return { registry: undefined, problems }

  const providerSets: Record<string, ProviderSet> = {}
  for (const [name, raw] of Object.entries(shape.value.providerSets)) {
    const parsed = parseProviderSet(name, raw, agents)
    if (!parsed.ok) {
      problems.push(`${label}: ${parsed.problem}`)
      continue
    }
    providerSets[name] = parsed.value
  }
  const { activeSet } = shape.value
  if (activeSet !== undefined && !(activeSet in shape.value.providerSets)) {
    problems.push(`${label}: active_set '${activeSet}' is not one of the provider sets`)
  }
  if (activeSet === undefined && Object.keys(shape.value.providerSets).length > 0) {
    problems.push(`${label}: active_set is required when provider sets are declared`)
  }
  const seats: Record<string, AgentUid> = {}
  const states = legalReqStatuses(table)
  for (const [state, uid] of Object.entries(shape.value.seats)) {
    if (!states.includes(state)) {
      problems.push(`${label}: seats.${state} is not a registered state`)
      continue
    }
    const agent = typeof uid === 'string' ? agents.get(uid) : undefined
    if (agent === undefined) {
      problems.push(`${label}: seats.${state} names the unregistered uid '${String(uid)}'`)
      continue
    }
    if (!agent.handles.includes(state)) {
      problems.push(`${label}: seats.${state} names ${agent.uid}, whose role ${agent.role} has no legal work at ${state}`)
      continue
    }
    seats[state] = agent.uid
  }
  if (problems.length > 0) return { registry: undefined, problems }
  return {
    registry: { version: 1, roles, providerSets, activeSet, seats, agents: [...agents.values()] },
    problems: [],
  }
}

/**
 * The agent that takes a role at a state: the seat override when it names an
 * agent of that role, else the active provider set's member, else the only
 * registered agent of the role that handles the state.
 * @param registry - the loaded registry.
 * @param role - the role that owns the state.
 * @param state - the REQ status.
 * @returns the uid, or `undefined` when no single agent is responsible.
 */
export function seatFor(registry: AgentRegistry, role: string, state: string): AgentUid | undefined {
  const seat = registry.seats[state]
  const seated = seat === undefined ? undefined : registry.agents.find(agent => agent.uid === seat)
  if (seated !== undefined && seated.role === role) return seated.uid
  const set = registry.activeSet === undefined ? undefined : registry.providerSets[registry.activeSet]
  const member = set === undefined ? undefined : memberOf(set, role)
  if (member !== undefined) return member
  const candidates = registry.agents.filter(agent => agent.role === role && agent.handles.includes(state)).map(agent => agent.uid)
  return candidates.length === 1 ? candidates[0] : undefined
}

/**
 * The reasoning effort an agent works with at a state.
 * @param agent - a registered agent.
 * @param state - the REQ status.
 * @returns the per-state effort, else the default, else `undefined` for agents without efforts (humans).
 */
export function effortFor(agent: RegisteredAgent, state: string): ReasoningEffort | undefined {
  return agent.effort === undefined ? undefined : agent.effort[state] ?? agent.effort[DEFAULT_EFFORT_KEY]
}
