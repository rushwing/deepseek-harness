/**
 * Acceptance-criterion items of a REQ: top-level bullets of the acceptance
 * section with their continuation lines, read from the visible text so
 * examples inside code blocks never become criteria.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/acceptance
 */

import { acIdParts } from './ids.ts'
import { sectionContent, visibleLines } from './text.ts'

const AC_ITEM = /^- \*\*(AC[^*\s]*)\*\* /
const AC_BOLD_ANY = /^[-*+] \*\*([^*]+)\*\*/
const AC_LOOSE = /^[-*+] (AC[^\s*]*)/
const TOP_BULLET = /^[-*+](?: |$)/
const BULLET_MARKER = /^[-*+]\s*/
const HEAD_WIDTH = 32
const EMPTY_BULLET = '(empty bullet)'

/** One acceptance-criterion bullet. */
export interface AcceptanceItem {
  /** The id between the bold markers, or the malformed head text, or empty. */
  readonly number: string
  /** The visible item text, bullet line plus continuation lines, trailing newlines removed. */
  readonly text: string
  /** The scope prefix of a well-formed id, else empty. */
  readonly prefix: string
  /** The sequence number of a well-formed id, else 0. */
  readonly order: number
  /** Whether the bullet uses the `- **AC…** ` form. */
  readonly bold: boolean
  /** The first characters after the bullet marker, for naming malformed items. */
  readonly head: string
  /** Whether the item is bold and its id has the `AC-<PREFIX>-<NNN>-<SS>` form. */
  readonly wellFormed: boolean
  /** The number when present, else the head. */
  readonly label: string
}

function itemOf(buffer: readonly string[], number: string, bold: boolean, head: string): AcceptanceItem {
  const parts = acIdParts(number)
  const prefix = parts?.prefix ?? ''
  return {
    number,
    text: buffer.join('\n').replace(/\n+$/, ''),
    prefix,
    order: parts?.order ?? 0,
    bold,
    head,
    wellFormed: prefix !== '' && bold,
    label: number === '' ? head : number,
  }
}

/**
 * Parse the acceptance criteria of a REQ body.
 * @param body - the Markdown body.
 * @param heading - the acceptance section's H2 heading.
 * @returns the items in order; empty without the section.
 */
export function parseAcceptance(body: string, heading: string): AcceptanceItem[] {
  const content = sectionContent(body, heading)
  if (content === '') return []
  const items: AcceptanceItem[] = []
  let open: { readonly number: string; readonly bold: boolean; readonly head: string; readonly buffer: string[] } | undefined
  const flush = (): void => {
    if (open !== undefined) items.push(itemOf(open.buffer, open.number, open.bold, open.head))
    open = undefined
  }
  for (const line of visibleLines(content)) {
    if (TOP_BULLET.test(line)) {
      flush()
      const well = AC_ITEM.exec(line)
      const loose = well ?? AC_BOLD_ANY.exec(line) ?? AC_LOOSE.exec(line)
      const head = line.trim().replace(BULLET_MARKER, '').slice(0, HEAD_WIDTH)
      open = { number: (loose?.[1] ?? '').trim(), bold: well !== null, head: head === '' ? EMPTY_BULLET : head, buffer: [line] }
      continue
    }
    if (open !== undefined && (line.trim() === '' || line.startsWith(' ') || line.startsWith('\t'))) {
      open.buffer.push(line)
      continue
    }
    flush()
  }
  flush()
  return items
}
