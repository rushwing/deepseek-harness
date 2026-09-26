/**
 * Markdown link syntax the lexicon and link rules share: inline links whose
 * destination may hold balanced parentheses or sit in angle brackets,
 * reference-style definitions and uses, and the literal path a destination
 * names once its wrapper and escapes are removed.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/markdown-links
 */

const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`
const BALANCED_3 = String.raw`\((?:[^()\\]|\\.)*\)`
const BALANCED_2 = String.raw`\((?:[^()\\]|\\.|${BALANCED_3})*\)`
const BALANCED_1 = String.raw`\((?:[^()\\]|\\.|${BALANCED_2})*\)`
const DESTINATION = String.raw`(?:<[^>\n]*>|(?:[^()\s\\]|\\.|${BALANCED_1})+)`
const INLINE_LINK = new RegExp(String.raw`\[[^\]]*\]\(\s*(${DESTINATION})${TITLE}\s*\)`, 'g')
const REFERENCE_DEFINITION = new RegExp(String.raw`^ {0,3}\[([^\]]+)\]:\s+<?([^>\s]+)>?${TITLE}\s*$`, 'gm')
const REFERENCE_USE = /\[([^\]\n]+)\]\[([^\]\n]*)\]/g
const ESCAPE = /\\(.)/g
/** CommonMark's ASCII punctuation: only a backslash before one of these is an escape. */
const ASCII_PUNCTUATION: ReadonlySet<string> = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')

/** Inline code spans, one line at most. */
export const INLINE_CODE = /`([^`\n]+)`/g

/** One `[text](destination "title")` link. */
export interface InlineLink {
  /** The destination as written, wrapper and escapes included. */
  readonly destination: string
  /** The destination's start offset in the text. */
  readonly start: number
  /** The offset just past the destination. */
  readonly end: number
}

/** One `[label]: destination` definition line. */
export interface ReferenceDefinition {
  /** The label, trimmed and lower-cased. */
  readonly label: string
  readonly destination: string
}

/** One `[text][label]` or `[text][]` use. */
export interface ReferenceUse {
  /** The use as written. */
  readonly whole: string
  /** The label it needs a definition for: the bracketed label, or the text when the label is empty. */
  readonly label: string
}

/**
 * Every inline link of a text.
 * @param text - the Markdown text.
 * @returns the links in order.
 */
export function inlineLinks(text: string): InlineLink[] {
  const links: InlineLink[] = []
  for (const match of text.matchAll(INLINE_LINK)) {
    const destination = String(match[1])
    const afterBracket = match[0].indexOf('](') + ']('.length
    const start = match.index + afterBracket + (match[0].length - afterBracket - match[0].slice(afterBracket).trimStart().length)
    links.push({ destination, start, end: start + destination.length })
  }
  return links
}

/**
 * Every reference-style definition line of a text.
 * @param text - the Markdown text.
 * @returns the definitions in order.
 */
export function referenceDefinitions(text: string): ReferenceDefinition[] {
  return [...text.matchAll(REFERENCE_DEFINITION)].map(match => ({
    label: String(match[1]).trim().toLowerCase(),
    destination: String(match[2]),
  }))
}

/**
 * Every reference-style use of a text.
 * @param text - the Markdown text.
 * @returns the uses in order.
 */
export function referenceUses(text: string): ReferenceUse[] {
  return [...text.matchAll(REFERENCE_USE)].map(match => ({
    whole: match[0],
    label: (match[2] === '' ? String(match[1]) : String(match[2])).trim().toLowerCase(),
  }))
}

/**
 * The text with every inline link's destination removed, so a destination's
 * path never counts as prose.
 * @param text - the Markdown text.
 * @returns the text without destinations.
 */
export function blankLinkTargets(text: string): string {
  let kept = ''
  let last = 0
  for (const link of inlineLinks(text)) {
    kept += text.slice(last, link.start)
    last = link.end
  }
  return kept + text.slice(last)
}

/**
 * The literal path a destination names: the angle-bracket wrapper removed and
 * backslash escapes before ASCII punctuation resolved.
 * @param destination - the destination as written.
 * @returns the path.
 */
export function linkTarget(destination: string): string {
  const inner = destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination
  return inner.replace(ESCAPE, (whole, escaped: string) => (ASCII_PUNCTUATION.has(escaped) ? escaped : whole))
}
