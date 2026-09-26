/**
 * Credentialed end-to-end coverage: one loop turn through the production
 * Claude Code backend and the real SDK-spawned CLI, pointed at DeepSeek's
 * Anthropic-compatible Messages endpoint. Self-skips without
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
import * as LlmClaudeCode from '@deepseek-ai/dsh-experimental-llm-claude-code'

const OFFICIAL_DEEPSEEK_MESSAGES_BASE_URL = 'https://api.deepseek.com/anthropic'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('Claude Code conversation backend with the real DeepSeek API', () => {
  it('answers one loop turn with the exact nonce through the real SDK-spawned CLI', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (apiKey === undefined) throw new Error('e2e ran without DEEPSEEK_API_KEY')
    const root = mkdtempSync(join(tmpdir(), 'dsh-llm-claude-code-deepseek-e2e-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const claudeConfig = join(root, 'claude-config')
    mkdirSync(workspace)
    mkdirSync(claudeConfig)
    writeFileSync(join(claudeConfig, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } }, null, 2)}\n`)
    const env = {
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: OFFICIAL_DEEPSEEK_MESSAGES_BASE_URL,
      ANTHROPIC_MODEL: DEEPSEEK_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: DEEPSEEK_MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: DEEPSEEK_MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: DEEPSEEK_MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL: DEEPSEEK_MODEL,
      CLAUDE_CONFIG_DIR: claudeConfig,
      HOME: root,
      XDG_CONFIG_HOME: join(root, 'xdg-config'),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
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
    await ctx.plugin(LlmClaudeCode, { routes: { 'claude-code': {} }, env, disposeGraceMs: 3_000 })

    const nonce = `DSH_LLM_CLAUDE_DEEPSEEK_${randomUUID()}`
    const agent = await harness.create(SessionId('claude-deepseek-e2e'), { provider: 'claude-code', model: DEEPSEEK_MODEL }, { cwd: workspace })
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
    expect(ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toMatchObject({ cwd: workspace, model: DEEPSEEK_MODEL })
    await ctx.fiber.dispose()
    expect(handles.length).toBeGreaterThan(0)
    for (const handle of handles) await expect(handle.waitForExit()).resolves.toBe(true)
  }, 180_000)
})
