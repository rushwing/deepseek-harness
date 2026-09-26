import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
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

  it('exposes the transition through lifecycle_transition and logs the applied transition', async () => {
    const ctx = await setup()
    const root = await workspace()
    const agent = agentAt(ctx, root)
    const applied = await call(ctx, { reqId: 'REQ-PLAT-010', transition: 'T01', summary: 'Start the review' }, agent)
    if (applied.isError) throw new Error('transition failed')
    expect(applied.value).toMatchObject({ applied: true, id: 'T01', to: 'req_review', suggestedCommitSubject: 'lifecycle: T01 — Start the review' })
    expect(text(applied)).toBe('Applied T01 on REQ-PLAT-010: draft → req_review, owner planner-001. Commit subject: lifecycle: T01 — Start the review')
    const events = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/transition')
    expect(events.map(event => event.data)).toEqual([{
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
    }])

    const rejected = await call(ctx, { reqId: 'REQ-PLAT-010', transition: 'T14', summary: 'Finish early' }, agent)
    if (rejected.isError) throw new Error('transition failed')
    expect(rejected.value).toMatchObject({ applied: false, id: 'T14', from: 'req_review', to: 'done', files: [] })
    expect(text(rejected)).toMatch(/^Rejected T14 on REQ-PLAT-010: \d+ violations?\n- /)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/transition')).toHaveLength(1)
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

    await call(ctx, { reqId: 'REQ-PLAT-010', transition: 'T01', summary: 'Start the review' }, agent)
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
