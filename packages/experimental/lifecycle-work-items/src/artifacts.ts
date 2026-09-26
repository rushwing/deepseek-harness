/**
 * Artifact nodes: one parsed REQ, TC, BUG, RV, or PL file with its placement
 * facts, frontmatter, body, and kind-specific readings.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/artifacts
 */

import { parseAcceptance, type AcceptanceItem } from './acceptance.ts'
import { asList, scalar, splitFrontmatter, type Frontmatter } from './frontmatter.ts'
import {
  derivedReqOf,
  idPrefixOf,
  idShapeOf,
  kindOf,
  locationOf,
  misplaced,
  type ArtifactKind,
  type ArtifactLocation,
} from './ids.ts'
import { parseReview, type RegressionLine, type ReviewSection, type ReviewVocabulary } from './review.ts'

/** Frontmatter and heading facts the parser reads from the artifact contract. */
export interface ParseOptions {
  /** The REQ acceptance-criteria H2 heading. */
  readonly acceptanceHeading: string
  /** The review-record labels. */
  readonly review: ReviewVocabulary
  /** The frontmatter key that marks a REQ as following the current body contract. */
  readonly schemaKey: string
  /** The value of that key for the current contract. */
  readonly schemaVersion: number
}

const TC_LEVELS: ReadonlySet<string> = new Set(['unit', 'integration', 'e2e'])
const BLOCKED = 'blocked'
const CANONICAL_DIRS: Readonly<Record<ArtifactKind, string>> = {
  REQ: 'features/<scope>, archive/done, archive/superseded',
  TC: 'test-cases/<scope>',
  BUG: 'bugs/<scope>',
  RV: 'reviews/<scope>',
  PL: 'plans/<scope>',
}

/** Facts every artifact node carries. */
export interface ArtifactBase {
  readonly id: string
  /** The path relative to the workspace, the prefix of every problem about the file. */
  readonly label: string
  /** The path relative to the tasks root. */
  readonly relative: string
  /** The directory name the file sits in. */
  readonly scopeDir: string
  /** The scope prefix of the id, else empty. */
  readonly prefix: string
  readonly location: ArtifactLocation
  readonly live: boolean
  readonly archived: boolean
  readonly fm: Frontmatter
  readonly body: string
  /** The frontmatter status as text, empty when absent. */
  readonly status: string
  /** The frontmatter tool, falling back to the directory name. */
  readonly tool: string
}

/** A requirement. */
export interface Req extends ArtifactBase {
  readonly kind: 'REQ'
  readonly acceptance: readonly AcceptanceItem[]
  /** Whether the frontmatter declares the current schema version. */
  readonly v2: boolean
  /** The status a blocked REQ is judged by: its restore state. */
  readonly effectiveStatus: string
  readonly tcPolicy: string
  /** The ids of the well-formed acceptance items. */
  readonly acIds: readonly string[]
}

/** A test case. */
export interface Tc extends ArtifactBase {
  readonly kind: 'TC'
  readonly verifies: readonly string[]
  readonly automatedOk: boolean
  readonly levelOk: boolean
  /** The REQ the TC number belongs to. */
  readonly derivedReq: string
  /** Whether `linked_req` is a scalar REQ id equal to the derived REQ. */
  readonly numberMatches: boolean
  /** Whether the TC enters coverage and status-path rules. */
  readonly wellFormed: boolean
}

/** A bug. */
export interface Bug extends ArtifactBase {
  readonly kind: 'BUG'
}

/** A design plan. */
export interface Pl extends ArtifactBase {
  readonly kind: 'PL'
}

/** A review record. */
export interface Rv extends ArtifactBase {
  readonly kind: 'RV'
  readonly sections: Readonly<Record<string, ReviewSection>>
  readonly regression: readonly RegressionLine[]
  readonly exemptionReason: string
  readonly exemptionDeclared: boolean
}

/** Any artifact node. */
export type Artifact = Req | Tc | Bug | Rv | Pl

/**
 * The directory names between the tasks root and a file.
 * @param relative - the path relative to the tasks root.
 * @returns the directory segments.
 */
export function segmentsOf(relative: string): string[] {
  return relative.split('/').slice(0, -1)
}

/**
 * The file stem of a relative path.
 * @param relative - the path relative to the tasks root.
 * @returns the file name without its `.md` extension.
 */
export function stemOf(relative: string): string {
  return String(relative.split('/').at(-1)).replace(/\.md$/, '')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Parse one artifact file into its node, or the single problem that keeps it
 * out of the graph.
 * @param relative - the path relative to the tasks root.
 * @param content - the complete file text.
 * @param tasksDir - the tasks root relative to the workspace, the label prefix.
 * @param options - the contract facts the parser reads.
 * @returns the node, or the problem text.
 */
export function parseArtifact(relative: string, content: string, tasksDir: string, options: ParseOptions): Artifact | string {
  const label = `${tasksDir}/${relative}`
  const stem = stemOf(relative)
  const kind = kindOf(stem)
  if (kind === undefined) return `${label}: file name is not any of the artifact kinds REQ / TC / BUG / RV / PL`
  if (!idShapeOf(kind).test(stem)) return `${label}: file name '${stem}' does not match the ${kind} id shape`
  const segments = segmentsOf(relative)
  const wrong = misplaced(segments, kind)
  if (wrong !== '') {
    return `${label}: ${kind} is in the wrong directory '${wrong}', allowed only in [${CANONICAL_DIRS[kind]}]; a misplaced file is not an artifact node`
  }
  const split = splitFrontmatter(content)
  if (split.data === undefined) return `${label}: ${split.problem}`
  const { data: fm, body } = split
  const location = locationOf(segments)
  const scopeDir = segments.slice(-1).join('')
  const base: ArtifactBase = {
    id: stem,
    label,
    relative,
    scopeDir,
    prefix: idPrefixOf(stem),
    location,
    live: location === 'live',
    archived: location !== 'live',
    fm,
    body,
    status: text(fm.status),
    tool: scalar(fm.tool) ?? scopeDir,
  }
  switch (kind) {
    case 'REQ': {
      const acceptance = parseAcceptance(body, options.acceptanceHeading)
      const status = base.status
      return {
        ...base,
        kind,
        acceptance,
        v2: fm[options.schemaKey] === options.schemaVersion,
        effectiveStatus: status === BLOCKED ? text(fm.blocked_from_status) : status,
        tcPolicy: text(fm.tc_policy),
        acIds: acceptance.filter(item => item.wellFormed).map(item => item.number),
      }
    }
    case 'TC': {
      const derivedReq = derivedReqOf(stem)
      const linked = scalar(fm.linked_req)
      const numberMatches = linked !== undefined && idShapeOf('REQ').test(linked) && linked === derivedReq
      const automatedOk = typeof fm.automated === 'boolean'
      const levelOk = typeof fm.level === 'string' && TC_LEVELS.has(fm.level)
      return {
        ...base,
        kind,
        verifies: asList(fm.verifies),
        automatedOk,
        levelOk,
        derivedReq,
        numberMatches,
        wellFormed: automatedOk && levelOk && numberMatches,
      }
    }
    case 'RV': {
      const review = parseReview(body, options.review)
      return {
        ...base,
        kind,
        sections: review.sections,
        regression: review.regression,
        exemptionReason: review.exemptionReason,
        exemptionDeclared: review.exemptionDeclared,
      }
    }
    case 'BUG':
    case 'PL':
      return { ...base, kind }
  }
}
