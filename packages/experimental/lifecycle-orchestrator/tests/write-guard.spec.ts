import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { WriteGuard, writeScope } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { agentAt, cleanup, setup, workspace } from './workspace-helper.ts'

const TASKS = 'lifecycle/tasks'

afterEach(cleanup)

describe('the write guard', () => {
  it('judges only the write tools of a fenced child, by lexical path under the workspace', async () => {
    const ctx = await setup()
    const root = await workspace()
    const driver = agentAt(ctx, root, 'driver')
    const child = agentAt(ctx, root, 'child', { origin: 'subagent', delegationDepth: 1, parentSession: driver.id })
    const guard = new WriteGuard(ctx)
    const close = guard.open(String(driver.id), { cwd: root, tasksDir: TASKS, scope: writeScope('planner', 'req_review', 'REQ-PLAT-010'), pre: ctx.lifecycle.graph(root) })
    const agentless = { callId: 'c' as never, rootCallId: 'c' as never, token: {} as never, name: 'write', arguments: {}, signal: new AbortController().signal }
    const execution = (name: string, args: unknown, agent: Agent = child) => ({ ...agentless, name, arguments: args, agent })
    const rv009 = `${TASKS}/reviews/platform/RV-PLAT-009.md`
    expect(guard.reasonFor(execution('write', { file_path: join(root, rv009) }))).toContain('outside the write scope')
    expect(guard.reasonFor(execution('edit', { file_path: rv009 }))).toContain('outside the write scope')
    expect(guard.reasonFor(execution('str_replace_editor', { command: 'str_replace', path: rv009 }))).toContain('outside the write scope')
    expect(guard.reasonFor(execution('str_replace_editor', { command: 'view', path: rv009 }))).toBeUndefined()
    expect(guard.reasonFor(execution('write', { file_path: `${TASKS}/features/platform/REQ-PLAT-010.md` }))).toBeUndefined()
    expect(guard.reasonFor(execution('write', { file_path: '../elsewhere/RV-PLAT-009.md' }))).toBeUndefined()
    expect(guard.reasonFor(execution('write', { file_path: root }))).toBeUndefined()
    expect(guard.reasonFor(execution('write', { content: 'no path' }))).toBeUndefined()
    expect(guard.reasonFor(execution('write', 'not an object'))).toBeUndefined()
    expect(guard.reasonFor(execution('read', { file_path: rv009 }))).toBeUndefined()
    expect(guard.reasonFor(execution('write', { file_path: rv009 }, driver))).toBeUndefined()
    expect(guard.reasonFor({ ...agentless, arguments: { file_path: rv009 } })).toBeUndefined()
    close()
    expect(guard.reasonFor(execution('write', { file_path: rv009 }))).toBeUndefined()
  })
})
