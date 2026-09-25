/**
 * Bridges from a product's approval and user-input requests to the harness
 * interaction services. Both fail closed: an approval the deployment cannot
 * answer settles `unavailable`, and a question without a human answerer
 * settles as no answer.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/interaction
 */

import type { ApprovalOutcome, ApprovalRequest, ApprovalService } from '@deepseek-ai/dsh-user-approval'
import {
  UserQuestionError,
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
  type UserQuestionService,
} from '@deepseek-ai/dsh-user-questions'

const NO_ANSWERER_CODES = new Set(['NO_PROVIDER', 'DELEGATED_CALLER', 'CALLER_NOT_LIVE'])

/**
 * Ask the approval service and fail closed.
 * @param approval - the `ctx.approval` service.
 * @param request - the product action being decided.
 * @returns the outcome; a thrown service failure settles `unavailable`.
 */
export async function askApproval(
  approval: Pick<ApprovalService, 'request'>,
  request: ApprovalRequest,
): Promise<ApprovalOutcome> {
  try {
    return await approval.request(request)
  } catch (error: unknown) {
    // The approval seam fails closed: a request outside an open turn, a throwing
    // answerer, or a disposed service all deny the product action.
    void error
    return 'unavailable'
  }
}

/**
 * Whether an approval outcome lets the product action run.
 * @param outcome - the approval service's answer.
 * @returns `true` only for `allowed-once`.
 */
export function approvalAllows(outcome: ApprovalOutcome): boolean {
  return outcome === 'allowed-once'
}

/**
 * Ask the user-questions service and treat "nobody can answer" as no answer.
 * @param userQuestions - the `ctx.userQuestions` service.
 * @param request - the product's questions for the human.
 * @returns the human's answer, or `undefined` when no answerer exists for this agent.
 * @throws the service's own error for cancellation and unexpected failures.
 */
export async function askQuestions(
  userQuestions: Pick<UserQuestionService, 'ask'>,
  request: AskUserQuestionRequest,
): Promise<AskUserQuestionAnswer | undefined> {
  try {
    return await userQuestions.ask(request)
  } catch (error: unknown) {
    if (error instanceof UserQuestionError && NO_ANSWERER_CODES.has(error.code)) return undefined
    throw error
  }
}
