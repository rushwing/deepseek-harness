/**
 * Work-item identities: the five artifact kinds, their id shapes, the
 * canonical directories under the tasks root, and the ids derived from one
 * another (a TC's REQ, an RV's REQ, an acceptance criterion's parts).
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/ids
 */

/** The artifact kinds in registration order. */
export const ARTIFACT_KINDS = ['REQ', 'TC', 'BUG', 'RV', 'PL'] as const

/** One artifact kind. */
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

const ID_SHAPES: Readonly<Record<ArtifactKind, RegExp>> = {
  REQ: /^REQ-[A-Z]+-\d{3}$/,
  TC: /^TC-[A-Z]+-\d{3}-\d{2}$/,
  BUG: /^BUG-[A-Z]+-\d{3}$/,
  RV: /^RV-[A-Z]+-\d{3}$/,
  PL: /^PL-[A-Z]+-\d{3}$/,
}
const ID_PREFIX = /^[A-Z]+-([A-Z]+)-\d{3}/
const AC_ID = /^AC-([A-Z]+)-(\d{3})-(\d{2})$/
const LIVE_DIRS: Readonly<Record<ArtifactKind, string>> = {
  REQ: 'features',
  TC: 'test-cases',
  BUG: 'bugs',
  RV: 'reviews',
  PL: 'plans',
}
const ARCHIVE = 'archive'
const ARCHIVE_DIRS = ['done', 'superseded'] as const

/** The location of an artifact under the tasks root. */
export type ArtifactLocation = 'live' | `archive/${string}`

/** The parts of an acceptance-criterion id. */
export interface AcIdParts {
  readonly prefix: string
  readonly req: string
  readonly order: number
}

/**
 * The kind a file stem names by its prefix.
 * @param stem - the file name without extension.
 * @returns the kind, or `undefined` for a non-artifact file.
 */
export function kindOf(stem: string): ArtifactKind | undefined {
  return ARTIFACT_KINDS.find(kind => stem.startsWith(`${kind}-`))
}

/**
 * The id pattern of a kind.
 * @param kind - the artifact kind.
 * @returns the anchored pattern.
 */
export function idShapeOf(kind: ArtifactKind): RegExp {
  return ID_SHAPES[kind]
}

/**
 * The scope prefix of an id (`PLAT` in `TC-PLAT-009-01`).
 * @param id - an artifact id.
 * @returns the prefix, or an empty string when the id has none.
 */
export function idPrefixOf(id: string): string {
  const match = ID_PREFIX.exec(id)
  return match === null ? '' : String(match[1])
}

/**
 * The REQ a TC id belongs to by its number.
 * @param tcId - a TC id.
 * @returns `REQ-<PREFIX>-<NNN>`, or an empty string when the id is too short.
 */
export function derivedReqOf(tcId: string): string {
  const parts = tcId.split('-')
  return parts.length >= 3 ? ['REQ', ...parts.slice(1, 3)].join('-') : ''
}

/**
 * The REQ an RV or PL id shares its number with.
 * @param id - an RV or PL id.
 * @returns the REQ id.
 */
export function reqOfSameNumber(id: string): string {
  return `REQ-${id.slice(id.indexOf('-') + 1)}`
}

/**
 * Parse an acceptance-criterion id.
 * @param id - the candidate id.
 * @returns its parts, or `undefined` when the id does not match `AC-<PREFIX>-<NNN>-<SS>`.
 */
export function acIdParts(id: string): AcIdParts | undefined {
  const match = AC_ID.exec(id)
  return match === null ? undefined : { prefix: String(match[1]), req: String(match[2]), order: Number(match[3]) }
}

/**
 * Whether a file sits outside its kind's canonical directories.
 * @param segments - the directory names between the tasks root and the file.
 * @param kind - the artifact kind.
 * @returns an empty string when the placement is canonical, else the offending directory.
 */
export function misplaced(segments: readonly string[], kind: ArtifactKind): string {
  if (segments.length === 0) return '(not under the tasks directory)'
  const joined = segments.join('/')
  if (kind === 'REQ' && segments[0] === ARCHIVE) {
    return segments.length === 2 && (ARCHIVE_DIRS as readonly string[]).includes(String(segments[1])) ? '' : joined
  }
  return segments.length === 2 && segments[0] === LIVE_DIRS[kind] ? '' : joined
}

/**
 * Whether a file is live or archived.
 * @param segments - the directory names between the tasks root and the file.
 * @returns `live`, or `archive/<subdirectory>`.
 */
export function locationOf(segments: readonly string[]): ArtifactLocation {
  return segments[0] === ARCHIVE ? `archive/${segments.slice(1, 2).join('')}` : 'live'
}
