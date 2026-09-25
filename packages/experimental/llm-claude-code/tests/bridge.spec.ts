import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { UserQuestionError, type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { createBridgedCallbacks, unattendedCallbacks } from '@deepseek-ai/dsh-experimental-llm-claude-code'

const agent = { id: 'session-1' } as Agent
const signal = new AbortController().signal
const callOptions = { signal, toolUseID: 'tool-use-1', requestId: 'request-1' }

function harness(approve: 'allowed-once' | 'rejected' | 'unavailable' = 'allowed-once', answerer = true) {
  const approvals: ApprovalRequest[] = []
  const questions: AskUserQuestionRequest[] = []
  const callbacks = createBridgedCallbacks({ agent, signal }, {
    approval: {
      request: async (request) => {
        approvals.push(request)
        if (approve === 'unavailable') throw new Error('no open turn')
        return approve
      },
    },
    userQuestions: {
      ask: async (request) => {
        questions.push(request)
        if (!answerer) throw new UserQuestionError('nobody', 'NO_PROVIDER')
        return {
          answers: [
            { id: 'q0', selected: ['Yes'], custom: 'and quickly' },
            { id: 'q1', selected: ['Blue', 'Green'] },
            { id: 'q9', selected: ['stray'] },
          ],
        }
      },
    },
  })
  return { callbacks, approvals, questions }
}

describe('bridged callbacks', () => {
  it('allows a tool the human approves once and names the tool and its input in the request', async () => {
    const h = harness('allowed-once')
    const input = { command: 'pnpm test', description: 'run the tests' }
    expect(await h.callbacks.canUseTool('Bash', input, callOptions)).toEqual({ behavior: 'allow', updatedInput: input })
    expect(h.approvals).toEqual([{ agent, toolName: 'claude-code:Bash', reason: 'run the tests', signal }])
    expect(await h.callbacks.canUseTool('Read', { offset: 1 }, callOptions)).toEqual({ behavior: 'allow', updatedInput: { offset: 1 } })
    expect(h.approvals[1]).toEqual({ agent, toolName: 'claude-code:Read', signal })
  })

  it('denies a tool the human rejects or the deployment cannot answer', async () => {
    for (const outcome of ['rejected', 'unavailable'] as const) {
      const h = harness(outcome)
      expect(await h.callbacks.canUseTool('Edit', { file_path: 'src/a.ts' }, callOptions))
        .toEqual({ behavior: 'deny', message: 'dsh declined the Edit tool call' })
      expect(h.approvals[0]).toMatchObject({ toolName: 'claude-code:Edit', reason: 'src/a.ts' })
    }
  })

  it('answers AskUserQuestion through the user-question service, keyed by question text', async () => {
    const h = harness()
    const input = {
      questions: [
        { question: 'Deploy now?', header: 'Deploy', options: [{ label: 'Yes', description: 'Ship' }, { label: 'No', description: 'Wait' }] },
        { question: 'Which colors?', header: 'Colors', multiSelect: true, options: [{ label: 'Blue', description: 'b' }, { label: 'Green' }] },
      ],
    }
    expect(await h.callbacks.canUseTool('AskUserQuestion', input, callOptions)).toEqual({
      behavior: 'allow',
      updatedInput: { ...input, answers: { 'Deploy now?': 'Yes, and quickly', 'Which colors?': 'Blue, Green' } },
    })
    expect(h.questions).toEqual([{
      agent,
      signal,
      questions: [
        { id: 'q0', header: 'Deploy', question: 'Deploy now?', options: [{ label: 'Yes', description: 'Ship' }, { label: 'No', description: 'Wait' }] },
        { id: 'q1', header: 'Colors', question: 'Which colors?', multiSelect: true, options: [{ label: 'Blue', description: 'b' }, { label: 'Green' }] },
      ],
    }])
    expect(h.approvals).toEqual([])
  })

  it('denies AskUserQuestion when nobody can answer or the input is malformed', async () => {
    const silent = harness('allowed-once', false)
    expect(await silent.callbacks.canUseTool('AskUserQuestion', { questions: [{ question: 'Q?', header: 'H', options: [] }] }, callOptions))
      .toEqual({ behavior: 'deny', message: 'no one can answer questions for this Session' })
    const malformed = harness()
    expect(await malformed.callbacks.canUseTool('AskUserQuestion', { questions: 'Q?' }, callOptions))
      .toEqual({ behavior: 'deny', message: 'AskUserQuestion input did not match the tool schema' })
    expect(malformed.questions).toEqual([])
  })

  it('declines elicitations and cancels dialogs', async () => {
    const h = harness()
    expect(await h.callbacks.onElicitation({ serverName: 's', message: 'm' }, { signal, requestId: 'r' }))
      .toEqual({ action: 'decline' })
    expect(await h.callbacks.onUserDialog({ dialogKind: 'refusal_fallback_prompt', payload: {} }, { signal, requestId: 'r' }))
      .toEqual({ behavior: 'cancelled' })
  })
})

describe('unattended callbacks', () => {
  it('denies tools, declines elicitations, and cancels dialogs without asking anyone', async () => {
    const callbacks = unattendedCallbacks()
    expect(await callbacks.canUseTool('Bash', { command: 'ls' }, callOptions))
      .toEqual({ behavior: 'deny', message: 'this unattended Claude Code route cannot request human approval' })
    expect(await callbacks.onElicitation({ serverName: 's', message: 'm' }, { signal, requestId: 'r' }))
      .toEqual({ action: 'decline' })
    expect(await callbacks.onUserDialog({ dialogKind: 'x', payload: {} }, { signal, requestId: 'r' }))
      .toEqual({ behavior: 'cancelled' })
  })
})
