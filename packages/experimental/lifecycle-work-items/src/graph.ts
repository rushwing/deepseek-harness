/**
 * The artifact graph: every parsed node of a tasks tree with the relations
 * the rules and predicates read (own TCs, carried and blocking BUGs, the RV
 * and PL of a REQ, acceptance-criterion owners) and the problems of the
 * files that could not become nodes.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/graph
 */

import { parseArtifact, stemOf, type Artifact, type Bug, type ParseOptions, type Pl, type Req, type Rv, type Tc } from './artifacts.ts'
import { asList } from './frontmatter.ts'
import { idShapeOf, kindOf, reqOfSameNumber, type ArtifactKind } from './ids.ts'
import type { WorkItemSource } from './source.ts'

/** A frontmatter reference resolved against the graph. */
export interface Ref {
  readonly raw: unknown
  readonly kind: ArtifactKind
  /** The referenced id when it resolves. */
  readonly resolved: string | undefined
  /** Why it does not resolve, phrased to follow `is`; empty when it does. */
  readonly reason: string
  /** Whether the reference is legitimately absent. */
  readonly empty: boolean
}

/** The loaded tasks tree. */
export interface ArtifactGraph {
  /** The tasks root relative to the workspace, the prefix of every label. */
  readonly tasksDir: string
  readonly reqs: ReadonlyMap<string, Req>
  readonly tcs: ReadonlyMap<string, Tc>
  readonly bugs: ReadonlyMap<string, Bug>
  readonly rvs: ReadonlyMap<string, Rv>
  readonly pls: ReadonlyMap<string, Pl>
  /** Every node in path order. */
  readonly artifacts: readonly Artifact[]
  /** One problem per file that could not become a node. */
  readonly problems: readonly string[]
  /** Label to the problem, or `unreadable`, for every broken file. */
  readonly broken: ReadonlyMap<string, string>
  /** Id to the labels of every file claiming it, for ids seen more than once. */
  readonly duplicates: ReadonlyMap<string, readonly string[]>
  /** Well-formed acceptance-criterion id to the REQ that owns it. */
  readonly acs: ReadonlyMap<string, string>
  /** REQ id to the TCs whose `linked_req` names it. */
  readonly ownTcs: ReadonlyMap<string, readonly string[]>
  /** REQ id to the BUGs whose `linked_req` names it. */
  readonly carriedBugs: ReadonlyMap<string, readonly string[]>
  /** REQ id to the BUGs whose `blocks_req` names it. */
  readonly blockingBugs: ReadonlyMap<string, readonly string[]>
  /** REQ id to its same-numbered RV. */
  readonly rvOf: ReadonlyMap<string, Rv>
  /** REQ id to its same-numbered PL. */
  readonly plOf: ReadonlyMap<string, Pl>
  /** Resolve a frontmatter reference to an existing artifact of a kind. */
  resolve(raw: unknown, kind: ArtifactKind): Ref
  /** The REQ a frontmatter reference names, or `undefined` when it does not resolve. */
  resolveReq(raw: unknown): Req | undefined
  /** The node loaded from a label, or `undefined` for shadowed and unknown files. */
  nodeFor(label: string): Artifact | undefined
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

function sortedMap(map: Map<string, string[]>): Map<string, readonly string[]> {
  return new Map([...map].map(([key, values]) => [key, [...values].sort()]))
}

function resolveIn(tables: Readonly<Record<ArtifactKind, ReadonlyMap<string, Artifact>>>, raw: unknown, kind: ArtifactKind): Ref {
  const base = { raw, kind, resolved: undefined, empty: false }
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { ...base, reason: 'empty', empty: true }
  if (typeof raw !== 'string') return { ...base, reason: `not a scalar ${kind} id` }
  const id = raw.trim()
  if (!idShapeOf(kind).test(id)) return { ...base, reason: `not in the ${kind} id format` }
  if (!tables[kind].has(id)) return { ...base, reason: `not an existing ${kind}` }
  return { ...base, resolved: id, reason: '' }
}

/**
 * Load every artifact of a tasks tree. Loading never throws: unreadable and
 * malformed files become problems, and the first file in path order wins an
 * id that several files claim.
 * @param source - the files.
 * @param options - the contract facts the parser reads.
 * @returns the graph.
 */
export function loadGraph(source: WorkItemSource, options: ParseOptions): ArtifactGraph {
  const reqs = new Map<string, Req>()
  const tcs = new Map<string, Tc>()
  const bugs = new Map<string, Bug>()
  const rvs = new Map<string, Rv>()
  const pls = new Map<string, Pl>()
  const tables: Readonly<Record<ArtifactKind, Map<string, Artifact>>> = { REQ: reqs, TC: tcs, BUG: bugs, RV: rvs, PL: pls }
  const artifacts: Artifact[] = []
  const problems: string[] = []
  const broken = new Map<string, string>()
  const seen = new Map<string, string[]>()
  for (const relative of source.files()) {
    if (kindOf(stemOf(relative)) === undefined) continue
    const label = `${source.tasksDir}/${relative}`
    let content: string
    try {
      content = source.read(relative)
    } catch (error: unknown) {
      problems.push(`${label}: cannot read content (${error instanceof Error ? error.message : String(error)})`)
      broken.set(label, 'unreadable')
      continue
    }
    const parsed = parseArtifact(relative, content, source.tasksDir, options)
    if (typeof parsed === 'string') {
      problems.push(parsed)
      broken.set(label, parsed)
      continue
    }
    pushTo(seen, parsed.id, label)
    const table = tables[parsed.kind]
    if (table.has(parsed.id)) continue
    table.set(parsed.id, parsed)
    artifacts.push(parsed)
  }
  const duplicates = new Map([...seen].filter(([, labels]) => labels.length > 1))
  const resolve = (raw: unknown, kind: ArtifactKind): Ref => resolveIn(tables, raw, kind)
  const resolveReq = (raw: unknown): Req | undefined => {
    const id = resolve(raw, 'REQ').resolved
    return id === undefined ? undefined : reqs.get(id)
  }
  const acs = new Map<string, string>()
  for (const req of reqs.values()) {
    for (const id of req.acIds) if (!acs.has(id)) acs.set(id, req.id)
  }
  const ownTcs = new Map<string, string[]>()
  for (const tc of tcs.values()) {
    const owner = resolve(tc.fm.linked_req, 'REQ').resolved
    if (owner !== undefined) pushTo(ownTcs, owner, tc.id)
  }
  const carriedBugs = new Map<string, string[]>()
  const blockingBugs = new Map<string, string[]>()
  for (const bug of bugs.values()) {
    const carrier = resolve(bug.fm.linked_req, 'REQ').resolved
    if (carrier !== undefined) pushTo(carriedBugs, carrier, bug.id)
    for (const blocked of asList(bug.fm.blocks_req)) {
      const target = resolve(blocked, 'REQ').resolved
      if (target !== undefined) pushTo(blockingBugs, target, bug.id)
    }
  }
  const rvOf = new Map([...rvs.values()].map(rv => [reqOfSameNumber(rv.id), rv]))
  const plOf = new Map([...pls.values()].map(pl => [reqOfSameNumber(pl.id), pl]))
  const byLabel = new Map(artifacts.map(node => [node.label, node]))
  return {
    tasksDir: source.tasksDir,
    reqs,
    tcs,
    bugs,
    rvs,
    pls,
    artifacts,
    problems,
    broken,
    duplicates,
    acs,
    ownTcs: sortedMap(ownTcs),
    carriedBugs: sortedMap(carriedBugs),
    blockingBugs: sortedMap(blockingBugs),
    rvOf,
    plOf,
    resolve,
    resolveReq,
    nodeFor: label => byLabel.get(label),
  }
}
