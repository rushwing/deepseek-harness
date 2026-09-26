import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as module from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import LifecycleService from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { REQ_010, agentAt, cleanup, emptyDirectory, setField, setup, withoutProviderSets, workspace, writeText } from './workspace-helper.ts'

const signal = new AbortController().signal
let calls = 0

afterEach(cleanup)

function call(ctx: Context, name: string, args: unknown, agent: Agent) {
  return ctx.tools.execute({ signal, callId: ToolCallId(`lifecycle-${++calls}`), name, arguments: args, agent })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('the lifecycle tools', () => {
  it('registers the three read-only tools with their parameters', async () => {
    const ctx = await setup()
    const schemas = ctx.tools.schemas()
    const parameters = (name: string): string[] => {
      const schema = schemas.find(entry => entry.name === name)
      if (schema === undefined) throw new Error(`no tool ${name}`)
      return Object.keys((schema.parameters as { properties?: Record<string, unknown> }).properties ?? {})
    }
    expect(parameters('lifecycle_status')).toEqual(['reqId'])
    expect(parameters('lifecycle_check_in')).toEqual(['reqId', 'uid', 'state', 'transition'])
    expect(parameters('lifecycle_lint')).toEqual(['reqId'])
    expect(parameters('lifecycle_transition')).toEqual(['reqId', 'transition', 'event', 'summary', 'decisions', 'pr'])
    expect(parameters('lifecycle_run')).toEqual(['reqId', 'maxSteps'])
  })

  it('reports a REQ, checks a role in, and lints with a logged lifecycle/lint event', async () => {
    const ctx = await setup()
    const root = await workspace()
    const agent = agentAt(ctx, root)
    const status = await call(ctx, 'lifecycle_status', { reqId: 'REQ-PLAT-010' }, agent)
    expect(status.isError).toBe(false)
    if (status.isError) throw new Error('status failed')
    expect(status.value).toMatchObject({ activeSet: 'mixed', reqs: [{ id: 'REQ-PLAT-010', status: 'draft', owner: 'human-001', seat: 'human-001' }] })
    expect(text(status)).toContain('REQ-PLAT-010: draft, owner human-001 (human), seat human-001; legal transitions T01, T19')
    const everything = await call(ctx, 'lifecycle_status', {}, agent)
    if (everything.isError) throw new Error('status failed')
    expect(text(everything)).toContain('4 REQs; active set mixed')

    const checkIn = await call(ctx, 'lifecycle_check_in', { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'draft' }, agent)
    if (checkIn.isError) throw new Error('check-in failed')
    expect(checkIn.value).toMatchObject({ ok: true, exempt: false })
    expect(text(checkIn)).toBe('Check-in ok: human-001 owns REQ-PLAT-010 in draft.')
    const refused = await call(ctx, 'lifecycle_check_in', { reqId: 'REQ-PLAT-010', uid: 'planner-001', state: 'draft' }, agent)
    if (refused.isError) throw new Error('check-in failed')
    expect(text(refused)).toBe(
      "Check-in refused for planner-001 on REQ-PLAT-010: the owner is human-001; draft is outside planner-001's states [req_review].",
    )
    const recall = await call(ctx, 'lifecycle_check_in', { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'req_review', transition: 'T19' }, agent)
    if (recall.isError) throw new Error('check-in failed')
    expect(text(recall)).toBe('Check-in ok: T19 is exempt from the hard-stop checks for human-001 on REQ-PLAT-010.')
    const wrongState = await call(ctx, 'lifecycle_check_in', { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'req_review' }, agent)
    if (wrongState.isError) throw new Error('check-in failed')
    expect(text(wrongState)).toBe('Check-in refused for human-001 on REQ-PLAT-010: REQ-PLAT-010 is in draft, not req_review.')
    const missing = await call(ctx, 'lifecycle_check_in', { reqId: 'REQ-PLAT-404', uid: 'human-001', state: 'draft' }, agent)
    if (missing.isError) throw new Error('check-in failed')
    expect(text(missing)).toBe('Check-in refused for human-001 on REQ-PLAT-404: REQ-PLAT-404 does not exist.')

    const clean = await call(ctx, 'lifecycle_lint', {}, agent)
    if (clean.isError) throw new Error('lint failed')
    expect(clean.value).toEqual({ violations: [], counts: {} })
    expect(text(clean)).toBe('Lint clean: 0 violations across the tasks tree.')
    await setField(root, REQ_010, 'owner', 'ghost-001')
    const dirty = await call(ctx, 'lifecycle_lint', { reqId: 'REQ-PLAT-010' }, agent)
    if (dirty.isError) throw new Error('lint failed')
    expect(text(dirty)).toMatch(/^Lint: \d+ violations for REQ-PLAT-010 \(req-fields \d+, req-frontmatter \d+\)\n- lifecycle\/tasks/)
    expect(text(dirty)).toContain("REQ-PLAT-010.md [req-fields]: owner 'ghost-001' is not")
    const logged = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/lint').map(event => event.data)
    expect(logged).toEqual([
      { version: 1, scope: 'all', violationCount: 0, ruleCounts: {} },
      { version: 1, scope: 'REQ-PLAT-010', violationCount: 2, ruleCounts: { 'req-fields': 1, 'req-frontmatter': 1 } },
    ])
  })

  it('presents calls as generic cards', async () => {
    const ctx = await setup()
    const view = (name: string, args: unknown) => ctx.tools.get(name)?.presentCall?.(args)
    expect(view('lifecycle_status', { reqId: 'REQ-PLAT-010' })).toEqual({ card: 'generic', title: 'Lifecycle status of REQ-PLAT-010', kind: 'other' })
    expect(view('lifecycle_status', {})).toEqual({ card: 'generic', title: 'Lifecycle status of every REQ', kind: 'other' })
    expect(view('lifecycle_check_in', { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'draft' })).toEqual({ card: 'generic', title: 'Check in human-001 on REQ-PLAT-010', kind: 'other', rawInput: { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'draft' } })
    expect(view('lifecycle_lint', {})).toEqual({ card: 'generic', title: 'Lint the lifecycle artifacts', kind: 'other' })
    expect(view('lifecycle_lint', { reqId: 'REQ-PLAT-010' })).toEqual({ card: 'generic', title: 'Lint REQ-PLAT-010', kind: 'other' })
  })

  it('fails closed without a Session working directory, with invalid tables, and for an unknown REQ', async () => {
    const ctx = await setup()
    const detached = await call(ctx, 'lifecycle_status', {}, agentAt(ctx, undefined, 'detached'))
    expect(detached.isError).toBe(true)
    if (!detached.isError) throw new Error('expected failure')
    expect(detached.error).toMatchObject({ info: { code: 'NO_WORKSPACE', name: 'LifecycleError' } })
    expect(text(detached)).toContain('lifecycle_status needs a Session with a working directory')
    const root = await workspace()
    await writeText(root, 'lifecycle/artifact-contract.yml', 'version: 9\n')
    const invalid = await call(ctx, 'lifecycle_lint', {}, agentAt(ctx, root, 'invalid'))
    if (!invalid.isError) throw new Error('expected failure')
    expect(invalid.error).toMatchObject({ info: { code: 'TABLES_INVALID' } })
    expect(text(invalid)).toContain('lifecycle/artifact-contract.yml: version')
    const bare = await emptyDirectory()
    const missing = await call(ctx, 'lifecycle_status', {}, agentAt(ctx, bare, 'bare'))
    if (!missing.isError) throw new Error('expected failure')
    expect(text(missing)).toContain('lifecycle/lifecycle.yml: missing')
    const unknown = await call(ctx, 'lifecycle_status', { reqId: 'REQ-PLAT-404' }, agentAt(ctx, await workspace(), 'unknown'))
    if (!unknown.isError) throw new Error('expected failure')
    expect(unknown.error).toMatchObject({ info: { code: 'UNKNOWN_REQ' } })
    const agentless = await ctx.tools.execute({ signal, callId: ToolCallId('lifecycle-agentless'), name: 'lifecycle_lint', arguments: {} })
    if (!agentless.isError) throw new Error('expected failure')
    expect(agentless.error).toMatchObject({ info: { code: 'NO_WORKSPACE' } })
  })
})

describe('the lifecycle:policy section', () => {
  it('speaks only for Sessions whose working directory carries the lifecycle tables', async () => {
    const ctx = await setup()
    const root = await workspace()
    const inside = agentAt(ctx, root, 'inside')
    const section = (await ctx.systemPrompt.assemble({ agent: inside, scope: inside })).sections.find(entry => entry.name === 'lifecycle:policy')
    expect(section?.text).toContain('lifecycle_status')
    expect(section?.text).toContain('`lifecycle/tasks/`')
    const policyText = async (agent?: Agent): Promise<string | undefined> => {
      const assembly = agent === undefined ? await ctx.systemPrompt.assemble() : await ctx.systemPrompt.assemble({ agent, scope: agent })
      return assembly.sections.find(entry => entry.name === 'lifecycle:policy')?.text
    }
    expect(await policyText(agentAt(ctx, await emptyDirectory(), 'outside'))).toBe('')
    expect(await policyText(agentAt(ctx, undefined, 'detached'))).toBe('')
    expect(await policyText()).toBe('')
  })
})

describe('the /lifecycle command', () => {
  it('registers only when a command registry is composed and answers status and lint requests', async () => {
    const bare = await setup()
    expect(bare.get('commands')).toBeUndefined()
    const ctx = await setup()
    await ctx.plugin(CommandRuntime)
    await new Promise(resolve => setImmediate(resolve))
    const root = await workspace()
    const agent = agentAt(ctx, root, 'commander')
    expect(ctx.commands.list(agent)).toEqual([{
      definitionId: '@deepseek-ai/dsh-experimental-lifecycle-orchestrator',
      name: 'lifecycle',
      description: 'Show lifecycle status or lint the lifecycle artifacts',
      input: { hint: 'status [REQ-ID] | lint [REQ-ID]' },
    }])
    const run = async (line: string) => (await ctx.commands.execute(agent, line, [], signal))?.result
    expect(await run('/lifecycle status REQ-PLAT-010')).toEqual({ kind: 'success', text: 'REQ-PLAT-010: draft, owner human-001 (human), seat human-001; legal transitions T01, T19' })
    expect(await run('/lifecycle status')).toMatchObject({ kind: 'success' })
    expect(await run('/lifecycle lint')).toEqual({ kind: 'success', text: 'Lint clean: 0 violations across the tasks tree.' })
    expect(await run('/lifecycle lint REQ-PLAT-010')).toEqual({ kind: 'success', text: 'Lint clean: 0 violations for REQ-PLAT-010.' })
    expect(await run('/lifecycle')).toEqual({ kind: 'error', text: 'Usage: /lifecycle status [REQ-ID] | lint [REQ-ID]' })
    expect(await run('/lifecycle dance')).toEqual({ kind: 'error', text: 'Usage: /lifecycle status [REQ-ID] | lint [REQ-ID]' })
    await setField(root, REQ_010, 'owner', 'ghost-001')
    expect(await run('/lifecycle status REQ-PLAT-010')).toEqual({ kind: 'success', text: 'REQ-PLAT-010: draft, owner ghost-001 (unregistered), seat none; no legal transitions' })
    await withoutProviderSets(root)
    expect((await run('/lifecycle status'))?.text).toMatch(/^4 REQs; active set none\n/)
    expect(await run('/lifecycle status REQ-PLAT-404')).toEqual({ kind: 'error', text: 'REQ-PLAT-404 is not a REQ under lifecycle/tasks/' })
    const detached = agentAt(ctx, undefined, 'detached-commander')
    expect((await ctx.commands.execute(detached, '/lifecycle status', [], signal))?.result).toEqual({ kind: 'error', text: '/lifecycle needs a Session with a working directory' })
    await rm(join(root, 'lifecycle', 'lifecycle.yml'))
    await mkdir(join(root, 'lifecycle', 'lifecycle.yml'))
    await expect(ctx.commands.execute(agent, '/lifecycle lint', [], signal)).rejects.toThrow(/EISDIR/)
  })
})

describe('plugin lifetime and export shape', () => {
  it('removes the tools, the section, and the service when the plugin is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime, {})
    const fiber = await ctx.plugin(LifecycleService, { lifecycleDir: 'lifecycle' })
    const root = await workspace()
    const agent = agentAt(ctx, root, 'lifetime')
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('lifecycle_lint')
    expect((await ctx.systemPrompt.assemble({ agent, scope: agent })).sections.map(entry => entry.name)).toContain('lifecycle:policy')
    await fiber.dispose()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('lifecycle_lint')
    expect((await ctx.systemPrompt.assemble({ agent, scope: agent })).sections.map(entry => entry.name)).not.toContain('lifecycle:policy')
    expect(ctx.get('lifecycle')).toBeUndefined()
  })

  it('default-exports the service class with its injections and a schemastery Config', () => {
    expect(module.default).toBe(LifecycleService)
    expect(LifecycleService.inject).toEqual(['tools', 'systemPrompt', 'subagents'])
    expect(Loader.prototype.unwrapExports(module)).toBe(LifecycleService)
    expect(LifecycleService.Config()).toEqual({
      lifecycleDir: 'lifecycle',
      maxStepsPerRun: 8,
      delegationToolNames: ['subagent', 'subagent_fork', 'workflow', 'ralph', 'spawn_teammate', 'send_message', 'interrupt_agent'],
      humanDecisions: 'ask',
      stepTimeoutMs: 1_800_000,
      proposalChannel: 'auto',
      subagentProvider: 'spawn',
    })
    expect(() => new LifecycleService(new Context(), { ...LifecycleService.Config(), subagentProvider: ' ' })).toThrow('subagentProvider must name')
    expect(() => new LifecycleService(new Context(), { ...LifecycleService.Config(), delegationToolNames: ['subagent', ''] })).toThrow('blank name')
    expect(() => new LifecycleService(new Context(), { ...LifecycleService.Config(), lifecycleDir: ' ' })).toThrow('lifecycleDir must name a directory')
  })
})
