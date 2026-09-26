/**
 * The failures the lifecycle service reports to tools and commands, each
 * with a stable code.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** The stable failure codes of the lifecycle service. */
export type LifecycleErrorCode = 'NO_WORKSPACE' | 'TABLES_INVALID' | 'UNKNOWN_REQ' | 'UNKNOWN_TRANSITION' | 'NO_BRIEF' | 'NO_ROUTE' | 'INVALID_SCOPE'

/**
 * A lifecycle failure: no workspace, tables that did not load, an unknown REQ,
 * transition, or brief, no model route to seat roles, or an invalid scope.
 */
export class LifecycleError extends HarnessError {
  declare readonly code: LifecycleErrorCode

  constructor(code: LifecycleErrorCode, message: string) {
    super(message, code)
    this.name = 'LifecycleError'
  }
}
