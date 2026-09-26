/**
 * The lifecycle state table: YAML loading with one problem per root cause,
 * the enumerations version 1 fixed, the subject / guard / effect / may_change
 * registrations version 2 added, the content self-consistency checks, and the derivations consumers read instead of
 * keeping literal copies of the table.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-table/table
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {
  LifecycleEvent,
  LifecycleStates,
  LifecycleTable,
  LifecycleTableLoad,
  PredicateClause,
  PredicateVocabulary,
  RestoreTarget,
  ReviewGate,
  Transition,
  TransitionId,
  TransitionSlot,
} from './types.ts'
import { fail, isMapping, list, ok, quotedList, readMapping, stringList, typeName, type Parsed, type YamlMapping } from './yaml.ts'

const SUPPORTED_VERSIONS: readonly number[] = [2]
const SECTIONS = [
  'states', 'roles', 'gates', 'exits', 'pass_to_enter', 'tc_status_by_state', 'restore_targets', 'transitions', 'events', 'predicates',
] as const
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['version', ...SECTIONS])
const STATE_KINDS = ['req', 'req_off_chain', 'tc', 'bug'] as const
const STATE_KIND_SET: ReadonlySet<string> = new Set(STATE_KINDS)
const TRANSITION_SLOTS = ['from', 'actor', 'to', 'owner_after'] as const
const REGISTRATION_KEYS = ['subjects', 'guards', 'effects', 'may_change'] as const
const TRANSITION_KEYS: ReadonlySet<string> = new Set(['id', 'exempt_from_hard_stop', ...TRANSITION_SLOTS, ...REGISTRATION_KEYS])
const EVENT_KEYS: ReadonlySet<string> = new Set(['req_unchanged', ...REGISTRATION_KEYS])
/** Registrations an event must fill; events may legitimately have no guards. */
const EVENT_REQUIRED_KEYS = ['subjects', 'effects', 'may_change'] as const
const EXIT_POLICIES = ['required', 'optional_with_tc', 'optional_no_tc', 'exempt'] as const
const EXIT_POLICY_SET: ReadonlySet<string> = new Set(EXIT_POLICIES)
const PASS_COLUMNS: ReadonlySet<string> = new Set(['with_tc', 'optional_no_tc', 'exempt'])
const RESTORE_TARGET_COUNT = 4
const EXEMPT_TRANSITION = 'T19'
const REVIEW_STATE = 'req_review'
const TRANSITION_ID = /^T\d{2}[a-z]?$/
const SUBJECT_ANCHOR = '^'
/** The REQ frontmatter fields whose change is lifecycle-sensitive. */
const REQ_SENSITIVE_FIELDS = [
  'status', 'owner', 'review_round', 'pr_number', 'pending_bugs', 'blocked_reason', 'blocked_from_status', 'blocked_from_owner',
] as const
/** Review-record sections `rv:<section>` may name beyond the gates. */
const EXTRA_RV_SECTIONS = ['regression', 'external_review'] as const
/** Predicate and kind prefixes an event may never touch. */
const EVENT_FORBIDDEN = ['req.status', 'req.owner'] as const
const PREFIXED_KINDS = ['tc_status:', 'bug_status:', 'rv:'] as const
/** The only slots that may carry a structured value, and which one. */
const SPECIAL_SLOTS: Readonly<Record<string, string>> = {
  'T15.from': 'any_of',
  'T19.from': 'any_of',
  'T15.actor': 'current_owner',
  'T16.to': 'restore_state',
  'T16.owner_after': 'restore_owner',
}
type V1Key = 'states.req' | 'states.req_off_chain' | 'states.tc' | 'states.bug' | 'roles'
const V1_KEYS: readonly V1Key[] = ['states.req', 'states.req_off_chain', 'states.tc', 'states.bug', 'roles']
/** The enumerations version 1 fixed; every supported version keeps them verbatim. */
const V1_ENUMS: Readonly<Record<V1Key, readonly string[]>> = {
  'states.req': [
    'draft', 'req_review', 'tc_design', 'tc_review', 'tc_impl', 'tc_impl_review', 'req_impl', 'req_impl_review', 'pr_draft', 'done',
  ],
  'states.req_off_chain': ['blocked'],
  'states.tc': ['draft', 'reviewed', 'implemented', 'passing', 'failing'],
  'states.bug': ['open', 'in_progress', 'blocked', 'resolved', 'closed'],
  'roles': ['planner', 'generator', 'evaluator', 'human'],
}

interface Registration {
  readonly subjects: readonly string[]
  readonly guards: readonly PredicateClause[]
  readonly effects: readonly PredicateClause[]
  readonly mayChange: readonly string[]
}


function optional<T>(value: unknown, parse: (value: unknown) => T | undefined, empty: T): T | undefined {
  return value === undefined ? empty : parse(value)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseStates(label: string, raw: unknown): Parsed<LifecycleStates> {
  if (!isMapping(raw)) return fail(`${label}: section states must be a mapping (got ${typeName(raw)})`)
  const unknown = Object.keys(raw).filter(key => !STATE_KIND_SET.has(key))
  if (unknown.length > 0) return fail(`${label}: states has unregistered keys ${list(unknown)}`)
  const req = stringList(raw.req)
  const reqOffChain = stringList(raw.req_off_chain)
  const tc = stringList(raw.tc)
  const bug = stringList(raw.bug)
  if (req === undefined || reqOffChain === undefined || tc === undefined || bug === undefined) {
    const bad = STATE_KINDS.filter(kind => stringList(raw[kind]) === undefined)
    return fail(`${label}: states ${list(bad)} must be lists of state names`)
  }
  return ok({ req, reqOffChain, tc, bug })
}

function parseEntries<T>(label: string, section: string, raw: unknown, parseEntry: (entry: unknown) => Parsed<T>): Parsed<T[]> {
  if (!Array.isArray(raw)) return fail(`${label}: section ${section} must be a list (got ${typeName(raw)})`)
  const values: T[] = []
  for (const entry of raw) {
    const parsed = parseEntry(entry)
    if (!parsed.ok) return fail(parsed.problem)
    values.push(parsed.value)
  }
  return ok(values)
}

function parseGate(label: string, entry: unknown): Parsed<ReviewGate> {
  if (!isMapping(entry) || typeof entry.section !== 'string' || typeof entry.signer !== 'string' || Object.keys(entry).length !== 2) {
    return fail(`${label}: gates entries carry exactly a section and a signer string; found ${JSON.stringify(entry)}`)
  }
  return ok({ section: entry.section, signer: entry.signer })
}

function parseRestoreTarget(label: string, entry: unknown): Parsed<RestoreTarget> {
  if (!isMapping(entry) || typeof entry.via !== 'string' || typeof entry.state !== 'string' || typeof entry.owner !== 'string'
    || Object.keys(entry).length !== 3) {
    return fail(`${label}: restore_targets entries carry exactly via, state, and owner strings; found ${JSON.stringify(entry)}`)
  }
  return ok({ via: brandString<TransitionId>(entry.via), state: entry.state, owner: entry.owner })
}

function parseStringListMap(label: string, section: string, raw: unknown, itemNoun: string): Parsed<Record<string, readonly string[]>> {
  if (!isMapping(raw)) return fail(`${label}: section ${section} must be a mapping (got ${typeName(raw)})`)
  const table: Record<string, readonly string[]> = {}
  for (const [key, value] of Object.entries(raw)) {
    const items = stringList(value)
    if (items === undefined) return fail(`${label}: ${section}.${key} must be a list of ${itemNoun}`)
    table[key] = items
  }
  return ok(table)
}

function parsePassToEnter(label: string, raw: unknown): Parsed<Record<string, Readonly<Record<string, readonly string[]>>>> {
  if (!isMapping(raw)) return fail(`${label}: section pass_to_enter must be a mapping (got ${typeName(raw)})`)
  const table: Record<string, Readonly<Record<string, readonly string[]>>> = {}
  for (const [column, states] of Object.entries(raw)) {
    const parsed = parseStringListMap(label, `pass_to_enter.${column}`, states, 'review sections')
    if (!parsed.ok) return fail(parsed.problem)
    table[column] = parsed.value
  }
  return ok(table)
}

function parseSlot(raw: unknown): TransitionSlot | undefined {
  if (typeof raw === 'string') return { kind: 'name', name: raw }
  if (!isMapping(raw) || Object.keys(raw).length !== 1) return undefined
  const states = stringList(raw.any_of)
  if (states !== undefined && states.length > 0) return { kind: 'any-of', states }
  return typeof raw.special === 'string' ? { kind: 'special', name: raw.special } : undefined
}

function parseClause(item: unknown): PredicateClause | undefined {
  if (!isMapping(item) || Object.keys(item).length !== 1) return undefined
  for (const [name, args] of Object.entries(item)) if (isMapping(args)) return { name, args }
  return undefined
}

function parseClauses(value: unknown): readonly PredicateClause[] | undefined {
  if (!Array.isArray(value)) return undefined
  const clauses: PredicateClause[] = []
  for (const item of value) {
    const clause = parseClause(item)
    if (clause === undefined) return undefined
    clauses.push(clause)
  }
  return clauses
}

function parseRegistration(label: string, who: string, entry: YamlMapping): Parsed<Registration> {
  const subjects = optional(entry.subjects, stringList, [])
  const mayChange = optional(entry.may_change, stringList, [])
  if (subjects === undefined || mayChange === undefined) return fail(`${label}: ${who}: subjects and may_change must be lists of strings`)
  const guards = optional(entry.guards, parseClauses, [])
  const effects = optional(entry.effects, parseClauses, [])
  if (guards === undefined || effects === undefined) {
    return fail(`${label}: ${who}: guards and effects must be lists of single-key predicate mappings`)
  }
  return ok({ subjects, guards, effects, mayChange })
}

function parseTransition(label: string, entry: unknown): Parsed<Transition> {
  if (!isMapping(entry) || typeof entry.id !== 'string') {
    return fail(`${label}: transitions entries must be mappings with a string id; found ${JSON.stringify(entry)}`)
  }
  const id = entry.id
  const who = `transition ${id}`
  const unknown = Object.keys(entry).filter(key => !TRANSITION_KEYS.has(key))
  if (unknown.length > 0) return fail(`${label}: ${who} has unregistered keys ${list(unknown)}`)
  const from = parseSlot(entry.from)
  const actor = parseSlot(entry.actor)
  const to = parseSlot(entry.to)
  const ownerAfter = parseSlot(entry.owner_after)
  if (from === undefined || actor === undefined || to === undefined || ownerAfter === undefined) {
    const bad = TRANSITION_SLOTS.filter(key => parseSlot(entry[key]) === undefined)
    return fail(`${label}: ${who}: ${bad.join(', ')} is not a state name, a role name, or a structured special value`)
  }
  const exempt = entry.exempt_from_hard_stop ?? false
  if (typeof exempt !== 'boolean') return fail(`${label}: ${who}: exempt_from_hard_stop must be a boolean`)
  const registration = parseRegistration(label, who, entry)
  if (!registration.ok) return fail(registration.problem)
  return ok({
    id: brandString<TransitionId>(id),
    from,
    actor,
    to,
    ownerAfter,
    exemptFromHardStop: exempt,
    exemptDeclared: 'exempt_from_hard_stop' in entry,
    ...registration.value,
  })
}

function parseEvents(label: string, raw: unknown): Parsed<Record<string, LifecycleEvent>> {
  if (!isMapping(raw)) return fail(`${label}: section events must be a mapping (got ${typeName(raw)})`)
  const events: Record<string, LifecycleEvent> = {}
  for (const [name, entry] of Object.entries(raw)) {
    const who = `event ${name}`
    if (!isMapping(entry)) return fail(`${label}: ${who} must be a mapping (got ${typeName(entry)})`)
    const unknown = Object.keys(entry).filter(key => !EVENT_KEYS.has(key))
    if (unknown.length > 0) return fail(`${label}: ${who} has unregistered keys ${list(unknown)}`)
    if (entry.req_unchanged !== true) return fail(`${label}: ${who} must declare req_unchanged: true`)
    const registration = parseRegistration(label, who, entry)
    if (!registration.ok) return fail(registration.problem)
    events[name] = { name, ...registration.value }
  }
  return ok(events)
}

function parsePredicates(label: string, raw: unknown): Parsed<PredicateVocabulary> {
  if (!isMapping(raw) || Object.keys(raw).some(key => key !== 'data' && key !== 'code')) {
    return fail(`${label}: section predicates carries exactly the data and code subsections`)
  }
  const data = parseStringListMap(label, 'predicates.data', raw.data, 'parameter names')
  if (!data.ok) return fail(data.problem)
  const code = stringList(raw.code)
  if (code === undefined) return fail(`${label}: predicates.code must be a list of predicate names`)
  return ok({ data: data.value, code })
}

function v1EnumProblem(label: string, key: V1Key, actual: readonly string[]): string | undefined {
  const canonical = V1_ENUMS[key]
  const fixture = `version 1 fixed it as ${list(canonical)}`
  const duplicated = [...new Set(actual.filter((item, index) => actual.indexOf(item) !== index))]
  if (duplicated.length > 0) return `${label}: ${key} has duplicates ${list(duplicated)}; ${fixture}`
  const extra = actual.filter(item => !canonical.includes(item))
  if (extra.length > 0) return `${label}: ${key} has extra items ${list(extra)}; ${fixture}`
  const missing = canonical.filter(item => !actual.includes(item))
  if (missing.length > 0) return `${label}: ${key} is missing ${list(missing)}; ${fixture}`
  for (const [index, expected] of canonical.entries()) {
    const item = String(actual[index])
    if (item !== expected) {
      return `${label}: ${key} order differs from the version 1 fixture: item ${index + 1} is '${item}', version 1 fixed '${expected}'`
    }
  }
  return undefined
}

function v1Sections(states: LifecycleStates, roles: readonly string[]): Readonly<Record<V1Key, readonly string[]>> {
  return {
    'states.req': states.req,
    'states.req_off_chain': states.reqOffChain,
    'states.tc': states.tc,
    'states.bug': states.bug,
    'roles': roles,
  }
}

function transitionIdsIn(shape: string, ids: readonly string[]): readonly string[] {
  return ids.filter(id => new RegExp(`\\b${escapeRegExp(id)}\\b`).test(shape))
}

function subjectProblem(
  label: string,
  who: string,
  shapes: readonly string[],
  own: string | undefined,
  ids: readonly string[],
): string | undefined {
  for (const shape of shapes) {
    if (!shape.startsWith(SUBJECT_ANCHOR)) return `${label}: ${who}: subject shape '${shape}' does not start with '${SUBJECT_ANCHOR}'`
    const found = transitionIdsIn(shape, ids)
    if (own === undefined) {
      if (found.length > 0) return `${label}: ${who}: subject shape '${shape}' names transitions ${list(found)}; event subjects never name a transition`
    } else if (found.length !== 1 || found[0] !== own) {
      return `${label}: ${who}: subject shape '${shape}' names transitions ${list(found)}; each shape must name exactly ${own}`
    }
  }
  return undefined
}

function referenceProblem(
  label: string,
  who: string,
  item: Registration,
  registered: ReadonlySet<string>,
  kinds: ReadonlySet<string>,
): string | undefined {
  for (const [key, clauses] of [['guards', item.guards], ['effects', item.effects]] as const) {
    for (const clause of clauses) {
      if (!registered.has(clause.name)) return `${label}: ${who}: ${key} reference the unregistered predicate '${clause.name}'`
    }
  }
  for (const entry of item.mayChange) {
    if (kinds.has(entry)) continue
    return PREFIXED_KINDS.some(prefix => entry.startsWith(prefix))
      ? `${label}: ${who}: may_change names '${entry}', whose value is not a registered status or review section`
      : `${label}: ${who}: may_change names '${entry}', which is not a registered lifecycle-sensitive kind`
  }
  return undefined
}

function overlapProblem(label: string, table: LifecycleTable): string | undefined {
  const registered: readonly (readonly [string, readonly string[]])[] = [
    ...table.transitions.map(item => [item.id, item.subjects] as const),
    ...Object.values(table.events).map(event => [event.name, event.subjects] as const),
  ]
  for (const [index, [who, shapes]] of registered.entries()) {
    for (const [other, otherShapes] of registered.slice(index + 1)) {
      if (who === other) continue
      const shared = shapes.filter(shape => otherShapes.includes(shape))
      if (shared.length > 0) return `${label}: subject shapes ${quotedList(shared)} overlap between ${who} and ${other}`
    }
  }
  return undefined
}

function touchesReq(name: string): boolean {
  return EVENT_FORBIDDEN.some(banned => name === banned || name.startsWith(`${banned}_`))
}

function eventProblem(
  label: string,
  event: LifecycleEvent,
  registered: ReadonlySet<string>,
  kinds: ReadonlySet<string>,
  ids: readonly string[],
): string | undefined {
  const who = `event ${event.name}`
  const gaps = EVENT_REQUIRED_KEYS.filter(key => (key === 'may_change' ? event.mayChange : event[key]).length === 0)
  if (gaps.length > 0) return `${label}: ${who} is missing registrations ${list(gaps)}`
  const effects = event.effects.map(clause => clause.name).filter(touchesReq)
  if (effects.length > 0) return `${label}: ${who}: effects ${list(effects)} change the REQ status or owner; events never do`
  const touched = event.mayChange.filter(touchesReq)
  if (touched.length > 0) return `${label}: ${who}: may_change touches ${list(touched)}; events never change the REQ status or owner`
  return subjectProblem(label, who, event.subjects, undefined, ids) ?? referenceProblem(label, who, event, registered, kinds)
}

function registrationProblem(label: string, table: LifecycleTable): string | undefined {
  const registered = new Set([...Object.keys(table.predicates.data), ...table.predicates.code])
  const kinds = new Set(sensitiveKinds(table))
  const ids = [...new Set(table.transitions.map(item => item.id))]
  for (const item of table.transitions) {
    const who = `transition ${item.id}`
    const gaps = REGISTRATION_KEYS.filter(key => (key === 'may_change' ? item.mayChange : item[key]).length === 0)
    if (gaps.length > 0) return `${label}: ${who} is missing registrations ${list(gaps)}`
    const problem = subjectProblem(label, who, item.subjects, item.id, ids) ?? referenceProblem(label, who, item, registered, kinds)
    if (problem !== undefined) return problem
  }
  const overlap = overlapProblem(label, table)
  if (overlap !== undefined) return overlap
  for (const event of Object.values(table.events)) {
    const problem = eventProblem(label, event, registered, kinds, ids)
    if (problem !== undefined) return problem
  }
  return undefined
}

function slotName(slot: TransitionSlot): string | undefined {
  return slot.kind === 'name' ? slot.name : undefined
}

function slotProblems(label: string, item: Transition, states: ReadonlySet<string>, roles: ReadonlySet<string>): string[] {
  const problems: string[] = []
  const who = `transition ${item.id}`
  const slots: readonly (readonly [string, TransitionSlot, ReadonlySet<string>, string])[] = [
    ['from', item.from, states, 'state'],
    ['actor', item.actor, roles, 'role'],
    ['to', item.to, states, 'state'],
    ['owner_after', item.ownerAfter, roles, 'role'],
  ]
  for (const [key, slot, pool, noun] of slots) {
    const expected = SPECIAL_SLOTS[`${item.id}.${key}`]
    switch (slot.kind) {
      case 'any-of': {
        if (expected !== 'any_of') {
          problems.push(`${label}: ${who}: ${key} may not use any_of`)
          break
        }
        const unknown = slot.states.filter(state => !states.has(state))
        if (unknown.length > 0) problems.push(`${label}: ${who}: ${key} references unregistered states ${list(unknown)}`)
        break
      }
      case 'special':
        if (expected !== slot.name) problems.push(`${label}: ${who}: ${key} may not use the special value '${slot.name}'`)
        break
      case 'name':
        if (!pool.has(slot.name)) problems.push(`${label}: ${who}: ${key} '${slot.name}' is not a registered ${noun}`)
        break
      /* v8 ignore next 2 -- closed-union exhaustiveness guard */
      default:
        assertNever(slot, 'transition slot')
    }
  }
  return problems
}

function transitionProblems(label: string, table: LifecycleTable): string[] {
  const states = new Set(legalReqStatuses(table))
  const roles = new Set(table.roles)
  const problems: string[] = []
  const seen = new Set<string>()
  for (const item of table.transitions) {
    if (!TRANSITION_ID.test(item.id)) problems.push(`${label}: transition id '${item.id}' does not match T<NN>[a-z]`)
    if (seen.has(item.id)) problems.push(`${label}: transition ${item.id} is registered twice`)
    seen.add(item.id)
    if (item.exemptDeclared && item.id !== EXEMPT_TRANSITION) {
      problems.push(`${label}: transition ${item.id} declares exempt_from_hard_stop; only ${EXEMPT_TRANSITION} may`)
    }
    problems.push(...slotProblems(label, item, states, roles))
  }
  const exempt = transitionById(table, EXEMPT_TRANSITION)
  if (exempt === undefined || !exempt.exemptFromHardStop) {
    problems.push(`${label}: transition ${EXEMPT_TRANSITION} must declare exempt_from_hard_stop: true`)
  }
  return problems
}

function isForward(table: LifecycleTable, item: Transition): boolean {
  const origin = slotName(item.from)
  const target = slotName(item.to)
  return origin !== undefined && target !== undefined && statusIndex(table, target) > statusIndex(table, origin)
}

function exitProblems(label: string, table: LifecycleTable): string[] {
  const problems: string[] = []
  const unknownPolicies = Object.keys(table.exits).filter(policy => !EXIT_POLICY_SET.has(policy))
  if (unknownPolicies.length > 0) problems.push(`${label}: exits has unregistered tc_policy columns ${list(unknownPolicies)}`)
  const missingPolicies = EXIT_POLICIES.filter(policy => !(policy in table.exits))
  if (missingPolicies.length > 0) problems.push(`${label}: exits is missing tc_policy columns ${list(missingPolicies)}`)
  const registered = new Set<string>()
  for (const [policy, ids] of Object.entries(table.exits)) {
    for (const id of ids) {
      registered.add(id)
      const item = transitionById(table, id)
      if (item === undefined) {
        problems.push(`${label}: exits.${policy}: exit ${id} is not a registered transition`)
        continue
      }
      const origin = slotName(item.from)
      if (origin !== REVIEW_STATE) {
        problems.push(`${label}: exits.${policy}: exit ${id} starts at '${origin ?? 'a structured slot'}'; exits start at ${REVIEW_STATE}`)
        continue
      }
      const target = slotName(item.to)
      if (target === undefined || statusIndex(table, target) < 0) {
        problems.push(`${label}: exits.${policy}: exit ${id} does not end on the main chain`)
      } else if (target === REVIEW_STATE) {
        problems.push(`${label}: exits.${policy}: exit ${id} still ends at ${REVIEW_STATE}`)
      }
    }
  }
  const orphans = table.transitions
    .filter(item => slotName(item.from) === REVIEW_STATE && isForward(table, item) && !registered.has(item.id))
    .map(item => item.id)
  if (orphans.length > 0) problems.push(`${label}: forward transitions leaving ${REVIEW_STATE} without an exit registration ${list(orphans)}`)
  return problems
}

function gateProblems(label: string, table: LifecycleTable): string[] {
  const problems: string[] = []
  const derived = roleStates(table)
  const sections = new Set<string>()
  for (const gate of table.gates) {
    if (sections.has(gate.section)) problems.push(`${label}: review gate ${gate.section} is registered twice`)
    sections.add(gate.section)
    const legal = derived[gate.signer]
    if (legal === undefined) {
      problems.push(`${label}: review gate ${gate.section} names the unregistered signer '${gate.signer}'`)
    } else if (!legal.includes(gate.section)) {
      problems.push(`${label}: review gate ${gate.section} is signed by ${gate.signer}, but ${gate.signer} has no legal work at ${gate.section}`)
    }
  }
  for (const [column, states] of Object.entries(table.passToEnter)) {
    if (!PASS_COLUMNS.has(column)) problems.push(`${label}: pass_to_enter has the unregistered column '${column}'`)
    for (const [state, gates] of Object.entries(states)) {
      if (statusIndex(table, state) < 0) problems.push(`${label}: pass_to_enter.${column} keys '${state}', which is not a main-chain state`)
      const unknown = gates.filter(gate => !sections.has(gate))
      if (unknown.length > 0) problems.push(`${label}: pass_to_enter.${column}.${state} references unregistered review gates ${list(unknown)}`)
    }
  }
  return problems
}

function repeated(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
}

function matrixAndRestoreProblems(label: string, table: LifecycleTable): string[] {
  const problems: string[] = []
  const extra = Object.keys(table.tcStatusByState).filter(state => statusIndex(table, state) < 0)
  if (extra.length > 0) problems.push(`${label}: tc_status_by_state keys ${list(extra)}, which are not main-chain states`)
  const missing = table.states.req.filter(state => !(state in table.tcStatusByState))
  if (missing.length > 0) problems.push(`${label}: tc_status_by_state is missing main-chain states ${list(missing)}`)
  for (const [state, allowed] of Object.entries(table.tcStatusByState)) {
    const unknown = allowed.filter(status => !table.states.tc.includes(status))
    if (unknown.length > 0) problems.push(`${label}: tc_status_by_state.${state} names unregistered TC statuses ${list(unknown)}`)
  }
  const targets = table.restoreTargets
  if (targets.length !== RESTORE_TARGET_COUNT) {
    problems.push(`${label}: restore_targets must have exactly ${RESTORE_TARGET_COUNT} entries, found ${targets.length}`)
  }
  const repeatedVia = repeated(targets.map(target => target.via))
  if (repeatedVia.length > 0) problems.push(`${label}: restore targets repeat the transition ${list(repeatedVia)}; every entry must differ`)
  const repeatedState = repeated(targets.map(target => target.state))
  if (repeatedState.length > 0) problems.push(`${label}: restore targets repeat the restore state ${list(repeatedState)}; every entry must differ`)
  for (const target of targets) {
    const item = transitionById(table, target.via)
    if (item === undefined) {
      problems.push(`${label}: restore target ${target.via} names an unregistered transition`)
      continue
    }
    const state = slotName(item.to) ?? 'a structured slot'
    const owner = slotName(item.ownerAfter) ?? 'a structured slot'
    if (state !== target.state || owner !== target.owner) {
      problems.push(`${label}: restore target ${target.via} records (${target.state}, ${target.owner}), but transition ${target.via} hands over (${state}, ${owner})`)
    }
  }
  return problems
}

/**
 * Load a lifecycle table from its YAML text. A structural failure reports the
 * first root cause only; a well-formed table then reports every content
 * inconsistency, one per root cause.
 * @param text - the `lifecycle.yml` text.
 * @param label - file label prefixed to every problem.
 * @returns the table with no problems, or no table with the problems.
 */
export function loadLifecycleTable(text: string, label = 'lifecycle.yml'): LifecycleTableLoad {
  const read = readMapping(text, label)
  if (read.doc === undefined) return { table: undefined, problems: [read.problem] }
  const doc = read.doc
  const unknown = Object.keys(doc).filter(key => !TOP_LEVEL_KEYS.has(key))
  if (unknown.length > 0) return { table: undefined, problems: [`${label}: unknown top-level keys ${list(unknown)}`] }
  const version = doc.version
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.includes(version)) {
    const supported = list(SUPPORTED_VERSIONS.map(String))
    return { table: undefined, problems: [`${label}: version ${String(version)} is not supported; supported integer versions are ${supported}`] }
  }
  const missing = SECTIONS.filter(section => !(section in doc))
  if (missing.length > 0) return { table: undefined, problems: [`${label}: missing sections ${list(missing)}`] }

  const states = parseStates(label, doc.states)
  if (!states.ok) return { table: undefined, problems: [states.problem] }
  const roles = stringList(doc.roles)
  if (roles === undefined) return { table: undefined, problems: [`${label}: section roles must be a list of role names (got ${typeName(doc.roles)})`] }
  const sections = v1Sections(states.value, roles)
  for (const key of V1_KEYS) {
    const problem = v1EnumProblem(label, key, sections[key])
    if (problem !== undefined) return { table: undefined, problems: [problem] }
  }
  const gates = parseEntries(label, 'gates', doc.gates, entry => parseGate(label, entry))
  if (!gates.ok) return { table: undefined, problems: [gates.problem] }
  const exits = parseStringListMap(label, 'exits', doc.exits, 'transition ids')
  if (!exits.ok) return { table: undefined, problems: [exits.problem] }
  const passToEnter = parsePassToEnter(label, doc.pass_to_enter)
  if (!passToEnter.ok) return { table: undefined, problems: [passToEnter.problem] }
  const matrix = parseStringListMap(label, 'tc_status_by_state', doc.tc_status_by_state, 'TC statuses')
  if (!matrix.ok) return { table: undefined, problems: [matrix.problem] }
  const restoreTargets = parseEntries(label, 'restore_targets', doc.restore_targets, entry => parseRestoreTarget(label, entry))
  if (!restoreTargets.ok) return { table: undefined, problems: [restoreTargets.problem] }
  const transitions = parseEntries(label, 'transitions', doc.transitions, entry => parseTransition(label, entry))
  if (!transitions.ok) return { table: undefined, problems: [transitions.problem] }
  const events = parseEvents(label, doc.events)
  if (!events.ok) return { table: undefined, problems: [events.problem] }
  const predicates = parsePredicates(label, doc.predicates)
  if (!predicates.ok) return { table: undefined, problems: [predicates.problem] }

  const table: LifecycleTable = {
    version,
    states: states.value,
    roles,
    gates: gates.value,
    exits: Object.fromEntries(Object.entries(exits.value).map(([policy, ids]) => [policy, ids.map(id => brandString<TransitionId>(id))])),
    passToEnter: passToEnter.value,
    tcStatusByState: matrix.value,
    restoreTargets: restoreTargets.value,
    transitions: transitions.value,
    events: events.value,
    predicates: predicates.value,
  }
  const schema = registrationProblem(label, table)
  if (schema !== undefined) return { table: undefined, problems: [schema] }
  const problems = [
    ...transitionProblems(label, table),
    ...exitProblems(label, table),
    ...gateProblems(label, table),
    ...matrixAndRestoreProblems(label, table),
  ]
  return problems.length === 0 ? { table, problems: [] } : { table: undefined, problems }
}

/**
 * The main-chain position of a REQ status.
 * @param table - the loaded table.
 * @param status - a REQ status.
 * @returns the index on the main chain, or -1 off the chain (including `blocked`).
 */
export function statusIndex(table: LifecycleTable, status: string): number {
  return table.states.req.indexOf(status)
}

/**
 * Every REQ status a work item may carry.
 * @param table - the loaded table.
 * @returns the main chain followed by the off-chain states.
 */
export function legalReqStatuses(table: LifecycleTable): readonly string[] {
  return [...table.states.req, ...table.states.reqOffChain]
}

/**
 * Look up a transition.
 * @param table - the loaded table.
 * @param id - the transition id.
 * @returns the transition, or `undefined` when the table has none with that id.
 */
export function transitionById(table: LifecycleTable, id: string): Transition | undefined {
  return table.transitions.find(item => item.id === id)
}

/**
 * The role that signs a review section.
 * @param table - the loaded table.
 * @param section - a review-record section name.
 * @returns the signer role, or `undefined` for a section that is not a gate.
 */
export function signerOf(table: LifecycleTable, section: string): string | undefined {
  const gate = table.gates.find(entry => entry.section === section)
  return gate === undefined ? undefined : gate.signer
}

/**
 * The role that takes over at each T16 restore state.
 * @param table - the loaded table.
 * @returns restore state to owner role.
 */
export function restoreRoles(table: LifecycleTable): Readonly<Record<string, string>> {
  return Object.fromEntries(table.restoreTargets.map(target => [target.state, target.owner]))
}

/**
 * Each role's legal states: a named actor gains the named origin, a named
 * hand-over role gains the named target. Structured slot values attribute
 * nothing, so T15's current owner, T16's restore pair, and T19's multi-state
 * origin never widen a role. States are listed in main-chain order followed
 * by the off-chain states.
 * @param table - the loaded table.
 * @returns role to states, for every registered role.
 */
export function roleStates(table: LifecycleTable): Readonly<Record<string, readonly string[]>> {
  const derived = new Map<string, Set<string>>(table.roles.map(role => [role, new Set<string>()]))
  const add = (role: TransitionSlot, state: TransitionSlot): void => {
    if (role.kind !== 'name' || state.kind !== 'name') return
    const states = derived.get(role.name)
    if (states !== undefined) states.add(state.name)
  }
  for (const item of table.transitions) {
    add(item.actor, item.from)
    add(item.ownerAfter, item.to)
  }
  const order = legalReqStatuses(table)
  return Object.fromEntries([...derived].map(([role, states]) => [role, order.filter(state => states.has(state))]))
}

/**
 * The review sections a REQ must have PASSed to enter and stay in a state.
 * @param table - the loaded table.
 * @param column - the `pass_to_enter` column (`with_tc`, `optional_no_tc`, `exempt`).
 * @param status - the REQ status.
 * @returns the accumulated sections in main-chain order; empty off the main chain or for an unknown column.
 */
export function requiredGates(table: LifecycleTable, column: string, status: string): readonly string[] {
  const index = statusIndex(table, status)
  if (index < 0) return []
  const gates: string[] = []
  for (const [state, sections] of Object.entries(table.passToEnter[column] ?? {})) {
    if (statusIndex(table, state) > index) continue
    for (const section of sections) if (!gates.includes(section)) gates.push(section)
  }
  return gates
}

/**
 * The states reachable from the first main-chain state along forward
 * transitions, leaving `req_review` only through the policy's exits.
 * @param table - the loaded table.
 * @param policy - the `tc_policy` whose exits apply; an unknown policy has no exits.
 * @returns the reachable states in main-chain order.
 */
export function reachableStates(table: LifecycleTable, policy: string): readonly string[] {
  const exits = new Set<string>(table.exits[policy] ?? [])
  const seen = new Set(table.states.req.slice(0, 1))
  let frontier = new Set(seen)
  while (frontier.size > 0) {
    const next = new Set<string>()
    for (const state of frontier) {
      for (const item of table.transitions) {
        const target = slotName(item.to)
        if (slotName(item.from) !== state || target === undefined || seen.has(target) || !isForward(table, item)) continue
        if (state === REVIEW_STATE && !exits.has(item.id)) continue
        seen.add(target)
        next.add(target)
      }
    }
    frontier = next
  }
  return table.states.req.filter(state => seen.has(state))
}

/**
 * The closed set of lifecycle-sensitive kinds a `may_change` list may name:
 * the REQ fields, and the prefixed TC statuses, BUG statuses, and review sections.
 * @param table - the loaded table.
 * @returns every registered kind.
 */
export function sensitiveKinds(table: LifecycleTable): readonly string[] {
  const sections = [...table.gates.map(gate => gate.section), ...EXTRA_RV_SECTIONS]
  return [
    ...REQ_SENSITIVE_FIELDS.map(field => `req.${field}`),
    ...table.states.tc.map(state => `tc_status:${state}`),
    ...table.states.bug.map(state => `bug_status:${state}`),
    ...sections.map(section => `rv:${section}`),
  ]
}
