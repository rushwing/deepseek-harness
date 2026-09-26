/**
 * The artifact lint: every rule group run to completion over one graph.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/lint
 */

import { lintContext, type LintInputs, type Violation } from './rules/context.ts'
import {
  checkArchiveConsistency,
  checkArtifactUniqueness,
  checkBlockedFields,
  checkFields,
  checkPlacement,
  checkPrNumber,
  checkReqFrontmatter,
} from './rules/frontmatter.ts'
import { checkBugBinding, checkBugClosedConsistency, checkBugClosure, checkBugFrontmatter, checkTcPolicyExit } from './rules/lifecycle.ts'
import { checkLinks } from './rules/links.ts'
import { checkPl } from './rules/pl.ts'
import { checkAcIds, checkHowLexicon, checkPendingDecisions, checkReqBody, checkReqBudgets } from './rules/req-body.ts'
import { checkRvBudgets, checkRvExternalReview, checkRvGatePass, checkRvSignatures, checkRvStructure } from './rules/rv.ts'
import { checkAcCoverage, checkDeferredVerification, checkTcBody, checkTcFrontmatter, checkTcStatusPath } from './rules/tc.ts'

/**
 * Lint a loaded tasks tree. Every rule runs; the graph's own load problems are
 * reported first as `graph` violations.
 * @param inputs - the graph, tables, contract, and workspace probe.
 * @returns every violation in rule order.
 */
export function lint(inputs: LintInputs): Violation[] {
  const ctx = lintContext(inputs)
  const graphProblems = inputs.graph.problems.map((problem): Violation => {
    const separator = problem.indexOf(': ')
    return { file: problem.slice(0, separator), rule: 'graph', message: problem.slice(separator + 2) }
  })
  return [
    ...graphProblems,
    ...checkPlacement(ctx),
    ...checkFields(ctx),
    ...checkArtifactUniqueness(ctx),
    ...checkReqFrontmatter(ctx),
    ...checkBlockedFields(ctx),
    ...checkArchiveConsistency(ctx),
    ...checkPrNumber(ctx),
    ...checkReqBody(ctx),
    ...checkReqBudgets(ctx),
    ...checkAcIds(ctx),
    ...checkHowLexicon(ctx),
    ...checkPendingDecisions(ctx),
    ...checkPl(ctx),
    ...checkLinks(ctx),
    ...checkTcFrontmatter(ctx),
    ...checkAcCoverage(ctx),
    ...checkTcBody(ctx),
    ...checkTcStatusPath(ctx),
    ...checkDeferredVerification(ctx),
    ...checkRvStructure(ctx),
    ...checkRvSignatures(ctx),
    ...checkRvGatePass(ctx),
    ...checkRvBudgets(ctx),
    ...checkRvExternalReview(ctx),
    ...checkTcPolicyExit(ctx),
    ...checkBugBinding(ctx),
    ...checkBugFrontmatter(ctx),
    ...checkBugClosure(ctx),
    ...checkBugClosedConsistency(ctx),
  ]
}
