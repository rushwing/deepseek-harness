/**
 * Keyless real-product coverage: the pinned `@openai/codex` app-server runs
 * behind the subprocess seam against a loopback Responses fixture, driven
 * through the real agent loop, so thread persistence, resume after a plugin
 * restart, the approval bridge, and cancellation are proven against the
 * product rather than a scripted transport.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, type AgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as LlmCodex from '@deepseek-ai/dsh-experimental-llm-codex'
import { cleanupRealProduct } from '../../../subagent/subagent-codex/tests/real-product-cleanup.ts'
import {
  startResponsesFixture,
  type ResponsesBehavior,
  type ResponsesFixture,
} from '../../../subagent/subagent-codex/tests/responses-fixture.ts'

const runtimePackageJson = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-codex-app-server/package.json'))
const codexBinDir = join(dirname(runtimePackageJson), 'node_modules', '.bin')

const roots: string[] = []
const fixtures: ResponsesFixture[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupRealProduct({ contexts, fixtures, roots })
})

interface RealInstance {
  readonly fixture: ResponsesFixture
  readonly env: Record<string, string>
  readonly workspace: string
}

async function realInstance(script: readonly ResponsesBehavior[]): Promise<RealInstance> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-llm-codex-real-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const codexHome = join(root, 'codex-home')
  mkdirSync(workspace)
  mkdirSync(codexHome)
  const fixture = await startResponsesFixture(script)
  fixtures.push(fixture)
  writeFileSync(join(codexHome, 'config.toml'), [
    'model = "fixture-model"',
    'model_provider = "fixture"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    'disable_response_storage = true',
    'check_for_update_on_startup = false',
    '',
    '[model_providers.fixture]',
    'name = "Fixture Responses"',
    `base_url = "${fixture.baseUrl}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
    '[analytics]',
    'enabled = false',
    '',
  ].join('\n'))
  const env = {
    OPENAI_API_KEY: 'dsh-fake-openai-key',
    CODEX_HOME: codexHome,
    HOME: root,
    XDG_CONFIG_HOME: join(root, 'xdg'),
    PATH: `${codexBinDir}${delimiter}${process.env.PATH ?? ''}`,
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
  /** Mount the backend plugin; returns the fiber so a test can dispose and remount it. */
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
    const fiber = await ctx.plugin(LlmCodex, {
      routes: { codex: {} },
      env: instance.env,
      disposeGraceMs: 2_000,
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

function responseInputTexts(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.input)) return []
  return body.input.flatMap((item): string[] => {
    if (item === null || typeof item !== 'object') return []
    const content = (item as Record<string, unknown>).content
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

describe('real @openai/codex 0.153.4 conversation backend', () => {
  it('runs two loop turns on one persistent thread whose history Codex owns', async () => {
    const instance = await realInstance([
      { kind: 'complete', text: 'Answer one' },
      { kind: 'complete', text: 'Answer two' },
    ])
    const runtime = await realRuntime(instance)
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('codex-real-two-turns'), { provider: 'codex', model: 'fixture-model' }, { cwd: instance.workspace })

    const first = await turn(agent, 'First question')
    expect(assistantBlocks(first, 'text')).toBe('Answer one')
    expect(turnEnd(first)).toEqual({ kind: 'completed' })
    const binding = runtime.ctx.sessionProjections.stateOf(agent.session, 'codexThread')
    expect(binding).toMatchObject({ cwd: instance.workspace, model: 'fixture-model' })
    expect(typeof binding?.conversationId).toBe('string')

    const second = await turn(agent, 'Second question')
    expect(assistantBlocks(second, 'text')).toBe('Answer two')
    expect(instance.fixture.requests).toHaveLength(2)
    const history = responseInputTexts(instance.fixture.requests[1]!.body)
    expect(history.some(text => text.includes('First question'))).toBe(true)
    expect(history.some(text => text.includes('Answer one'))).toBe(true)
    expect(history.some(text => text.includes('Second question'))).toBe(true)
    expect(instance.fixture.requests.every(request => request.headers.authorization === 'Bearer dsh-fake-openai-key')).toBe(true)
    expect(runtime.spawnSpecs).toHaveLength(1)
    expect(runtime.ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toEqual(binding)

    await plugin.dispose()
    await expectQuiescent(runtime.handles)
  }, 90_000)

  it('resumes the Session thread on a fresh app-server after the plugin is remounted', async () => {
    const instance = await realInstance([
      { kind: 'complete', text: 'Before restart' },
      { kind: 'complete', text: 'After restart' },
    ])
    const runtime = await realRuntime(instance)
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('codex-real-restart'), { provider: 'codex', model: 'fixture-model' }, { cwd: instance.workspace })
    const first = await turn(agent, 'Remember the word pelican')
    expect(assistantBlocks(first, 'text')).toBe('Before restart')
    await plugin.dispose()
    await expectQuiescent(runtime.handles)

    const remounted = await runtime.mount()
    const second = await turn(agent, 'Which word?')
    expect(assistantBlocks(second, 'text')).toBe('After restart')
    expect(turnEnd(second)).toEqual({ kind: 'completed' })
    expect(runtime.spawnSpecs).toHaveLength(2)
    const history = responseInputTexts(instance.fixture.requests[1]!.body)
    expect(history.some(text => text.includes('pelican'))).toBe(true)
    expect(history.some(text => text.includes('Before restart'))).toBe(true)
    await remounted.dispose()
    await expectQuiescent(runtime.handles)
  }, 90_000)

  it('bridges a Codex command approval to the harness answerer and audits the decision', async () => {
    const command = process.platform === 'win32'
      ? 'cmd /c type nul > approval-side-effect'
      : 'touch approval-side-effect'
    const instance = await realInstance([
      {
        kind: 'advertisedFunctionCall',
        choices: [
          { name: 'exec_command', arguments: { cmd: command, sandbox_permissions: 'require_escalated', justification: 'exercise the approval bridge' } },
          { name: 'shell_command', arguments: { command, sandbox_permissions: 'require_escalated', justification: 'exercise the approval bridge' } },
        ],
      },
      { kind: 'complete', text: 'Declined, moving on' },
    ])
    const runtime = await realRuntime(instance, 'rejected')
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('codex-real-approval'), { provider: 'codex', model: 'fixture-model' }, { cwd: instance.workspace })

    const events = await turn(agent, 'Attempt the fixture command.')
    expect(assistantBlocks(events, 'text')).toBe('Declined, moving on')
    expect(turnEnd(events)).toEqual({ kind: 'completed' })
    expect(existsSync(join(instance.workspace, 'approval-side-effect'))).toBe(false)
    expect(runtime.approvals).toHaveLength(1)
    expect(runtime.approvals[0]).toMatchObject({ toolName: 'codex:command' })
    expect(runtime.approvals[0]?.reason).toContain('approval-side-effect')
    const asked = events.find(event => event.type === 'approval/asked')
    const decided = events.find(event => event.type === 'approval/decided')
    expect(asked?.type === 'approval/asked' ? asked.data.toolName : undefined).toBe('codex:command')
    expect(decided?.type === 'approval/decided' ? decided.data.outcome : undefined).toBe('rejected')
    expect(assistantBlocks(events, 'reasoning')).toContain('declined command')
    expect(instance.fixture.requests).toHaveLength(2)
    await plugin.dispose()
    await expectQuiescent(runtime.handles)
  }, 90_000)

  it('interrupts the Codex turn when the dsh turn is cancelled', async () => {
    const instance = await realInstance([{ kind: 'hold' }])
    const runtime = await realRuntime(instance)
    const plugin = await runtime.mount()
    const agent = await runtime.harness.create(SessionId('codex-real-cancel'), { provider: 'codex', model: 'fixture-model' }, { cwd: instance.workspace })
    const before = agent.session.seq
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Take your time.' }], source: { kind: 'user' } }))
    await instance.fixture.requestStarted
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    const events = agent.session.snapshotEvents().slice(before)
    expect(turnEnd(events).kind).toBe('aborted')
    await plugin.dispose()
    await expectQuiescent(runtime.handles)
  }, 90_000)
})
