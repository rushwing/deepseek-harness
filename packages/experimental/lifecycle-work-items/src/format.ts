/**
 * Rendering helpers every violation and predicate message shares.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/format
 */

/**
 * Render a value for a message: strings quoted with single quotes, everything else as JSON.
 * @param value - the value.
 * @returns the rendering.
 */
export function quote(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Render names for a message.
 * @param names - the names.
 * @returns `[a, b]`.
 */
export function list(names: readonly string[]): string {
  return `[${names.join(', ')}]`
}

/**
 * The frontmatter value as text, empty when absent.
 * @param value - the frontmatter value.
 * @returns the text.
 */
export function textOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}
