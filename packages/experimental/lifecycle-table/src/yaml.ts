/**
 * YAML reading shared by the three loaders: one parse with unique keys, and
 * the small value guards every section parser repeats.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-table/yaml
 */

import { parseDocument } from 'yaml'

/** A parsed YAML mapping. */
export type YamlMapping = Record<string, unknown>

/** A section parser's result: the value, or the single problem that stopped parsing. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string }

/**
 * A successful parse.
 * @param value - the parsed value.
 * @returns the `ok` result.
 */
export function ok<T>(value: T): Parsed<T> {
  return { ok: true, value }
}

/**
 * A failed parse.
 * @param problem - the complete problem text.
 * @returns the failed result.
 */
export function fail<T>(problem: string): Parsed<T> {
  return { ok: false, problem }
}

/**
 * Parse one YAML document into a mapping.
 * @param text - the document text.
 * @param label - file label prefixed to problems.
 * @returns the mapping, or the single problem that prevents reading it.
 */
export function readMapping(
  text: string,
  label: string,
): { readonly doc: YamlMapping; readonly problem?: undefined } | { readonly doc?: undefined; readonly problem: string } {
  const document = parseDocument(text, { uniqueKeys: true })
  const [error] = document.errors
  if (error !== undefined) return { problem: `${label}: not valid YAML (${error.message.replace(/\n[\s\S]*$/, '')})` }
  const value: unknown = document.toJS()
  if (!isMapping(value)) return { problem: `${label}: top level is not a mapping` }
  return { doc: value }
}

/**
 * Whether a value is a plain YAML mapping.
 * @param value - any parsed value.
 * @returns `true` for a non-null, non-array object.
 */
export function isMapping(value: unknown): value is YamlMapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The parsed value's type name for problem messages.
 * @param value - any parsed value.
 * @returns `array`, `null`, or the `typeof` name.
 */
export function typeName(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

/**
 * A list of strings, or `undefined` when the value is anything else.
 * @param value - any parsed value.
 * @returns the strings.
 */
export function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : undefined
}

/**
 * Render names for a problem message.
 * @param names - the names.
 * @returns `[a, b]`.
 */
export function list(names: readonly string[]): string {
  return `[${names.join(', ')}]`
}

/**
 * Render quoted shapes for a problem message.
 * @param shapes - the shapes.
 * @returns `['a', 'b']`.
 */
export function quotedList(shapes: readonly string[]): string {
  return `[${shapes.map(shape => `'${shape}'`).join(', ')}]`
}
