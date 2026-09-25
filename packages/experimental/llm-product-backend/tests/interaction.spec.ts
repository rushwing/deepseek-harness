import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { UserQuestionError, type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import {
  approvalAllows,
  askApproval,
  askQuestions,
} from '@deepseek-ai/dsh-experimental-llm-product-backend'

const agent = { id: 'session-1' } as Agent
const approvalRequest: ApprovalRequest = { agent, toolName: 'codex:command', reason: 'ls' }
const questionRequest: AskUserQuestionRequest = { agent, questions: [{ id: 'q1', question: 'Proceed?' }] }

describe('askApproval', () => {
  it('returns the answerer outcome', async () => {
    await expect(askApproval({ request: async () => 'allowed-once' }, approvalRequest)).resolves.toBe('allowed-once')
    await expect(askApproval({ request: async () => 'rejected' }, approvalRequest)).resolves.toBe('rejected')
  })

  it('fails closed to unavailable when the service throws', async () => {
    await expect(askApproval({ request: async () => { throw new Error('no open turn') } }, approvalRequest))
      .resolves.toBe('unavailable')
  })

  it('only allowed-once allows the product action', () => {
    expect(approvalAllows('allowed-once')).toBe(true)
    expect(approvalAllows('rejected')).toBe(false)
    expect(approvalAllows('cancelled')).toBe(false)
    expect(approvalAllows('unavailable')).toBe(false)
  })
})

describe('askQuestions', () => {
  it('returns the human answer', async () => {
    const answer = { answers: [{ id: 'q1', selected: ['Yes'] }] }
    await expect(askQuestions({ ask: async () => answer }, questionRequest)).resolves.toEqual(answer)
  })

  it('returns undefined when no human can answer', async () => {
    for (const code of ['NO_PROVIDER', 'DELEGATED_CALLER', 'CALLER_NOT_LIVE']) {
      await expect(askQuestions({
        ask: async () => { throw new UserQuestionError(`no answer: ${code}`, code) },
      }, questionRequest)).resolves.toBeUndefined()
    }
  })

  it('rethrows cancellation and unexpected failures', async () => {
    await expect(askQuestions({
      ask: async () => { throw new UserQuestionError('aborted', 'ASK_ABORTED') },
    }, questionRequest)).rejects.toThrow('aborted')
    await expect(askQuestions({
      ask: async () => { throw new Error('boom') },
    }, questionRequest)).rejects.toThrow('boom')
  })
})
