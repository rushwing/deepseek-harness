/**
 * Credentialed end-to-end coverage: one loop turn through the production Codex
 * backend and the real app-server, with a loopback bridge translating Codex's
 * Responses request into a DeepSeek chat completion. Self-skips without
 * `DEEPSEEK_API_KEY`.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as LlmCodex from '@deepseek-ai/dsh-experimental-llm-codex'
import {
  startDeepSeekResponsesBridge,
  type DeepSeekResponsesBridge,
} from '../../../subagent/subagent-codex/tests/deepseek-responses-bridge.ts'

const roots: string[] = []
const contexts: Context[] = []
const bridges: DeepSeekResponsesBridge[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(bridges.splice(0).map(bridge => bridge.close()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('Codex conversation backend with the real DeepSeek API', () => {
  it('answers one loop turn with the exact nonce through the real app-server', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (apiKey === undefined) throw new Error('e2e ran without DEEPSEEK_API_KEY')
    const root = mkdtempSync(join(tmpdir(), 'dsh-llm-codex-deepseek-e2e-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const codexHome = join(root, 'codex-home')
    mkdirSync(workspace)
    mkdirSync(codexHome)
    const nonce = `DSH_LLM_CODEX_DEEPSEEK_${randomUUID()}`
    const bridge = await startDeepSeekResponsesBridge(nonce)
    bridges.push(bridge)
    writeFileSync(join(codexHome, 'config.toml'), [
      'model = "deepseek-v4-flash"',
      'model_provider = "deepseek-e2e"',
      'approval_policy = "on-request"',
      'sandbox_mode = "workspace-write"',
      'disable_response_storage = true',
      'check_for_update_on_startup = false',
      '',
      '[model_providers.deepseek-e2e]',
      'name = "DeepSeek E2E bridge"',
      `base_url = "${bridge.baseUrl}"`,
      'env_key = "DEEPSEEK_API_KEY"',
      'wire_api = "responses"',
      'requires_openai_auth = false',
      '',
      '[analytics]',
      'enabled = false',
      '',
    ].join('\n'))
    const env = {
      DEEPSEEK_API_KEY: apiKey,
      CODEX_HOME: codexHome,
      HOME: root,
      XDG_CONFIG_HOME: join(root, 'xdg-config'),
      PATH: root,
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: '127.0.0.1,localhost',
    }

    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    const harness = await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(ApprovalService, { policy: 'never' })
    await ctx.plugin(UserQuestionService)
    const handles: SubprocessHandle[] = []
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = spawn(spec)
      handles.push(handle)
      return handle
    })
    await ctx.plugin(LlmCodex, { routes: { codex: {} }, env, disposeGraceMs: 2_000 })

    const agent = await harness.create(SessionId('codex-deepseek-e2e'), { provider: 'codex', model: 'deepseek-v4-flash' }, { cwd: workspace })
    const before = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: `Reply with exactly ${nonce} and nothing else. Do not use tools.` }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    const events = agent.session.snapshotEvents().slice(before)
    const text = events.flatMap(event => (event.type === 'assistant/message' ? event.data.message.content : []))
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()
    expect(text).toBe(nonce)
    expect(events.findLast(event => event.type === 'turn/end')?.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toMatchObject({ cwd: workspace, model: 'deepseek-v4-flash' })
    expect(bridge.completedRequests).toBe(1)
    await ctx.fiber.dispose()
    expect(handles.length).toBeGreaterThan(0)
    for (const handle of handles) await expect(handle.waitForExit()).resolves.toBe(true)
  }, 180_000)
})
