import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { LifecycleError, decisionsOf, renderTransition, transitionEvent } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { REQ_010, agentAt, cleanup, setField, setup, workspace } from './workspace-helper.ts'

const signal = new AbortController().signal
let calls = 0

afterEach(cleanup)

function call(ctx: Context, args: unknown, agent: Agent) {
  return ctx.tools.execute({ signal, callId: ToolCallId(`transition-${++calls}`), name: 'lifecycle_transition', arguments: args, agent })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('lifecycle transitions applied by hand', () => {
  it('applies T01 to a draft REQ, rewrites its frontmatter, and suggests the commit subject', async () => {
    const ctx = await setup()
    const root = await workspace()
    const result = await ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T01', summary: 'Start the review' })
    expect(result).toEqual({
      kind: 'transition',
      applied: true,
      reqId: 'REQ-PLAT-010',
      id: 'T01',
      from: 'draft',
      to: 'req_review',
      actorUid: 'human-001',
      ownerBefore: 'human-001',
      ownerAfter: 'planner-001',
      reviewRound: 0,
      files: [REQ_010],
      suggestedCommitSubject: 'lifecycle: T01 — Start the review',
      violations: [],
    })
    expect(await readFile(join(root, REQ_010), 'utf8')).toContain('status: req_review\nowner: planner-001\n')
  })

  it('rejects a transition whose guards do not hold and writes nothing', async () => {
    const ctx = await setup()
    const root = await workspace()
    const before = await readFile(join(root, REQ_010), 'utf8')
    const result = await ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T03', summary: 'Skip ahead' })
    expect(result).toMatchObject({ applied: false, id: 'T03', from: 'draft', to: 'tc_design', files: [] })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.join('\n')).toContain('req_review')
    expect(await readFile(join(root, REQ_010), 'utf8')).toBe(before)
  })

  it('rolls the files back when the tree the effects leave behind lints red', async () => {
    const ctx = await setup()
    const root = await workspace()
    await ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T01', summary: 'Start the review' })
    const before = await readFile(join(root, REQ_010), 'utf8')
    const result = await ctx.lifecycle.transition(root, {
      reqId: 'REQ-PLAT-010',
      transition: 'T15',
      summary: 'Block on a bug that does not exist',
      decisions: { fields: { pending_bugs: ['BUG-PLAT-999'], blocked_reason: 'waiting for a fix' } },
    })
    expect(result).toMatchObject({ applied: false, id: 'T15', from: 'req_review', to: 'blocked', files: [] })
    expect(result.violations.join('\n')).toContain('BUG-PLAT-999')
    expect(await readFile(join(root, REQ_010), 'utf8')).toBe(before)
  })

  it('refuses an unknown transition, event, or REQ with a coded error', async () => {
    const ctx = await setup()
    const root = await workspace()
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T99', summary: 'x' }))
      .rejects.toMatchObject({ code: 'UNKNOWN_TRANSITION' })
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', event: 'no_such_event', summary: 'x' }))
      .rejects.toMatchObject({ code: 'UNKNOWN_TRANSITION' })
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-404', transition: 'T01', summary: 'x' }))
      .rejects.toMatchObject({ code: 'UNKNOWN_REQ' })
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', summary: 'x' }))
      .rejects.toBeInstanceOf(LifecycleError)
  })

  it('applies human transitions through /lifecycle transition, role transitions through the tool, and logs both', async () => {
    const ctx = await setup()
    await ctx.plugin(CommandRuntime)
    const root = await workspace()
    const agent = agentAt(ctx, root)
    const refused = await call(ctx, { reqId: 'REQ-PLAT-010', transition: 'T01', summary: 'Start the review' }, agent)
    expect(refused.isError).toBe(true)
    if (!refused.isError) throw new Error('expected a refusal')
    expect(refused.error.info).toMatchObject({ code: 'HUMAN_ACTOR' })
    expect(refused.error.message).toContain('/lifecycle transition REQ-PLAT-010 T01')

    const command = await ctx.commands.execute(agent, '/lifecycle transition REQ-PLAT-010 T01 Start the review', [], signal)
    expect(command?.result).toEqual({
      kind: 'success',
      text: 'Applied T01 on REQ-PLAT-010: draft → req_review, owner planner-001. Commit subject: lifecycle: T01 — Start the review',
    })
    const applied = await call(ctx, { reqId: 'REQ-PLAT-010', transition: 'T02', summary: 'Scope written' }, agent)
    if (applied.isError) throw new Error(applied.error.message)
    expect(applied.value).toMatchObject({ applied: true, id: 'T02', to: 'req_review', ownerAfter: 'evaluator-002', suggestedCommitSubject: 'lifecycle: T02 — Scope written' })
    expect(text(applied)).toBe('Applied T02 on REQ-PLAT-010: req_review → req_review, owner evaluator-002. Commit subject: lifecycle: T02 — Scope written')
    const events = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/transition')
    expect(events.map(event => event.data)).toEqual([
      {
        version: 1,
        reqId: 'REQ-PLAT-010',
        id: 'T01',
        from: 'draft',
        to: 'req_review',
        actorUid: 'human-001',
        ownerBefore: 'human-001',
        ownerAfter: 'planner-001',
        reviewRound: 0,
        files: [REQ_010],
      },
      {
        version: 1,
        reqId: 'REQ-PLAT-010',
        id: 'T02',
        from: 'req_review',
        to: 'req_review',
        actorUid: 'planner-001',
        ownerBefore: 'planner-001',
        ownerAfter: 'evaluator-002',
        reviewRound: 0,
        files: [REQ_010],
      },
    ])

    const rejected = await call(ctx, { reqId: 'REQ-PLAT-010', transition: 'T05', summary: 'Skip ahead' }, agent)
    if (rejected.isError) throw new Error(rejected.error.message)
    expect(rejected.value).toMatchObject({ applied: false, id: 'T05', from: 'req_review', to: 'tc_review', files: [] })
    expect(text(rejected)).toMatch(/^Rejected T05 on REQ-PLAT-010: \d+ violations?\n- /)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/transition')).toHaveLength(2)
    const rejectedByHand = await ctx.commands.execute(agent, '/lifecycle transition REQ-PLAT-010 T14 Finish early', [], signal)
    expect(rejectedByHand?.result.kind).toBe('error')
    expect(rejectedByHand?.result.text).toMatch(/^Rejected T14 on REQ-PLAT-010: /)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/transition')).toHaveLength(2)
    const usage = await ctx.commands.execute(agent, '/lifecycle transition REQ-PLAT-010', [], signal)
    expect(usage?.result).toMatchObject({ kind: 'error' })
    const bad = await ctx.commands.execute(agent, '/lifecycle transition REQ-PLAT-010 T99 nope', [], signal)
    expect(bad?.result.kind).toBe('error')
    expect(bad?.result.text).toContain('T99')
  })
})

describe('lifecycle transition edge paths', () => {
  it('refuses a blank summary and a request naming both a transition and an event', async () => {
    const ctx = await setup()
    const root = await workspace()
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T01', summary: '  ' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T01', event: 'bug_fix', summary: 'x' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('seats the human actor of an exempt transition from a state the human does not handle', async () => {
    const ctx = await setup()
    const root = await workspace()
    await setField(root, REQ_010, 'status', 'tc_impl')
    await setField(root, REQ_010, 'owner', 'generator-001')
    const result = await ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T19', summary: 'Pull the requirement back' })
    expect(result).toMatchObject({ applied: true, id: 'T19', from: 'tc_impl', to: 'req_review', actorUid: 'human-001', ownerBefore: 'generator-001', ownerAfter: 'planner-001' })
  })

  it('reports an empty actor uid for an unregistered owner', async () => {
    const ctx = await setup()
    const root = await workspace()
    await setField(root, REQ_010, 'owner', 'nobody-001')
    const result = await ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', event: 'external_review', summary: 'An outside review' })
    expect(result).toMatchObject({ kind: 'event', id: 'external_review', actorUid: '', ownerBefore: 'nobody-001', from: 'draft', to: 'draft' })
  })
})

describe('transition rendering and logging helpers', () => {
  it('names the event in the logged payload, counts one violation in the singular, and reads the decision maps', () => {
    const base = {
      reqId: 'REQ-PLAT-009', from: 'done', to: 'done', actorUid: 'human-001', ownerBefore: 'human-001', ownerAfter: 'human-001',
      reviewRound: 8, files: [], suggestedCommitSubject: 'lifecycle: bug_fix — Fixed', violations: [],
    }
    expect(transitionEvent({ ...base, kind: 'event', applied: true, id: 'bug_fix' })).toMatchObject({ id: 'bug_fix', eventName: 'bug_fix' })
    expect(transitionEvent({ ...base, kind: 'transition', applied: true, id: 'T14' })).not.toHaveProperty('eventName')
    expect(renderTransition({ ...base, kind: 'transition', applied: false, id: 'T14', violations: ['one problem'] }))
      .toBe('Rejected T14 on REQ-PLAT-009: 1 violation\n- one problem')
    expect(decisionsOf({ fields: { a: 1 }, tcStatuses: { 'TC-1': 'passing', 'TC-2': 2 }, bugStatuses: { 'BUG-1': 'closed', 'BUG-2': null }, other: true }))
      .toEqual({ fields: { a: 1 }, tcStatuses: { 'TC-1': 'passing' }, bugStatuses: { 'BUG-1': 'closed' } })
    expect(decisionsOf({})).toEqual({})
  })
})

describe('lifecycle_transition and lifecycle_run presenters', () => {
  it('title the call by its step and REQ, and the tool passes decisions through', async () => {
    const ctx = await setup()
    const root = await workspace()
    const agent = agentAt(ctx, root)
    const view = (name: string, args: unknown) => ctx.tools.get(name)?.presentCall?.(args)
    expect(view('lifecycle_transition', { reqId: 'REQ-PLAT-010', transition: 'T01', summary: 'x' })).toEqual({ card: 'generic', title: 'Lifecycle T01 on REQ-PLAT-010', kind: 'other' })
    expect(view('lifecycle_transition', { reqId: 'REQ-PLAT-010', event: 'bug_fix', summary: 'x' })).toEqual({ card: 'generic', title: 'Lifecycle bug_fix on REQ-PLAT-010', kind: 'other' })
    expect(view('lifecycle_transition', { reqId: 'REQ-PLAT-010', summary: 'x' })).toEqual({ card: 'generic', title: 'Lifecycle step on REQ-PLAT-010', kind: 'other' })
    expect(view('lifecycle_run', { reqId: 'REQ-PLAT-010' })).toEqual({ card: 'generic', title: 'Lifecycle run on REQ-PLAT-010', kind: 'other' })
    const eventOnly = await call(ctx, { reqId: 'REQ-PLAT-010', event: 'external_review', summary: 'An outside review' }, agent)
    expect(eventOnly.isError).toBe(false)
    const unknown = await call(ctx, { reqId: 'REQ-PLAT-010', transition: 'T99', summary: 'x' }, agent)
    expect(unknown.isError).toBe(true)
    if (unknown.isError) expect(unknown.error.info).toMatchObject({ code: 'UNKNOWN_TRANSITION' })

    await ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T01', summary: 'Start the review' })
    const blocked = await call(ctx, {
      reqId: 'REQ-PLAT-010',
      transition: 'T15',
      summary: 'Block on a missing bug',
      decisions: { fields: { pending_bugs: ['BUG-PLAT-999'], blocked_reason: 'waiting' } },
    }, agent)
    if (blocked.isError) throw new Error(blocked.error.message)
    expect(blocked.value).toMatchObject({ applied: false, id: 'T15' })
    expect(text(blocked)).toContain('BUG-PLAT-999')
  })
})
