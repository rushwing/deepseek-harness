import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, type AgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, markAgentLoopRequest, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as LlmCodex from '@deepseek-ai/dsh-experimental-llm-codex'
import { completeHandshake, fakeSpawner, type FakeSpawner } from './fake-app-server.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.restoreAllMocks()
})

async function mount(): Promise<{ ctx: Context; harness: AgentLoopTestHarness; spawner: FakeSpawner }> {
  const ctx = new Context()
  context = ctx
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(UserQuestionService)
  const spawner = fakeSpawner()
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spawner.spawn)
  return { ctx, harness, spawner }
}

describe('llm-codex plugin', () => {
  it('registers its routes and projection, runs a Session turn through the LLM runtime, and unwinds on disposal', async () => {
    const { ctx, harness, spawner } = await mount()
    const fiber = await ctx.plugin(LlmCodex, {
      routes: { codex: {}, 'codex-unattended': { permissionMode: 'never' } },
      disposeGraceMs: 50,
    })
    expect(ctx.llm.listProviders()).toEqual([
      { id: 'codex', name: 'Codex' },
      { id: 'codex-unattended', name: 'Codex (codex-unattended)' },
    ])
    expect(spawner.children).toHaveLength(0)
    const agent = await harness.create(SessionId('session-1'), { provider: 'codex', model: 'gpt-5.6-sol' }, { cwd: '/work' })
    expect(ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toBeNull()

    const chunks: StreamChunk[] = []
    const collecting = (async () => {
      const request = markAgentLoopRequest({
        provider: 'codex',
        model: 'gpt-5.6-sol',
        messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
        sessionId: agent.id,
      })
      for await (const chunk of ctx.llm.stream(request)) chunks.push(chunk)
    })()
    const child = await spawner.nextChild()
    expect(child.spec.cwd).toBe(process.cwd())
    await completeHandshake(child)
    child.peer.respond(await child.peer.nextMethod('account/read'), { account: { type: 'chatgpt' }, requiresOpenaiAuth: true })
    child.peer.respond(await child.peer.nextMethod('model/list'), { data: [], nextCursor: null })
    const start = await child.peer.nextMethod('thread/start')
    expect(start.params).toMatchObject({ cwd: '/work', ephemeral: false, approvalPolicy: 'on-request' })
    child.peer.respond(start, { thread: { id: 'thread-1' } })
    const turn = await child.peer.nextMethod('turn/start')
    child.peer.respond(turn, { turn: { id: 'turn-1', status: 'inProgress' } })
    child.peer.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'm', delta: 'hi' })
    child.peer.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } })
    await collecting
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'hi')).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toEqual({
      conversationId: 'thread-1',
      cwd: '/work',
      model: 'gpt-5.6-sol',
    })

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toBeUndefined()
    expect(child.terminated()).toBe(1)
  })

  it('refuses a configuration without routes or with an invalid grace at load', async () => {
    const { ctx } = await mount()
    await expect(ctx.plugin(LlmCodex, { routes: {} })).rejects.toThrow('at least one route')
    await expect(ctx.plugin(LlmCodex, { disposeGraceMs: 0 })).rejects.toThrow('disposeGraceMs')
    expect(ctx.llm.listProviders()).toEqual([])
  })
})
