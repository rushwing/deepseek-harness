/**
 * What every lint rule reads: the graph, the tables, the contract, and the
 * workspace probe, plus the small helpers the rule groups share.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/context
 */

import {
  legalReqStatuses,
  requiredGates,
  statusIndex,
  type AgentRegistry,
  type IdScheme,
  type LifecycleTable,
  type RegisteredAgent,
} from '@deepseek-ai/dsh-experimental-lifecycle-table'
import type { Req, Rv, Tc } from '../artifacts.ts'
import type { ArtifactContract } from '../contract.ts'
import { asList } from '../frontmatter.ts'
import type { ArtifactGraph } from '../graph.ts'
import { sectionContent, visibleLines } from '../text.ts'

/** One lint finding. */
export interface Violation {
  /** The workspace-relative path of the file the finding is about. */
  readonly file: string
  /** The rule identifier. */
  readonly rule: string
  readonly message: string
}

/** Whether a workspace path is a file, a directory, or absent. */
export type PathKind = 'file' | 'directory' | 'missing'

/** Existence probe over the workspace, for link targets. */
export interface FileProbe {
  /** The kind of a workspace-relative POSIX path. */
  kind(path: string): PathKind
}

/** Everything the rules read. */
export interface LintInputs {
  readonly graph: ArtifactGraph
  readonly contract: ArtifactContract
  readonly table: LifecycleTable
  /** The agent registry; when absent, registration checks are skipped. */
  readonly registry: AgentRegistry | undefined
  /** The id scheme; when absent, scope placement checks are skipped. */
  readonly idScheme: IdScheme | undefined
  readonly workspace: FileProbe
}

/** The inputs with the derived lookups rules share. */
export interface LintContext extends LintInputs {
  readonly agents: ReadonlyMap<string, RegisteredAgent>
  /** Every REQ status the table registers. */
  readonly reqStatuses: ReadonlySet<string>
  /** The REQ's same-numbered review record, when present. */
  rvOf(req: Req): Rv | undefined
  /** The label a missing RV would carry. */
  rvLabel(req: Req): string
  /** Whether the REQ's effective status is strictly after a state on the main chain. */
  hasLeft(req: Req, state: string): boolean
  /** Whether the REQ's effective status is at or after a state on the main chain. */
  atOrAfter(req: Req, state: string): boolean
  /** The review sections the REQ must have PASSed for its effective status. */
  requiredGatesOf(req: Req): readonly string[]
  /** Whether acceptance coverage rules apply to the REQ. */
  coverageApplies(req: Req): boolean
  /** The TC ids a carried BUG lists for the REQ. */
  carriedTcs(req: Req): ReadonlySet<string>
  /** The expected-result entry ids of a TC body. */
  expectationHeads(tc: Tc): ReadonlySet<string>
  /** Whether body rules apply: a live REQ on the current schema. */
  bodyRulesApply(req: Req): boolean
}

const EXPECTATION_SEPARATOR = ':'

export { list, quote, textOf } from '../format.ts'

/**
 * Whether two lists hold the same items in the same order.
 * @param left - one list.
 * @param right - the other.
 * @returns `true` when they are equal item by item.
 */
export function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/**
 * Build the shared context of one lint run.
 * @param inputs - the inputs.
 * @returns the context.
 */
export function lintContext(inputs: LintInputs): LintContext {
  const { graph, table, contract } = inputs
  const agents = new Map((inputs.registry?.agents ?? []).map(agent => [String(agent.uid), agent]))
  const index = (status: string): number => statusIndex(table, status)
  const hasLeft = (req: Req, state: string): boolean => index(req.effectiveStatus) > index(state) && index(state) >= 0
  const atOrAfter = (req: Req, state: string): boolean => index(state) >= 0 && index(req.effectiveStatus) >= index(state)
  const rvOf = (req: Req): Rv | undefined => graph.rvOf.get(req.id)
  const coverageApplies = (req: Req): boolean => {
    if (req.tcPolicy === 'exempt') return false
    const rv = rvOf(req)
    return !(req.tcPolicy === 'optional' && rv !== undefined && rv.exemptionReason !== '')
  }
  return {
    ...inputs,
    agents,
    reqStatuses: new Set(legalReqStatuses(table)),
    rvOf,
    rvLabel: req => `${graph.tasksDir}/reviews/${req.tool}/RV-${req.id.slice('REQ-'.length)}.md`,
    hasLeft,
    atOrAfter,
    requiredGatesOf: (req) => {
      const rv = rvOf(req)
      const column = req.tcPolicy === 'exempt'
        ? 'exempt'
        : req.tcPolicy === 'optional' && rv !== undefined && rv.exemptionReason !== '' ? 'optional_no_tc' : 'with_tc'
      return requiredGates(table, column, req.effectiveStatus)
    },
    coverageApplies,
    carriedTcs: (req) => {
      const listed = new Set<string>()
      for (const bug of graph.bugs.values()) {
        if (graph.resolveReq(bug.fm.linked_req) !== req) continue
        for (const tc of asList(bug.fm.test_case_ref)) listed.add(tc)
      }
      return listed
    },
    expectationHeads: (tc) => {
      const heads = new Set<string>()
      for (const line of visibleLines(sectionContent(tc.body, contract.tc.headings.expectedResults))) {
        if (!line.startsWith('- ')) continue
        const separator = line.indexOf(EXPECTATION_SEPARATOR)
        heads.add((separator < 0 ? line.slice(2) : line.slice(2, separator)).trim())
      }
      return heads
    },
    bodyRulesApply: req => req.v2 && req.live,
  }
}
