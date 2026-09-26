/**
 * Link rules: every relative link of an in-scope artifact resolves to an
 * existing workspace file, and every reference-style use has its definition.
 * In scope are REQs on the current schema, the TCs of such REQs, and every
 * BUG, RV, and PL. Heading anchors are not checked.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/links
 */

import { posix } from 'node:path'
import type { Artifact } from '../artifacts.ts'
import { INLINE_CODE, inlineLinks, linkTarget, referenceDefinitions, referenceUses } from '../markdown-links.ts'
import { visibleLines } from '../text.ts'
import { quote, type LintContext, type Violation } from './context.ts'

const EXTERNAL_SCHEMES: readonly string[] = ['http://', 'https://', 'mailto:']
const ABSOLUTE = '/'
const ANCHOR = '#'
const PARENT = '..'

function inLinkScope(ctx: LintContext, node: Artifact, v2Reqs: ReadonlySet<string>): boolean {
  switch (node.kind) {
    case 'REQ':
      return node.v2
    case 'TC': {
      const owner = ctx.graph.resolve(node.fm.linked_req, 'REQ').resolved
      return owner !== undefined && v2Reqs.has(owner)
    }
    case 'BUG':
    case 'RV':
    case 'PL':
      return true
  }
}

function checkTarget(ctx: LintContext, node: Artifact, target: string, out: Violation[]): void {
  const rule = 'links'
  if (EXTERNAL_SCHEMES.some(scheme => target.startsWith(scheme))) return
  const hash = target.indexOf(ANCHOR)
  const location = hash < 0 ? target : target.slice(0, hash)
  if (location.startsWith(ABSOLUTE)) {
    out.push({ file: node.label, rule, message: `link ${quote(target)} is an absolute path; only workspace-relative links are allowed` })
    return
  }
  const destination = location === '' ? node.label : posix.normalize(posix.join(posix.dirname(node.label), location))
  if (destination === PARENT || destination.startsWith(`${PARENT}/`)) {
    out.push({ file: node.label, rule, message: `link ${quote(target)} escapes the workspace` })
    return
  }
  switch (ctx.workspace.kind(destination)) {
    case 'missing':
      out.push({ file: node.label, rule, message: `link ${quote(target)} points to a missing file` })
      break
    case 'directory':
      out.push({ file: node.label, rule, message: `link ${quote(target)} points to a directory, not a file` })
      break
    case 'file':
      break
  }
}

/**
 * Relative links of in-scope artifacts resolve to existing files, and
 * reference-style uses have definitions.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkLinks(ctx: LintContext): Violation[] {
  const rule = 'links'
  const out: Violation[] = []
  const v2Reqs = new Set([...ctx.graph.reqs.values()].filter(req => req.v2).map(req => req.id))
  for (const node of ctx.graph.artifacts) {
    if (!inLinkScope(ctx, node, v2Reqs)) continue
    const text = visibleLines(node.body).join('\n').replace(INLINE_CODE, ' ')
    const targets = inlineLinks(text).map(link => linkTarget(link.destination))
    const defined = new Set<string>()
    for (const definition of referenceDefinitions(text)) {
      targets.push(linkTarget(definition.destination))
      defined.add(definition.label)
    }
    for (const use of referenceUses(text)) {
      if (!defined.has(use.label)) out.push({ file: node.label, rule, message: `reference-style link ${quote(use.whole)} has no matching definition in the file` })
    }
    for (const target of targets) checkTarget(ctx, node, target, out)
  }
  return out
}
