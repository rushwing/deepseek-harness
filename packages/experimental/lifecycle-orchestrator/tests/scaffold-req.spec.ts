import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SEED_REQ_ID, writeSeedReq } from './seed-req.ts'
import { agentAt, cleanup, emptyDirectory, setup } from './workspace-helper.ts'

const signal = new AbortController().signal

afterEach(cleanup)

function call(ctx: Context, name: string, args: unknown, agent: Agent) {
  return ctx.tools.execute({ signal, callId: ToolCallId(`seed-${name}`), name, arguments: args, agent })
}

describe('the seed REQ over a full scaffold', () => {
  it('lints clean and offers the Planner its review transitions', async () => {
    const ctx = await setup()
    const root = await emptyDirectory()
    const agent = agentAt(ctx, root)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) } as never)
    const init = await call(ctx, 'lifecycle_init', { scaffold: 'full' }, agent)
    if (init.isError) throw new Error(init.error.message)
    await writeSeedReq(root)
    expect(ctx.lifecycle.lint(root).violations).toEqual([])
    const status = ctx.lifecycle.status(root, SEED_REQ_ID)
    expect(status.reqs[0]).toMatchObject({ status: 'req_review', owner: 'planner-001', ownerRole: 'planner', seat: 'planner-001' })
    expect(status.reqs[0]?.legalTransitions.map(transition => transition.id)).toEqual(['T02', 'T15', 'T17'])
    expect(ctx.lifecycle.briefs(root).problems).toEqual([])
  })
})
