/**
 * The work-item id scheme: which scope directory owns which id prefix.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-table/id-scheme
 */

import type { IdSchemeLoad } from './types.ts'
import { isMapping, readMapping } from './yaml.ts'

const PREFIX = /^[A-Z]{1,6}$/

/**
 * Load an id scheme from its YAML text.
 * @param text - the `id-scheme.yml` text.
 * @param label - file label prefixed to every problem.
 * @returns the scheme with no problems, or no scheme with the problems.
 */
export function loadIdScheme(text: string, label = 'id-scheme.yml'): IdSchemeLoad {
  const read = readMapping(text, label)
  if (read.doc === undefined) return { scheme: undefined, problems: [read.problem] }
  const scopes = read.doc.scopes
  if (!isMapping(scopes)) return { scheme: undefined, problems: [`${label}: scopes must map scope directories to prefixes`] }
  const problems: string[] = []
  const owners = new Map<string, string>()
  const value: Record<string, string> = {}
  for (const [scope, prefix] of Object.entries(scopes)) {
    if (typeof prefix !== 'string' || !PREFIX.test(prefix)) {
      problems.push(`${label}: scopes.${scope} prefix '${String(prefix)}' must be 1 to 6 uppercase letters`)
      continue
    }
    const owner = owners.get(prefix)
    if (owner !== undefined) {
      problems.push(`${label}: prefix ${prefix} is declared for both ${owner} and ${scope}`)
      continue
    }
    owners.set(prefix, scope)
    value[scope] = prefix
  }
  return problems.length === 0 ? { scheme: { scopes: value }, problems: [] } : { scheme: undefined, problems }
}
