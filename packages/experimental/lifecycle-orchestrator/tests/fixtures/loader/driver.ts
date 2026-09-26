#!/usr/bin/env node
/** Scaffold and lint a lifecycle directory through the headless profile's real tools, then dispose the plugin. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('lifecycle-orchestrator Loader composition driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'lifecycle-orchestrator-loader-composition',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})

const cwd = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-loader-'))
const signal = new AbortController().signal
const names = (): string[] => ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('lifecycle_')).sort()
try {
  const handle = await ctx.agents.create({ sessionId: SessionId('lifecycle-loader-agent'), meta: { cwd } })
  const { agent } = handle
  const call = (name: string, args: unknown) => ctx.tools.execute({ signal, callId: ToolCallId(`loader-${name}`), name, arguments: args, agent })
  const init = await call('lifecycle_init', { scaffold: 'full' })
  const lint = await call('lifecycle_lint', {})
  const status = await call('lifecycle_status', {})
  const section = (await ctx.systemPrompt.assemble({ agent, scope: agent })).sections.find(entry => entry.name === 'lifecycle:policy')
  const commands = ctx.commands.list(agent).map(command => command.name).filter(name => name === 'lifecycle')
  const before = { tools: names(), section: section === undefined ? 'absent' : section.text === '' ? 'empty' : 'present', commands, service: ctx.get('lifecycle') === undefined ? 'absent' : 'present' }
  const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'lifecycle-orchestrator')
  if (entry?.fiber === undefined) throw new Error('the Loader did not mount lifecycle-orchestrator')
  await entry.fiber.dispose()
  const after = { tools: names(), commands: ctx.commands.list(agent).map(command => command.name).filter(name => name === 'lifecycle'), service: ctx.get('lifecycle') === undefined ? 'absent' : 'present' }
  process.stdout.write(`${JSON.stringify({
    init: init.isError ? { error: init.error.message } : init.value,
    lint: lint.isError ? { error: lint.error.message } : lint.value,
    status: status.isError ? { error: status.error.message } : status.value,
    lintEvents: agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/lint').map(event => event.data),
    before,
    after,
  })}\n`)
  await handle.dispose()
} finally {
  await rm(cwd, { recursive: true, force: true })
  await ctx.fiber.dispose()
}
