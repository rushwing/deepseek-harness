import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as retry from '@deepseek-ai/dsh-llm-retry'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as fallback from '@deepseek-ai/dsh-experimental-lifecycle-model-fallback'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { CLAUDE_EFFORTS, RetryingMockAdapter, cleanup, failWith, oneRetry, routesOf, workspace } from './harness.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await cleanup()
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-fallback-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))
  context = new Context()
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-llm-retry', retry],
    ['@deepseek-ai/dsh-experimental-lifecycle-model-fallback', fallback],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('hops a labeled role child to its fallback route through the shipping loop', { timeout: 60_000 }, async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-subagent'",
      "- name: '@deepseek-ai/dsh-llm-retry'",
      "- name: '@deepseek-ai/dsh-experimental-lifecycle-model-fallback'",
      '  config:',
      '    maxHops: 1',
      "- name: '@deepseek-ai/dsh-agent-loop'",
    ])
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const claude = new RetryingMockAdapter([failWith('SERVER'), failWith('SERVER'), textResponse('recovered')], oneRetry(), CLAUDE_EFFORTS)
    loaded.llm.registerAdapter(['claude-code'], claude)
    const cwd = await workspace()
    const agent = await loaded.agentLoop.create(
      SessionId('loader-child'),
      { provider: 'claude-code', model: 'opus', reasoningEffort: ReasoningEffortId('high') },
      { cwd },
    )
    agent.session.append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'spawn', label: 'lifecycle:generator-001@tc_impl:REQ-PLAT-009' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'implement' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(routesOf(claude)).toEqual(['claude-code/opus@high', 'claude-code/opus@high', 'claude-code/sonnet@high'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry')).toHaveLength(1)
    expect(agent.session.deriveMessages().at(-1)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'recovered' }] })
  })
})
