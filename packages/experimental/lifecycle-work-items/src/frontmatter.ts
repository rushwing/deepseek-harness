/**
 * YAML frontmatter splitting and the value coercions the artifact rules
 * share. YAML is read with the 1.2 core schema: `yes` stays a string, dates
 * stay strings, and duplicate keys are a problem.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/frontmatter
 */

import { parseDocument } from 'yaml'

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A parsed frontmatter mapping. */
export type Frontmatter = Readonly<Record<string, unknown>>

/** The split artifact text, or the single problem that prevents reading it. */
export type FrontmatterSplit =
  | { readonly data: Frontmatter; readonly body: string; readonly problem?: undefined }
  | { readonly data?: undefined; readonly body?: undefined; readonly problem: string }

/**
 * Split an artifact into its frontmatter mapping and body. The document must
 * start with `---`, use LF line endings, and close with a `---` line.
 * @param text - the complete file text.
 * @returns the mapping and the body with leading newlines removed, or the problem.
 */
export function splitFrontmatter(text: string): FrontmatterSplit {
  const match = FRONTMATTER.exec(text)
  if (match === null) return { problem: 'missing YAML frontmatter' }
  const document = parseDocument(String(match[1]), { uniqueKeys: true })
  const [error] = document.errors
  if (error !== undefined) return { problem: `frontmatter is not valid YAML (${error.message.replace(/\n[\s\S]*$/, '')})` }
  const data: unknown = document.toJS()
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { problem: 'frontmatter is not a mapping' }
  return { data: data as Frontmatter, body: text.slice(match[0].length).replace(/^\n+/, '') }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * A frontmatter value as a list of non-blank strings: absent or empty values
 * give nothing, a list keeps its non-blank items stringified, any other
 * scalar becomes a one-item list.
 * @param value - the frontmatter value.
 * @returns the items.
 */
export function asList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value.filter(item => item !== null && textOf(item).trim() !== '').map(textOf)
  return [textOf(value)]
}

/**
 * A non-blank string frontmatter value.
 * @param value - the frontmatter value.
 * @returns the string, or `undefined` for blanks, lists, and other scalars.
 */
export function scalar(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Whether text is a `YYYY-MM-DD` calendar date that exists.
 * @param text - the candidate.
 * @returns `true` for a real date in that form.
 */
export function isIsoDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

/**
 * Whether a frontmatter value is a positive integer.
 * @param value - the frontmatter value.
 * @returns `true` for integers above zero.
 */
export function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
