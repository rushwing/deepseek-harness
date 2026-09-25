import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { UserQuestionError, type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import {
  ThreadRegistry,
  createServerRequestHandler,
} from '@deepseek-ai/dsh-experimental-llm-codex'

const agent = { id: 'session-1' } as Agent

function harness(approve: 'allowed-once' | 'rejected' | 'unavailable' = 'allowed-once') {
  const threads = new ThreadRegistry()
  const approvals: ApprovalRequest[] = []
  const questions: AskUserQuestionRequest[] = []
  const handler = createServerRequestHandler(threads, {
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
        return { answers: [{ id: 'q1', selected: ['Yes'], custom: 'and more' }, { id: 'q2', selected: [] }] }
      },
    },
  })
  return { threads, handler, approvals, questions }
}

const signal = new AbortController().signal

describe('bridged routes', () => {
  it('accepts a command when the human allows it once and records the request facts', async () => {
    const h = harness('allowed-once')
    h.threads.set('thread-A', { agent, mode: 'bridge', signal })
    const answer = await h.handler({
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-A', turnId: 't1', itemId: 'c1', command: 'npm test', availableDecisions: ['accept', 'decline'] },
      threadId: 'thread-A',
      turnId: 't1',
    })
    expect(answer).toEqual({ decision: 'accept' })
    expect(h.approvals).toEqual([{ agent, toolName: 'codex:command', reason: 'npm test', signal }])
  })

  it('declines a command the human rejects, preferring cancel when Codex offers it', async () => {
    const h = harness('rejected')
    h.threads.set('thread-A', { agent, mode: 'bridge', signal })
    expect(await h.handler({
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-A', turnId: 't1', itemId: 'c1', reason: 'clean the build tree', availableDecisions: ['accept', 'cancel', 'decline'] },
      threadId: 'thread-A',
      turnId: 't1',
    })).toEqual({ decision: 'cancel' })
    expect(h.approvals[0]).toMatchObject({ toolName: 'codex:command', reason: 'clean the build tree' })
  })

  it('fails closed when the approval service cannot answer', async () => {
    const h = harness('unavailable')
    h.threads.set('thread-A', { agent, mode: 'bridge', signal })
    expect(await h.handler({
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread-A', turnId: 't1', itemId: 'f1', reason: 'write config' },
      threadId: 'thread-A',
      turnId: 't1',
    })).toEqual({ decision: 'decline' })
    expect(h.approvals[0]).toMatchObject({ toolName: 'codex:file-change', reason: 'write config' })
  })

  it('grants requested permissions for the turn only when allowed', async () => {
    const allowed = harness('allowed-once')
    allowed.threads.set('thread-A', { agent, mode: 'bridge', signal })
    const permissions = { network: { enabled: true } }
    expect(await allowed.handler({
      method: 'item/permissions/requestApproval',
      params: { threadId: 'thread-A', turnId: 't1', itemId: 'p1', permissions, reason: 'fetch docs' },
      threadId: 'thread-A',
      turnId: 't1',
    })).toEqual({ permissions, scope: 'turn' })
    expect(allowed.approvals[0]).toMatchObject({ toolName: 'codex:permissions', reason: 'fetch docs' })

    const denied = harness('rejected')
    denied.threads.set('thread-A', { agent, mode: 'bridge', signal })
    expect(await denied.handler({
      method: 'item/permissions/requestApproval',
      params: { threadId: 'thread-A', turnId: 't1', itemId: 'p1', permissions },
      threadId: 'thread-A',
      turnId: 't1',
    })).toEqual({ permissions: {}, scope: 'turn' })
  })

  it('maps Codex questions to user questions and answers back by question id', async () => {
    const h = harness()
    h.threads.set('thread-A', { agent, mode: 'bridge', signal })
    const answer = await h.handler({
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-A',
        turnId: 't1',
        itemId: 'q',
        isBlocking: true,
        questions: [
          { id: 'q1', header: 'Confirm', question: 'Deploy?', options: [{ label: 'Yes', description: 'Ship it' }, { label: 'No' }] },
          { id: 'q2', header: 'Notes', question: 'Anything else?', options: null },
        ],
      },
      threadId: 'thread-A',
      turnId: 't1',
    })
    expect(answer).toEqual({ answers: { q1: { answers: ['Yes', 'and more'] }, q2: { answers: [] } } })
    expect(h.questions).toEqual([{
      agent,
      signal,
      questions: [
        { id: 'q1', header: 'Confirm', question: 'Deploy?', options: [{ label: 'Yes', description: 'Ship it' }, { label: 'No' }] },
        { id: 'q2', header: 'Notes', question: 'Anything else?' },
      ],
    }])
  })

  it('rejects malformed question lists instead of asking a garbled question', async () => {
    const h = harness()
    h.threads.set('thread-A', { agent, mode: 'bridge', signal })
    const ask = (questions: unknown) => h.handler({
      method: 'item/tool/requestUserInput',
      params: { threadId: 'thread-A', turnId: 't1', itemId: 'q', isBlocking: true, questions },
      threadId: 'thread-A',
      turnId: 't1',
    })
    await expect(ask('Deploy?')).rejects.toThrow('llm-codex: app-server sent a non-array questions list')
    await expect(ask([{ id: 'q1', header: 'H', question: 'Q?', options: 'Yes' }]))
      .rejects.toThrow('llm-codex: app-server sent a non-array questions[0].options')
    expect(h.questions).toEqual([])
  })

  it('answers nothing when no human can take the question', async () => {
    const threads = new ThreadRegistry()
    threads.set('thread-A', { agent, mode: 'bridge', signal })
    const handler = createServerRequestHandler(threads, {
      approval: { request: async () => 'rejected' },
      userQuestions: { ask: async () => { throw new UserQuestionError('nobody', 'NO_PROVIDER') } },
    })
    expect(await handler({
      method: 'item/tool/requestUserInput',
      params: { threadId: 'thread-A', turnId: 't1', itemId: 'q', isBlocking: true, questions: [{ id: 'q1', header: 'H', question: 'Q?' }] },
      threadId: 'thread-A',
      turnId: 't1',
    })).toEqual({ answers: {} })
  })
})

describe('native and unknown threads', () => {
  it('answers unattended for native-mode threads and for threads it does not know', async () => {
    const h = harness('allowed-once')
    h.threads.set('thread-N', { agent, mode: 'never', signal })
    for (const threadId of ['thread-N', 'thread-unknown']) {
      expect(await h.handler({
        method: 'item/commandExecution/requestApproval',
        params: { threadId, turnId: 't1', itemId: 'c1', command: 'ls', availableDecisions: ['accept', 'decline'] },
        threadId,
        turnId: 't1',
      })).toEqual({ decision: 'decline' })
      expect(await h.handler({
        method: 'item/permissions/requestApproval',
        params: { threadId, turnId: 't1', itemId: 'p1', permissions: {} },
        threadId,
        turnId: 't1',
      })).toEqual({ permissions: {}, scope: 'turn' })
      expect(await h.handler({
        method: 'item/tool/requestUserInput',
        params: { threadId, turnId: 't1', itemId: 'q', isBlocking: true, questions: [] },
        threadId,
        turnId: 't1',
      })).toEqual({ answers: {} })
    }
    expect(h.approvals).toEqual([])
  })

  it('declines MCP elicitation everywhere and rejects unknown request methods', async () => {
    const h = harness()
    expect(await h.handler({ method: 'mcpServer/elicitation/request', params: {}, threadId: undefined, turnId: undefined }))
      .toEqual({ action: 'decline', content: null, _meta: null })
    await expect(h.handler({ method: 'item/tool/call', params: {}, threadId: 'thread-A', turnId: 't1' }))
      .rejects.toThrow('unsupported app-server request "item/tool/call"')
  })
})

describe('ThreadRegistry', () => {
  it('stores, reads, and forgets bridged threads', () => {
    const threads = new ThreadRegistry()
    expect(threads.get('x')).toBeUndefined()
    expect(threads.get(undefined)).toBeUndefined()
    threads.set('x', { agent, mode: 'bridge', signal })
    expect(threads.get('x')?.mode).toBe('bridge')
    threads.delete('x')
    expect(threads.get('x')).toBeUndefined()
  })
})
