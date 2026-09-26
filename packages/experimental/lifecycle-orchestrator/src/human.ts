/**
 * Human decisions: when the REQ is owned by the human, the driver asks the
 * user-questions service which legal transition applies, or stops when no
 * answerer can be reached.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/human
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { LegalTransition } from './workspace.ts'

/** What the human decided, or why nobody could. */
export type HumanDecision =
  | { readonly kind: 'transition'; readonly id: string }
  | { readonly kind: 'stop'; readonly answer: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

/** The question the driver asks. */
export interface HumanRequest {
  readonly reqId: string
  readonly state: string
  readonly options: readonly LegalTransition[]
}

/** The answer that ends the run without a transition. */
export const STOP = 'Stop'
const QUESTION_ID = 'lifecycle-transition'
/** Rejection codes of `userQuestions.ask` that mean no human can answer this Session. */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['NO_PROVIDER', 'DELEGATED_CALLER', 'CALLER_NOT_LIVE'])

/**
 * Ask the human which legal transition applies.
 * @param ctx - the plugin context; the user-questions service is optional.
 * @param mode - `ask` uses the service when composed; `stop` never asks.
 * @param agent - the root agent the question is scoped to.
 * @param request - the REQ, its state, and the legal transitions.
 * @param signal - abort cancels the question.
 * @returns the decision; `unavailable` carries the reason nobody answered.
 * @throws whatever `ask` rejects with beyond the no-answerer codes.
 */
export async function decideWithHuman(ctx: Context, mode: 'ask' | 'stop', agent: Agent, request: HumanRequest, signal: AbortSignal): Promise<HumanDecision> {
  if (mode === 'stop') return { kind: 'unavailable', reason: 'humanDecisions is stop' }
  const questions = ctx.get('userQuestions')
  if (questions === undefined) return { kind: 'unavailable', reason: 'no user-questions service is composed' }
  try {
    const answer = await questions.ask({
      questions: [{
        id: QUESTION_ID,
        header: 'Lifecycle',
        question: `${request.reqId} is at ${request.state} and owned by the human. Which transition applies?`,
        options: [
          ...request.options.map(transition => ({ label: transition.id, description: `to ${transition.to}, owner ${transition.ownerAfter}` })),
          { label: STOP, description: 'Leave the REQ as it is and end the run' },
        ],
      }],
      agent,
      signal,
    })
    const [chosen = STOP] = answer.answers.flatMap(entry => entry.selected)
    return request.options.some(transition => transition.id === chosen) ? { kind: 'transition', id: chosen } : { kind: 'stop', answer: chosen }
  } catch (error: unknown) {
    if (error instanceof HarnessError && UNAVAILABLE_CODES.has(error.code)) return { kind: 'unavailable', reason: error.code }
    throw error
  }
}
