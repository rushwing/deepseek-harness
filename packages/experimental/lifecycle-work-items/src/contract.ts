/**
 * The artifact contract: the language-specific headings, labels, budgets,
 * enumerations, and implementation lexicon the lint rules read from a
 * workspace's `artifact-contract.yml`, with the English default the
 * orchestrator scaffolds.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/contract
 */

import { parseDocument } from 'yaml'
import { z } from 'zod'
import type { ParseOptions } from './artifacts.ts'
import type { ReviewVocabulary } from './review.ts'

const CONTRACT_VERSION = 1

const budget = z.number().int().positive()
const names = z.array(z.string().min(1)).min(1)

/* jscpd:ignore-start */
const contractSchema = z.strictObject({
  version: z.literal(CONTRACT_VERSION),
  schema: z.strictObject({ key: z.string().min(1), version: z.number().int() }),
  words: z.strictObject({ none: z.string().min(1) }),
  req: z.strictObject({
    headings: z.strictObject({
      goal: z.string().min(1),
      behavior: z.string().min(1),
      nonGoals: z.string().min(1),
      acceptance: z.string().min(1),
      pendingDecisions: z.string().min(1),
      designReferences: z.string().min(1),
      bugHistory: z.string().min(1),
    }),
    bannedHeadings: z.array(z.string().min(1)),
    sectionBudgets: z.record(z.string(), budget),
    bodyBudget: budget,
    acceptanceEntryBudget: budget,
    priorities: names,
    scopes: names,
    pendingDecisionLabels: z.strictObject({ options: z.string().min(1), default: z.string().min(1), deadline: z.string().min(1) }),
  }),
  tc: z.strictObject({
    headings: z.strictObject({
      preconditions: z.string().min(1),
      steps: z.string().min(1),
      expectedResults: z.string().min(1),
      implementationLocation: z.string().min(1),
    }),
    preconditionBudget: budget,
    bodyBudget: budget,
    manualMarker: z.string().min(1),
  }),
  bug: z.strictObject({ severities: names }),
  pl: z.strictObject({ headings: names, bodyBudget: budget }),
  review: z.strictObject({
    conclusionLabel: z.string().min(1),
    verdicts: z.strictObject({ pass: z.string().min(1), reject: z.string().min(1), awaitingSample: z.string().min(1) }),
    fields: names,
    scopeField: z.string().min(1),
    evidenceField: z.string().min(1),
    checklistCount: z.number().int().positive(),
    exemptionMarker: z.string().min(1),
    deferredMarker: z.string().min(1),
    sectionBudget: budget,
    bodyBudget: budget,
    regressionBudget: budget,
  }),
  lexicon: z.strictObject({
    categories: z.record(z.string().min(1), names),
    allowedTerms: z.array(z.string().min(1)),
  }),
})
/* jscpd:ignore-end */

/** The validated artifact contract. */
export type ArtifactContract = z.infer<typeof contractSchema>

/** Result of loading a contract: the contract, or the problems that prevented it. */
export interface ArtifactContractLoad {
  readonly contract: ArtifactContract | undefined
  readonly problems: readonly string[]
}

/** The English artifact contract. Budgets are 2.5 times the Chinese originals. */
export const DEFAULT_ARTIFACT_CONTRACT: ArtifactContract = {
  version: CONTRACT_VERSION,
  schema: { key: 'lifecycle_schema', version: 2 },
  words: { none: 'None' },
  req: {
    headings: {
      goal: 'Goal',
      behavior: 'Behavior',
      nonGoals: 'Non-goals',
      acceptance: 'Acceptance criteria',
      pendingDecisions: 'Pending decisions',
      designReferences: 'Design references',
      bugHistory: 'Bug History',
    },
    bannedHeadings: ['Background', 'Requirement description', 'Revision history', 'Review record', 'Memo', 'Implementation slices'],
    sectionBudgets: {
      'Goal': 2000,
      'Behavior': 15000,
      'Non-goals': 2000,
      'Acceptance criteria': 15000,
      'Pending decisions': 3000,
      'Design references': 2500,
    },
    bodyBudget: 35000,
    acceptanceEntryBudget: 600,
    priorities: ['P0', 'P1', 'P2', 'P3'],
    scopes: ['design', 'backend', 'frontend', 'fullstack', 'infra', 'docs', 'harness', 'tooling'],
    pendingDecisionLabels: { options: 'Options', default: 'Default', deadline: 'Deadline' },
  },
  tc: {
    headings: { preconditions: 'Preconditions', steps: 'Steps', expectedResults: 'Expected results', implementationLocation: 'Implementation location' },
    preconditionBudget: 4000,
    bodyBudget: 10000,
    manualMarker: 'Manual',
  },
  bug: { severities: ['low', 'medium', 'high', 'critical'] },
  pl: {
    headings: ['Contract changes', 'Module placement and slices', 'Test support', 'Risks and open technical points'],
    bodyBudget: 15000,
  },
  review: {
    conclusionLabel: 'Conclusion:',
    verdicts: { pass: 'PASS', reject: 'REJECT', awaitingSample: 'AWAITING SAMPLE' },
    fields: ['Review scope', 'Evidence', 'Findings', 'Pending human-001'],
    scopeField: 'Review scope',
    evidenceField: 'Evidence',
    checklistCount: 8,
    exemptionMarker: 'TC waiver reason:',
    deferredMarker: 'Deferred verification:',
    sectionBudget: 6000,
    bodyBudget: 30000,
    regressionBudget: 6000,
  },
  lexicon: {
    categories: {
      'code path': ['\\b(src|tests|tools|libs|services)/\\S+\\.(py|yaml|json|ts|js)\\b', '::'],
      'CLI flag': ['(?<![\\w-])--[a-z][a-z0-9-]*'],
      'exit code / HTTP status': ['\\bexit\\s*(code\\s*)?\\d', '\\bHTTP\\s*\\d{3}', '(?<![\\d,.])\\b(422|500)\\b(?![\\d,.])'],
      'request/response model name': ['\\b[A-Z][A-Za-z]+(Request|Response)\\b'],
    },
    allowedTerms: ['ConfigError', 'ValidationError', 'InputFormatError'],
  },
}

function repeated(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
}

function contentProblems(contract: ArtifactContract): string[] {
  const problems: string[] = []
  const reqHeadings = reqHeadingList(contract)
  for (const heading of repeated(reqHeadings)) problems.push(`req.headings: heading '${heading}' names more than one section`)
  for (const heading of contract.req.bannedHeadings) {
    if (reqHeadings.includes(heading)) problems.push(`req.bannedHeadings: '${heading}' is also a section heading`)
  }
  for (const heading of Object.keys(contract.req.sectionBudgets)) {
    if (!reqHeadings.includes(heading)) problems.push(`req.sectionBudgets: '${heading}' is not a REQ section heading`)
  }
  for (const heading of repeated(tcHeadingList(contract))) problems.push(`tc.headings: heading '${heading}' names more than one section`)
  for (const heading of repeated(contract.pl.headings)) problems.push(`pl.headings: '${heading}' appears more than once`)
  for (const field of repeated(contract.review.fields)) problems.push(`review.fields: '${field}' appears more than once`)
  for (const key of ['scopeField', 'evidenceField'] as const) {
    if (!contract.review.fields.includes(contract.review[key])) problems.push(`review.${key}: '${contract.review[key]}' is not one of the fixed fields`)
  }
  for (const [category, patterns] of Object.entries(contract.lexicon.categories)) {
    for (const pattern of patterns) {
      try {
        new RegExp(pattern)
      } catch (error: unknown) {
        problems.push(`lexicon.categories.${category}: pattern '${pattern}' does not compile (${String(error)})`)
      }
    }
  }
  return problems
}

/**
 * Load an artifact contract from its YAML text.
 * @param text - the `artifact-contract.yml` text.
 * @param label - file label prefixed to every problem.
 * @returns the contract with no problems, or no contract with every problem.
 */
export function loadArtifactContract(text: string, label = 'artifact-contract.yml'): ArtifactContractLoad {
  const document = parseDocument(text, { uniqueKeys: true })
  const [error] = document.errors
  if (error !== undefined) return { contract: undefined, problems: [`${label}: not valid YAML (${error.message.replace(/\n[\s\S]*$/, '')})`] }
  const value: unknown = document.toJS()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { contract: undefined, problems: [`${label}: top level is not a mapping`] }
  const parsed = contractSchema.safeParse(value)
  if (!parsed.success) {
    return {
      contract: undefined,
      problems: parsed.error.issues.map(issue => `${label}: ${[issue.path.map(String).join('.'), issue.message].filter(part => part !== '').join(': ')}`),
    }
  }
  const problems = contentProblems(parsed.data).map(problem => `${label}: ${problem}`)
  return problems.length === 0 ? { contract: parsed.data, problems: [] } : { contract: undefined, problems }
}

/**
 * The seven REQ body headings in order.
 * @param contract - the contract.
 * @returns the headings.
 */
export function reqHeadingList(contract: ArtifactContract): string[] {
  const { goal, behavior, nonGoals, acceptance, pendingDecisions, designReferences, bugHistory } = contract.req.headings
  return [goal, behavior, nonGoals, acceptance, pendingDecisions, designReferences, bugHistory]
}

/**
 * The four TC body headings in order.
 * @param contract - the contract.
 * @returns the headings.
 */
export function tcHeadingList(contract: ArtifactContract): string[] {
  const { preconditions, steps, expectedResults, implementationLocation } = contract.tc.headings
  return [preconditions, steps, expectedResults, implementationLocation]
}

/**
 * The review vocabulary of a contract.
 * @param contract - the contract.
 * @returns the labels the review parser reads.
 */
export function reviewVocabularyOf(contract: ArtifactContract): ReviewVocabulary {
  const { review } = contract
  return {
    conclusionLabel: review.conclusionLabel,
    verdicts: [review.verdicts.pass, review.verdicts.reject, review.verdicts.awaitingSample],
    fieldLabels: review.fields,
    evidenceLabel: review.evidenceField,
    exemptionMarker: review.exemptionMarker,
    deferredMarker: review.deferredMarker,
  }
}

/**
 * The parser options of a contract.
 * @param contract - the contract.
 * @returns what the artifact parser reads.
 */
export function parseOptionsOf(contract: ArtifactContract): ParseOptions {
  return {
    acceptanceHeading: contract.req.headings.acceptance,
    review: reviewVocabularyOf(contract),
    schemaKey: contract.schema.key,
    schemaVersion: contract.schema.version,
  }
}
