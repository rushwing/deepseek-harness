import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, type AgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, markAgentLoopRequest, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as LlmClaudeCode from '@deepseek-ai/dsh-experimental-llm-claude-code'
import type { QueryFactory } from '@deepseek-ai/dsh-experimental-llm-claude-code'
import { fakeQueryFactory, fakeSpawner, type FakeQueryFactory, type FakeSpawner } from './fake-claude.ts'

const queryMock = vi.hoisted(() => vi.fn<QueryFactory>())

vi.mock('@deepseek-ai/dsh-claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-claude-agent-sdk')>(),
  query: queryMock,
}))

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  queryMock.mockReset()
  vi.restoreAllMocks()
})

async function mount(): Promise<{ ctx: Context; harness: AgentLoopTestHarness; spawner: FakeSpawner; queries: FakeQueryFactory }> {
  const ctx = new Context()
  context = ctx
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(UserQuestionService)
  const spawner = fakeSpawner()
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spawner.spawn)
  const queries = fakeQueryFactory(spawner)
  queryMock.mockImplementation(queries.factory)
  return { ctx, harness, spawner, queries }
}

describe('llm-claude-code plugin', () => {
  it('registers its routes and projection, runs a Session turn through the LLM runtime, and unwinds on disposal', async () => {
    const { ctx, harness, spawner, queries } = await mount()
    const fiber = await ctx.plugin(LlmClaudeCode, {
      routes: { 'claude-code': {}, 'claude-code-unattended': { permissionMode: 'dontAsk' } },
      disposeGraceMs: 50,
    })
    expect(ctx.llm.listProviders()).toEqual([
      { id: 'claude-code', name: 'Claude Code' },
      { id: 'claude-code-unattended', name: 'Claude Code (claude-code-unattended)' },
    ])
    expect(spawner.children).toHaveLength(0)
    const agent = await harness.create(SessionId('session-1'), { provider: 'claude-code', model: 'sonnet' }, { cwd: '/work' })
    expect(ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toBeNull()

    const chunks: StreamChunk[] = []
    const collecting = (async () => {
      const request = markAgentLoopRequest({
        provider: 'claude-code',
        model: 'sonnet',
        messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
        sessionId: agent.id,
      })
      for await (const chunk of ctx.llm.stream(request)) chunks.push(chunk)
    })()
    const catalog = await queries.nextQuery()
    expect(catalog.options.cwd).toBe(process.cwd())
    catalog.resolveModels([])
    const turn = await queries.nextQuery()
    expect(turn.options).toMatchObject({ cwd: '/work', model: 'sonnet', permissionMode: 'default', persistSession: true })
    expect(turn.child()?.spec).toMatchObject({ cwd: '/work', graceMs: 50 })
    turn.emit({ type: 'system', subtype: 'init', session_id: 'cs-1' } as Parameters<typeof turn.emit>[0])
    turn.emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      parent_tool_use_id: null,
      session_id: 'cs-1',
    } as Parameters<typeof turn.emit>[0])
    turn.emit({
      type: 'result', subtype: 'success', is_error: false, result: 'hi', session_id: 'cs-1',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as Parameters<typeof turn.emit>[0])
    await collecting
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'hi')).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toEqual({ conversationId: 'cs-1', cwd: '/work', model: 'sonnet' })
    expect(turn.closed()).toBe(1)

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toBeUndefined()
  })

  it('refuses a configuration without routes or with an invalid grace at load', async () => {
    const { ctx } = await mount()
    await expect(ctx.plugin(LlmClaudeCode, { routes: {} })).rejects.toThrow('at least one route')
    await expect(ctx.plugin(LlmClaudeCode, { disposeGraceMs: 0 })).rejects.toThrow('disposeGraceMs')
    expect(ctx.llm.listProviders()).toEqual([])
  })
})
