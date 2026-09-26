/**
 * The English artifact contract's parser-facing defaults, used by tests and
 * by the scaffold the orchestrator writes; a workspace's
 * `artifact-contract.yml` may replace them.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/defaults
 */

import type { ParseOptions } from './artifacts.ts'
import { DEFAULT_ARTIFACT_CONTRACT, parseOptionsOf } from './contract.ts'

/** Parser options of the English contract. */
export const DEFAULT_PARSE_OPTIONS: ParseOptions = parseOptionsOf(DEFAULT_ARTIFACT_CONTRACT)
