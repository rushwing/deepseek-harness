import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { Config, planFor, uidOfLabel } from '@deepseek-ai/dsh-experimental-lifecycle-model-fallback'
import { cleanup, workspace } from './harness.ts'

afterEach(cleanup)

/** A context whose projections know the subagent identity; `bare` leaves the key unregistered. */
async function context(bare = false): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  if (!bare) await ctx.plugin(SubagentRuntime, {})
  return ctx
}

function agentAt(ctx: Context, cwd: string | undefined, label: string | undefined): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('plan-agent')
  const session = cwd === undefined
    ? Session.create(id)
    : Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  if (label !== undefined) session.append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'spawn', label })
  return {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

describe('route plans', () => {
  it('reads the uid from a driver label only', () => {
    expect(uidOfLabel('lifecycle:planner-001@req_review:REQ-PLAT-010')).toBe('planner-001')
    expect(uidOfLabel('Ralph round 1')).toBeUndefined()
    expect(uidOfLabel('lifecycle:planner-001')).toBeUndefined()
    expect(uidOfLabel(undefined)).toBeUndefined()
  })

  it('lists the registry route and its fallbacks for a labeled child with loadable tables', async () => {
    const root = await workspace()
    const ctx = await context()
    const plan = planFor(ctx, agentAt(ctx, root, 'lifecycle:planner-001@req_review:REQ-PLAT-010'), 'lifecycle')
    expect(plan).toEqual({
      uid: 'planner-001',
      routes: [{ provider: 'claude-code', model: 'opus' }, { provider: 'claude-code', model: 'sonnet' }, { provider: 'codex', model: 'gpt-5.6-sol' }],
      hops: 0,
      route: { provider: 'claude-code', model: 'opus' },
    })
  })

  it('has no plan for other agents, workspaces without tables, unregistered uids, or humans', async () => {
    const root = await workspace()
    const ctx = await context()
    const planner = 'lifecycle:planner-001@req_review:REQ-PLAT-010'
    expect(planFor(ctx, agentAt(ctx, root, undefined), 'lifecycle')).toBeUndefined()
    expect(planFor(ctx, agentAt(ctx, root, 'Ralph round 1'), 'lifecycle')).toBeUndefined()
    expect(planFor(ctx, agentAt(ctx, undefined, planner), 'lifecycle')).toBeUndefined()
    expect(planFor(ctx, agentAt(ctx, root, planner), 'elsewhere')).toBeUndefined()
    expect(planFor(ctx, agentAt(ctx, root, 'lifecycle:nobody-001@req_review:REQ-PLAT-010'), 'lifecycle')).toBeUndefined()
    expect(planFor(ctx, agentAt(ctx, root, 'lifecycle:human-001@draft:REQ-PLAT-010'), 'lifecycle')).toBeUndefined()
    const bare = await context(true)
    expect(planFor(bare, agentAt(bare, root, planner), 'lifecycle')).toBeUndefined()
    await writeFile(join(root, 'lifecycle', 'agent-registry.yml'), 'version: 1\n', 'utf8')
    expect(planFor(ctx, agentAt(ctx, root, planner), 'lifecycle')).toBeUndefined()
  })

  it('declares its defaults', () => {
    expect(Config()).toEqual({
      lifecycleDir: 'lifecycle',
      hopOnCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
      maxHops: 2,
    })
  })
})
