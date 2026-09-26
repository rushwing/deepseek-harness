/**
 * Keyless real-product coverage: the pinned Agent SDK spawns its distributed
 * Claude Code CLI behind the subprocess seam against a loopback Messages
 * fixture, driven through the real agent loop, so session persistence, resume
 * after a plugin restart, the permission bridge, and cancellation are proven
 * against the product rather than a scripted query.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, type AgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as LlmClaudeCode from '@deepseek-ai/dsh-experimental-llm-claude-code'
import { cleanupRealProduct } from '../../../subagent/subagent-codex/tests/real-product-cleanup.ts'
import {
  startMessagesFixture,
  type MessagesBehavior,
  type MessagesFixture,
} from '../../../subagent/subagent-claude-code/tests/messages-fixture.ts'

const fakeKey = 'dsh-fake-anthropic-key'

const roots: string[] = []
const fixtures: MessagesFixture[] = []
const contexts: Context[] = []

// Ambient Anthropic model env leaks into the real CLI and overrides the
// fixture settings on developer machines; remove it for this file only.
const ambientAnthropicModel = process.env.ANTHROPIC_MODEL
const ambientAnthropicSmallFastModel = process.env.ANTHROPIC_SMALL_FAST_MODEL

beforeAll(() => {
  delete process.env.ANTHROPIC_MODEL
  delete process.env.ANTHROPIC_SMALL_FAST_MODEL
})

afterAll(() => {
  if (ambientAnthropicModel !== undefined) process.env.ANTHROPIC_MODEL = ambientAnthropicModel
  if (ambientAnthropicSmallFastModel !== undefined) process.env.ANTHROPIC_SMALL_FAST_MODEL = ambientAnthropicSmallFastModel
})

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupRealProduct({ contexts, fixtures, roots })
})

interface RealInstance {
  readonly fixture: MessagesFixture
  readonly env: Record<string, string>
  readonly workspace: string
}

async function realInstance(behavior: MessagesBehavior): Promise<RealInstance> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llm-claude-code-real-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const claudeConfig = join(root, 'claude-config')
  const xdgConfig = join(root, 'xdg')
  mkdirSync(workspace)
  mkdirSync(claudeConfig)
  mkdirSync(xdgConfig)
  writeFileSync(join(claudeConfig, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } }, null, 2)}\n`)
  const fixture = await startMessagesFixture(behavior)
  fixtures.push(fixture)
  const env = {
    ANTHROPIC_API_KEY: fakeKey,
    ANTHROPIC_BASE_URL: fixture.baseUrl,
    CLAUDE_CONFIG_DIR: claudeConfig,
    HOME: root,
    XDG_CONFIG_HOME: xdgConfig,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    NO_PROXY: '127.0.0.1,localhost',
  }
  return { fixture, env, workspace }
}

interface RealRuntime {
  readonly ctx: Context
  readonly harness: AgentLoopTestHarness
  readonly handles: SubprocessHandle[]
  readonly spawnSpecs: SubprocessSpawnSpec[]
  readonly approvals: { toolName: string; reason: string | undefined }[]
  readonly mount: () => Promise<{ dispose: () => Promise<void> }>
}

async function realRuntime(instance: RealInstance, answer: ApprovalOutcome = 'rejected'): Promise<RealRuntime> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(UserQuestionService)
  const handles: SubprocessHandle[] = []
  const spawnSpecs: SubprocessSpawnSpec[] = []
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    spawnSpecs.push(spec)
    const handle = spawn(spec)
    handles.push(handle)
    return handle
  })
  const approvals: RealRuntime['approvals'] = []
  ctx.on('approval/request', (request) => {
    approvals.push({ toolName: request.toolName, reason: request.reason })
    return Promise.resolve<ApprovalOutcome>(answer)
  })
  const mount = async (): Promise<{ dispose: () => Promise<void> }> => {
    const fiber = await ctx.plugin(LlmClaudeCode, {
      routes: { 'claude-code': {} },
      env: instance.env,
      disposeGraceMs: 3_000,
    })
    return { dispose: async () => { await fiber.dispose() } }
  }
  return { ctx, harness, handles, spawnSpecs, approvals, mount }
}

async function turn(agent: Agent, text: string): Promise<SessionEvent[]> {
  const before = agent.session.seq
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
  return agent.session.snapshotEvents().slice(before)
}

function assistantBlocks(events: readonly SessionEvent[], type: 'text' | 'reasoning'): string {
  return events.flatMap(event => (event.type === 'assistant/message' ? event.data.message.content : []))
    .map(block => (block.type === type ? block.text : ''))
    .join('')
}

function turnEnd(events: readonly SessionEvent[]): SessionEvent<'turn/end'>['data']['reason'] {
  const end = events.findLast(event => event.type === 'turn/end')
  if (end?.type !== 'turn/end') throw new Error('turn did not end')
  return end.data.reason
}

/** Every text the Messages request carries, across user and assistant turns. */
function messageTexts(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.messages)) return []
  return body.messages.flatMap((message): string[] => {
    if (message === null || typeof message !== 'object') return []
    const content = (message as Record<string, unknown>).content
    if (typeof content === 'string') return [content]
    if (!Array.isArray(content)) return []
    return content.flatMap((part): string[] => (
      part !== null && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
        ? [(part as Record<string, unknown>).text as string]
        : []
    ))
  })
}

async function expectQuiescent(handles: readonly SubprocessHandle[]): Promise<void> {
  for (const handle of handles) expect(await handle.waitForExit()).toBe(true)
}

describe('real Claude Agent SDK 0.3.263 conversation backend', () => {
  it('runs two loop turns on one persisted Claude Code session whose history the CLI owns', async () => {
    const instance = await realInstance({ kind: 'complete', text: 'Fixture answer' })
    const runtime = await realRuntime(instance)
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('claude-real-two-turns'), { provider: 'claude-code', model: 'fixture-model' }, { cwd: instance.workspace })

    const first = await turn(agent, 'First question about pelicans')
    expect(assistantBlocks(first, 'text')).toBe('Fixture answer')
    expect(turnEnd(first)).toEqual({ kind: 'completed' })
    const binding = runtime.ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')
    expect(binding).toMatchObject({ cwd: instance.workspace, model: 'fixture-model' })
    expect(typeof binding?.conversationId).toBe('string')

    const second = await turn(agent, 'Second question')
    expect(assistantBlocks(second, 'text')).toBe('Fixture answer')
    expect(instance.fixture.requests.length).toBeGreaterThanOrEqual(2)
    const history = messageTexts(instance.fixture.requests.at(-1)!.body)
    expect(history.some(text => text.includes('First question about pelicans'))).toBe(true)
    expect(history.some(text => text.includes('Fixture answer'))).toBe(true)
    expect(history.some(text => text.includes('Second question'))).toBe(true)
    expect(instance.fixture.requests.every(request => request.headers['x-api-key'] === fakeKey)).toBe(true)
    expect(runtime.ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toEqual(binding)

    await plugin.dispose()
    await expectQuiescent(runtime.handles)
  }, 120_000)

  it('resumes the Session on a fresh CLI process after the plugin is remounted', async () => {
    const instance = await realInstance({ kind: 'complete', text: 'Fixture answer' })
    const runtime = await realRuntime(instance)
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('claude-real-restart'), { provider: 'claude-code', model: 'fixture-model' }, { cwd: instance.workspace })
    const first = await turn(agent, 'Remember the word albatross')
    expect(turnEnd(first)).toEqual({ kind: 'completed' })
    await plugin.dispose()
    await expectQuiescent(runtime.handles)
    const spawnsBefore = runtime.spawnSpecs.length

    const remounted = await runtime.mount()
    const second = await turn(agent, 'Which word?')
    expect(turnEnd(second)).toEqual({ kind: 'completed' })
    expect(runtime.spawnSpecs.length).toBeGreaterThan(spawnsBefore)
    const history = messageTexts(instance.fixture.requests.at(-1)!.body)
    expect(history.some(text => text.includes('albatross'))).toBe(true)
    await remounted.dispose()
    await expectQuiescent(runtime.handles)
  }, 120_000)

  it('bridges a Claude Code tool permission to the harness answerer and audits the decision', async () => {
    const command = process.platform === 'win32'
      ? 'cmd /c type nul > approval-side-effect'
      : 'touch approval-side-effect'
    const instance = await realInstance({
      kind: 'tool-use',
      toolName: 'Bash',
      input: { command, description: 'exercise the approval bridge' },
      finalText: 'Declined, moving on',
    })
    const runtime = await realRuntime(instance, 'rejected')
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('claude-real-approval'), { provider: 'claude-code', model: 'fixture-model' }, { cwd: instance.workspace })

    const events = await turn(agent, 'Attempt the fixture command.')
    expect(assistantBlocks(events, 'text')).toBe('Declined, moving on')
    expect(turnEnd(events)).toEqual({ kind: 'completed' })
    expect(existsSync(join(instance.workspace, 'approval-side-effect'))).toBe(false)
    expect(runtime.approvals).toEqual([{ toolName: 'claude-code:Bash', reason: 'exercise the approval bridge' }])
    const asked = events.find(event => event.type === 'approval/asked')
    const decided = events.find(event => event.type === 'approval/decided')
    expect(asked?.type === 'approval/asked' ? asked.data.toolName : undefined).toBe('claude-code:Bash')
    expect(decided?.type === 'approval/decided' ? decided.data.outcome : undefined).toBe('rejected')
    expect(assistantBlocks(events, 'reasoning')).toContain('`touch approval-side-effect`')
    await plugin.dispose()
    await expectQuiescent(runtime.handles)
  }, 120_000)

  it('cancels the query when the dsh turn is cancelled', async () => {
    const instance = await realInstance({ kind: 'hold' })
    const runtime = await realRuntime(instance)
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('claude-real-cancel'), { provider: 'claude-code', model: 'fixture-model' }, { cwd: instance.workspace })
    const before = agent.session.seq
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Take your time.' }], source: { kind: 'user' } }))
    await instance.fixture.requestStarted
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    const events = agent.session.snapshotEvents().slice(before)
    expect(turnEnd(events).kind).toBe('aborted')
    await plugin.dispose()
    await expectQuiescent(runtime.handles)
  }, 120_000)
})
