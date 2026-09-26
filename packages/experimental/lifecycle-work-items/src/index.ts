/**
 * Lifecycle team work items: REQ, TC, BUG, RV, and PL Markdown artifacts
 * parsed into a graph, linted against the artifact contract, and moved by
 * transition guards and effects.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items
 */

export { parseAcceptance, type AcceptanceItem } from './acceptance.ts'
export {
  parseArtifact,
  segmentsOf,
  stemOf,
  type Artifact,
  type ArtifactBase,
  type Bug,
  type ParseOptions,
  type Pl,
  type Req,
  type Rv,
  type Tc,
} from './artifacts.ts'
export {
  DEFAULT_ARTIFACT_CONTRACT,
  loadArtifactContract,
  parseOptionsOf,
  reqHeadingList,
  reviewVocabularyOf,
  tcHeadingList,
  type ArtifactContract,
  type ArtifactContractLoad,
} from './contract.ts'
export { DEFAULT_PARSE_OPTIONS } from './defaults.ts'
export { loadGraph, type ArtifactGraph, type Ref } from './graph.ts'
export { lint } from './lint.ts'
export { lintContext, type FileProbe, type LintContext, type LintInputs, type PathKind, type Violation } from './rules/context.ts'
export {
  DEFAULT_REVIEW_VOCABULARY,
  REGRESSION_SECTION,
  parseRegression,
  parseReview,
  parseReviewSection,
  type RegressionLine,
  type Review,
  type ReviewSection,
  type ReviewVocabulary,
} from './review.ts'
export { directorySource, memorySource, type WorkItemSource } from './source.ts'
export { asList, isIsoDate, positiveInt, scalar, splitFrontmatter, type Frontmatter, type FrontmatterSplit } from './frontmatter.ts'
export {
  ARTIFACT_KINDS,
  acIdParts,
  derivedReqOf,
  idPrefixOf,
  idShapeOf,
  kindOf,
  locationOf,
  misplaced,
  reqOfSameNumber,
  type AcIdParts,
  type ArtifactKind,
  type ArtifactLocation,
} from './ids.ts'
export {
  codePointLength,
  duplicateHeadings,
  maskedLines,
  sectionContent,
  sectionHeadings,
  sectionSlices,
  splitLines,
  visibleLines,
  visibleSectionContent,
} from './text.ts'
