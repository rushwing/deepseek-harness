/**
 * Markdown text layer shared by every artifact reader: LF line splitting,
 * the visibility mask that blanks fenced code, indented code, and HTML
 * comments while keeping inline code spans, H2 section slicing, and the
 * code-point length every budget measures.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/text
 */

const FENCE_LINE = /^(`{3,}|~{3,})(.*)$/
const COMMENT_OPEN = '<!--'
const COMMENT_CLOSE = '-->'
const INDENTED_CODE = '    '
const H2 = '## '

interface FenceMarker {
  readonly marker: string
  readonly info: string
}

/**
 * Split text into lines on LF, dropping the empty piece a trailing newline
 * would leave (Python `splitlines` semantics).
 * @param text - the text.
 * @returns the lines.
 */
export function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Split text into lines that keep their trailing newline.
 * @param text - the text.
 * @returns the lines with line endings.
 */
function splitLinesKeepingEnds(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/)
}

/**
 * The number of Unicode code points in a string, which every artifact budget measures.
 * @param text - the text.
 * @returns the code-point count.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

function fenceAtLineStart(line: string): FenceMarker | undefined {
  const stripped = line.replace(/^ +/, '')
  if (line.length - stripped.length > 3) return undefined
  const match = FENCE_LINE.exec(stripped)
  return match === null ? undefined : { marker: String(match[1]), info: String(match[2]) }
}

function opensFence(fence: FenceMarker): boolean {
  return !(fence.marker.startsWith('`') && fence.info.includes('`'))
}

function closesFence(candidate: FenceMarker, open: string): boolean {
  return candidate.marker[0] === open[0] && candidate.marker.length >= open.length && candidate.info.trim() === ''
}

function paragraphRest(lines: readonly string[], index: number): string {
  const rest: string[] = []
  for (const line of lines.slice(index + 1)) {
    if (line.trim() === '') break
    rest.push(line)
  }
  return rest.join('\n')
}

/** The index just past a backtick run of exactly `run` characters at or after `start`, or -1. */
function matchingBacktickRun(line: string, start: number, run: number): number {
  let index = start
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1
      continue
    }
    let end = index
    while (line[end] === '`') end += 1
    if (end - index === run) return end
    index = end
  }
  return -1
}

interface VisibleScan {
  readonly shown: string
  readonly inComment: boolean
  readonly span: number
}

function visibleOutsideComments(line: string, startsInComment: boolean, openSpan: number, rest: string): VisibleScan {
  let shown = ''
  let index = 0
  let inComment = startsInComment
  if (openSpan > 0) {
    const closing = matchingBacktickRun(line, 0, openSpan)
    if (closing < 0) return { shown: line, inComment, span: openSpan }
    shown = line.slice(0, closing)
    index = closing
  }
  while (index < line.length) {
    if (inComment) {
      const close = line.indexOf(COMMENT_CLOSE, index)
      if (close < 0) return { shown, inComment: true, span: 0 }
      index = close + COMMENT_CLOSE.length
      inComment = false
      continue
    }
    if (line[index] === '`') {
      let end = index
      while (line[end] === '`') end += 1
      const run = end - index
      const closing = matchingBacktickRun(line, end, run)
      if (closing >= 0) {
        shown += line.slice(index, closing)
        index = closing
      } else if (matchingBacktickRun(rest, 0, run) < 0) {
        shown += line.slice(index, end)
        index = end
      } else {
        return { shown: shown + line.slice(index), inComment, span: run }
      }
      continue
    }
    if (line.startsWith(COMMENT_OPEN, index)) {
      index += COMMENT_OPEN.length
      inComment = true
      continue
    }
    shown += line.charAt(index)
    index += 1
  }
  return { shown, inComment, span: 0 }
}

function isIndentedCode(line: string): boolean {
  return line.startsWith(INDENTED_CODE) && line.trim() !== ''
}

/**
 * One visible string per input line: fenced code (both fence lines), indented
 * code, and HTML comment text become blank while inline code spans, which may
 * cross soft line breaks inside one paragraph, stay visible with their backticks.
 * @param text - the Markdown text.
 * @returns the visible lines, aligned with `splitLines(text)`.
 */
export function visibleLines(text: string): string[] {
  const lines = splitLines(text)
  const visible: string[] = []
  let fence = ''
  let inComment = false
  let span = 0
  for (const [index, line] of lines.entries()) {
    if (fence !== '') {
      const candidate = fenceAtLineStart(line)
      if (candidate !== undefined && closesFence(candidate, fence)) fence = ''
      visible.push('')
      continue
    }
    if (!inComment && span === 0 && isIndentedCode(line)) {
      visible.push('')
      continue
    }
    const opener = inComment ? undefined : fenceAtLineStart(line)
    if (opener !== undefined && opensFence(opener)) {
      fence = opener.marker
      span = 0
      visible.push('')
      continue
    }
    if (line.trim() === '') span = 0
    const scan = visibleOutsideComments(line, inComment, span, line.trim() === '' ? '' : paragraphRest(lines, index))
    inComment = scan.inComment
    span = scan.span
    visible.push(isIndentedCode(scan.shown) ? '' : scan.shown)
  }
  return visible
}

/**
 * The indices of non-blank lines the visibility mask blanks entirely.
 * @param text - the Markdown text.
 * @returns zero-based line indices.
 */
export function maskedLines(text: string): Set<number> {
  const masked = new Set<number>()
  const lines = splitLines(text)
  for (const [index, shown] of visibleLines(text).entries()) {
    if (String(lines[index]).trim() !== '' && shown.trim() === '') masked.add(index)
  }
  return masked
}

function headingLines(text: string): readonly (readonly [number, string])[] {
  const masked = maskedLines(text)
  return splitLines(text).flatMap((line, index) => (
    line.startsWith(H2) && !masked.has(index) ? [[index, line.slice(H2.length).trim()] as const] : []
  ))
}

/**
 * Every H2 heading name in order, duplicates included.
 * @param text - the Markdown body.
 * @returns the heading names.
 */
export function sectionHeadings(text: string): string[] {
  return headingLines(text).map(([, name]) => name)
}

/**
 * H2 sections as raw slices from the heading line to the line before the
 * next heading, line endings kept; the first of two equally named headings wins.
 * @param text - the Markdown body.
 * @returns heading name to raw slice.
 */
export function sectionSlices(text: string): Record<string, string> {
  const lines = splitLinesKeepingEnds(text)
  const headings = headingLines(text)
  const slices: Record<string, string> = {}
  for (const [position, [start, name]] of headings.entries()) {
    const end = headings[position + 1]?.[0] ?? lines.length
    if (!(name in slices)) slices[name] = lines.slice(start, end).join('')
  }
  return slices
}

/**
 * A section's content: its slice without the heading line, newline-trimmed.
 * @param text - the Markdown body.
 * @param name - the H2 heading name.
 * @returns the content, empty when the section is absent.
 */
export function sectionContent(text: string, name: string): string {
  const slice = sectionSlices(text)[name]
  if (slice === undefined) return ''
  return splitLinesKeepingEnds(slice).slice(1).join('').replace(/^\n+|\n+$/g, '')
}

/**
 * A section's visible content, the test for "this section says something".
 * @param text - the Markdown body.
 * @param name - the H2 heading name.
 * @returns the visible lines joined and trimmed.
 */
export function visibleSectionContent(text: string, name: string): string {
  return visibleLines(sectionContent(text, name)).join('\n').trim()
}

/**
 * H2 heading names that appear more than once.
 * @param text - the Markdown body.
 * @returns the duplicated names, sorted.
 */
export function duplicateHeadings(text: string): string[] {
  const names = sectionHeadings(text)
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort()
}
