import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { deniedTools } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { REQ_010, agentAt, cleanup, setField } from './workspace-helper.ts'
import { RV_010, TC_010_01, frontmatterOf, happyPathChildren, setupDriver } from './driver-helper.ts'

const ARCHIVED_010 = 'lifecycle/tasks/archive/done/REQ-PLAT-010.md'
const signal = new AbortController().signal
let calls = 0

afterEach(cleanup)

function run(ctx: Context, args: unknown, agent: Agent) {
  return ctx.tools.execute({ signal, callId: ToolCallId(`run-${++calls}`), name: 'lifecycle_run', arguments: args, agent })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('lifecycle_run drives a REQ through fresh role children', () => {
  it('carries REQ-PLAT-010 from draft to done with two human decisions and eight role steps', async () => {
    const { ctx, root, agent, provider, asked } = await setupDriver(happyPathChildren(), { answers: ['T01', 'T14'] })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.stopped).toBe('done')
    expect(result.violations).toEqual([])
    expect(result.pendingHuman).toBeNull()
    expect(result.steps.map(step => `${step.uid}@${step.state}:${String(step.transition)}:${step.outcome}`)).toEqual([
      'human-001@draft:T01:applied',
      'planner-001@req_review:T02:applied',
      'evaluator-002@req_review:T03:applied',
      'evaluator-002@tc_design:T05:applied',
      'generator-001@tc_review:T06:applied',
      'generator-001@tc_impl:T08:applied',
      'evaluator-001@tc_impl_review:T09:applied',
      'generator-001@req_impl:T11:applied',
      'evaluator-002@req_impl_review:T13:applied',
      'human-001@pr_draft:T14:applied',
    ])
    expect(asked.map(question => question.options)).toEqual([['T01', 'T19', 'Stop'], ['T14', 'T15', 'T19', 'Stop']])
    expect(asked[0]?.question).toContain('REQ-PLAT-010')

    expect(existsSync(join(root, ...REQ_010.split('/')))).toBe(false)
    const req = await frontmatterOf(root, ARCHIVED_010)
    expect(req).toMatchObject({ status: 'done', owner: 'human-001', review_round: '1', pr_number: '26', test_case_ref: '[ TC-PLAT-010-01 ]' })
    expect(await frontmatterOf(root, TC_010_01)).toMatchObject({ status: 'passing' })
    expect(await readFile(join(root, RV_010), 'utf8')).toContain('## req_impl_review')
    expect(ctx.lifecycle.lint(root).violations).toEqual([])

    const [planner, , , , tcImpl] = provider.requests
    expect(planner?.label).toBe('lifecycle:planner-001@req_review:REQ-PLAT-010')
    expect(planner?.agentOptions).toEqual({ provider: 'claude-code', model: 'opus', reasoningEffort: 'xhigh' })
    expect(planner?.toolFilter?.deny).toEqual(['lifecycle_run', 'lifecycle_transition', 'lifecycle_init'])
    expect(planner?.maxDepth).toBe(1)
    expect(planner?.outputSchema).toMatchObject({ type: 'object' })
    expect(planner?.prompt.map(block => (block.type === 'text' ? block.text : '')).join('')).toContain('# Brief: planner @ req_review — REQ-PLAT-010')
    expect(tcImpl?.agentOptions).toEqual({ provider: 'claude-code', model: 'opus', reasoningEffort: 'high' })
    expect(provider.disposed).toHaveLength(8)

    const events = agent.session.snapshotEvents()
    const steps = events.filter(event => event.type === 'lifecycle/step').map(event => event.data)
    expect(steps).toHaveLength(16)
    expect(steps[0]).toEqual({
      version: 1, reqId: 'REQ-PLAT-010', uid: 'planner-001', role: 'planner', state: 'req_review', provider: 'fake-roles',
      route: { provider: 'claude-code', model: 'opus' }, effort: 'xhigh', childSessionId: null, phase: 'started', reason: null,
    })
    expect(steps[1]).toMatchObject({ uid: 'planner-001', phase: 'completed', childSessionId: 'lifecycle-child-1' })
    expect(events.filter(event => event.type === 'lifecycle/transition').map(event => (event.data as { id: string }).id))
      .toEqual(['T01', 'T02', 'T03', 'T05', 'T06', 'T08', 'T09', 'T11', 'T13', 'T14'])
    expect(events.filter(event => event.type === 'lifecycle/human-decision').map(event => event.data)).toEqual([
      { version: 1, reqId: 'REQ-PLAT-010', state: 'draft', options: ['T01', 'T19'], phase: 'requested', answer: null },
      { version: 1, reqId: 'REQ-PLAT-010', state: 'draft', options: ['T01', 'T19'], phase: 'answered', answer: 'T01' },
      { version: 1, reqId: 'REQ-PLAT-010', state: 'pr_draft', options: ['T14', 'T15', 'T19'], phase: 'requested', answer: null },
      { version: 1, reqId: 'REQ-PLAT-010', state: 'pr_draft', options: ['T14', 'T15', 'T19'], phase: 'answered', answer: 'T14' },
    ])
  })

  it('denies the composed delegation tools and never names a tool the deployment lacks', async () => {
    const { ctx, agent, provider } = await setupDriver(happyPathChildren().slice(0, 1), { answers: ['T01'], config: { maxStepsPerRun: 2 } })
    ctx.tools.register(defineTool({
      name: 'subagent',
      description: 'A delegation tool stand-in.',
      parameters: { task: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
      execute: () => Promise.resolve({ ok: true }),
      presentCall: () => ({ card: 'generic', title: 'subagent', kind: 'other' }),
    }))
    expect(deniedTools({ ctx, config: ctx.lifecycle.config })).toEqual(['subagent', 'lifecycle_run', 'lifecycle_transition', 'lifecycle_init'])
    await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(provider.requests[0]?.toolFilter?.deny).toEqual(['subagent', 'lifecycle_run', 'lifecycle_transition', 'lifecycle_init'])
  })

  it('stops with needs-human when the human owns the REQ and no answerer is attached', async () => {
    const { ctx, root, agent } = await setupDriver([], { answers: 'none' })
    const before = await readFile(join(root, REQ_010), 'utf8')
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result).toEqual({
      reqId: 'REQ-PLAT-010', steps: [], stopped: 'needs-human', pendingHuman: { state: 'draft', options: ['T01', 'T19'] }, violations: [],
    })
    expect(await readFile(join(root, REQ_010), 'utf8')).toBe(before)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/human-decision').map(event => event.data)).toEqual([
      { version: 1, reqId: 'REQ-PLAT-010', state: 'draft', options: ['T01', 'T19'], phase: 'requested', answer: null },
      { version: 1, reqId: 'REQ-PLAT-010', state: 'draft', options: ['T01', 'T19'], phase: 'unavailable', answer: null },
    ])
  })

  it('treats an answerer that rejects with NO_PROVIDER, a Stop answer, and humanDecisions: stop as needs-human', async () => {
    const rejected = await setupDriver([], { answers: [] })
    expect((await rejected.ctx.lifecycle.run(rejected.agent, { reqId: 'REQ-PLAT-010' }, signal)).stopped).toBe('needs-human')
    expect(rejected.asked).toHaveLength(1)

    const stopped = await setupDriver([], { answers: ['Stop'] })
    const stop = await stopped.ctx.lifecycle.run(stopped.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(stop.stopped).toBe('needs-human')
    expect(stopped.agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/human-decision').map(event => (event.data as { phase: string; answer: string | null }).answer))
      .toEqual([null, 'Stop'])

    const never = await setupDriver([], { answers: ['T01'], config: { humanDecisions: 'stop' } })
    expect((await never.ctx.lifecycle.run(never.agent, { reqId: 'REQ-PLAT-010' }, signal)).stopped).toBe('needs-human')
    expect(never.asked).toHaveLength(0)
  })

  it('stops at once for a done or blocked REQ and after the step ceiling', async () => {
    const done = await setupDriver([], { answers: 'none' })
    expect(await done.ctx.lifecycle.run(done.agent, { reqId: 'REQ-PLAT-009' }, signal)).toMatchObject({ stopped: 'done', steps: [] })

    const blocked = await setupDriver([], {
      answers: 'none',
      prepare: async (root) => {
        await setField(root, REQ_010, 'status', 'blocked')
      },
    })
    expect(await blocked.ctx.lifecycle.run(blocked.agent, { reqId: 'REQ-PLAT-010' }, signal)).toMatchObject({ stopped: 'blocked', steps: [] })

    const capped = await setupDriver(happyPathChildren(), { answers: ['T01', 'T14'], config: { maxStepsPerRun: 2 } })
    const result = await capped.ctx.lifecycle.run(capped.agent, { reqId: 'REQ-PLAT-010', maxSteps: 5 }, signal)
    expect(result.stopped).toBe('max-steps')
    expect(result.steps.map(step => step.transition)).toEqual(['T01', 'T02'])
    const lowered = await setupDriver(happyPathChildren(), { answers: ['T01'] })
    expect((await lowered.ctx.lifecycle.run(lowered.agent, { reqId: 'REQ-PLAT-010', maxSteps: 1 }, signal)).steps).toHaveLength(1)
  })

  it('stops with lint-red before any step when the REQ family is red', async () => {
    const { ctx, agent } = await setupDriver([], {
      answers: ['T01'],
      prepare: async (root) => {
        await setField(root, REQ_010, 'priority', 'P9')
      },
    })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.stopped).toBe('lint-red')
    expect(result.steps).toEqual([])
    expect(result.violations.join('\n')).toContain('priority')
  })

  it('exposes the run through lifecycle_run for the root agent only', async () => {
    const { ctx, root, agent } = await setupDriver(happyPathChildren().slice(0, 1), { answers: ['T01'], config: { maxStepsPerRun: 2 } })
    const result = await run(ctx, { reqId: 'REQ-PLAT-010' }, agent)
    if (result.isError) throw new Error(result.error.message)
    expect(result.value).toMatchObject({ stopped: 'max-steps', reqId: 'REQ-PLAT-010' })
    expect(text(result)).toBe([
      'Lifecycle run on REQ-PLAT-010 stopped: max-steps after 2 steps',
      '- human-001 @ draft: T01 applied',
      '- planner-001 @ req_review: T02 applied',
    ].join('\n'))

    const child = agentAt(ctx, root, 'lifecycle-delegated', { origin: 'subagent', delegationDepth: 1 })
    const refused = await run(ctx, { reqId: 'REQ-PLAT-010' }, child)
    expect(refused.isError).toBe(true)
    if (!refused.isError) throw new Error('expected a refusal')
    expect(refused.error.info).toMatchObject({ code: 'DELEGATED_CALLER' })
    expect((await frontmatterOf(root, REQ_010)).status).toBe('req_review')
  })
})
