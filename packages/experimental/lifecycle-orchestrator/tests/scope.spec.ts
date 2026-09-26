import { afterEach, describe, expect, it } from 'vitest'
import { WRITE_KINDS, denialOf, unboundBug, writeScope } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { cleanup, setup, workspace } from './workspace-helper.ts'
import { bugReport, writeArtifact } from './driver-helper.ts'

const TASKS = 'lifecycle/tasks'
const BUG_003 = `${TASKS}/bugs/platform/BUG-PLAT-003.md`

afterEach(cleanup)

describe('write scopes', () => {
  it('lists the kinds each writing role state may touch and nothing for other pairs', () => {
    expect(Object.keys(WRITE_KINDS)).toHaveLength(8)
    expect(writeScope('planner', 'req_review', 'REQ-PLAT-010').kinds).toEqual(['REQ', 'PL'])
    expect(writeScope('planner', 'tc_impl', 'REQ-PLAT-010').kinds).toEqual([])
  })

  it('judges paths by tree, kind, and binding to the REQ', async () => {
    const ctx = await setup()
    const root = await workspace()
    const graph = ctx.lifecycle.graph(root)
    const planner = writeScope('planner', 'req_review', 'REQ-PLAT-009')
    const generator = writeScope('generator', 'req_impl', 'REQ-PLAT-009')
    const idle = writeScope('planner', 'tc_impl', 'REQ-PLAT-009')
    const judge = (scope: typeof planner, label: string): string | undefined => denialOf(scope, label, TASKS, graph)
    expect(judge(planner, 'src/index.ts')).toBeUndefined()
    expect(judge(planner, `${TASKS}/id-scheme.yml`)).toContain('not an artifact directory')
    expect(judge(planner, `${TASKS}/archive/done/REQ-PLAT-009.md`)).toContain('archived artifacts are read-only')
    expect(judge(planner, `${TASKS}/plans/platform/PL-PLAT-009.md`)).toBeUndefined()
    expect(judge(planner, `${TASKS}/plans/platform/PL-PLAT-008.md`)).toContain('PL-PLAT-008.md is not an artifact of REQ-PLAT-009')
    expect(judge(planner, `${TASKS}/plans/platform/notes.txt`)).toContain('notes.txt is not an artifact of REQ-PLAT-009')
    expect(judge(planner, `${TASKS}/reviews/platform/RV-PLAT-009.md`)).toContain('may write REQ, PL only')
    expect(judge(idle, `${TASKS}/features/platform/REQ-PLAT-009.md`)).toContain('this role writes no artifact at this state')
    expect(judge(generator, BUG_003)).toBeUndefined()
    expect(judge(generator, `${TASKS}/bugs/platform/BUG-PLAT-999.md`)).toBeUndefined()
    expect(judge(writeScope('generator', 'req_impl', 'REQ-PLAT-010'), BUG_003)).toContain('BUG-PLAT-003.md is not an artifact of REQ-PLAT-010')
    expect(judge(generator, `${TASKS}/test-cases/platform/TC-PLAT-009-01.md`)).toBeUndefined()
  })

  it('binds a new BUG through origin_req, linked_req, or blocks_req', async () => {
    const ctx = await setup()
    const root = await workspace()
    const bound = `${TASKS}/bugs/platform/BUG-PLAT-010.md`
    const blocking = `${TASKS}/bugs/platform/BUG-PLAT-012.md`
    const unbound = `${TASKS}/bugs/platform/BUG-PLAT-011.md`
    await writeArtifact(root, bound, bugReport('BUG-PLAT-010', 'REQ-PLAT-010'))
    await writeArtifact(root, blocking, bugReport('BUG-PLAT-012', '', 'REQ-PLAT-010'))
    await writeArtifact(root, unbound, bugReport('BUG-PLAT-011', ''))
    const graph = ctx.lifecycle.graph(root)
    expect(unboundBug(graph, bound, 'REQ-PLAT-010')).toBeUndefined()
    expect(unboundBug(graph, blocking, 'REQ-PLAT-010')).toBeUndefined()
    expect(unboundBug(graph, BUG_003, 'REQ-PLAT-009')).toBeUndefined()
    expect(unboundBug(graph, unbound, 'REQ-PLAT-010')).toContain('BUG-PLAT-011 names REQ-PLAT-010 neither')
    expect(unboundBug(graph, `${TASKS}/bugs/platform/BUG-PLAT-404.md`, 'REQ-PLAT-010')).toContain('not a well-formed BUG')
    expect(unboundBug(graph, `${TASKS}/reviews/platform/RV-PLAT-009.md`, 'REQ-PLAT-010')).toContain('not a well-formed BUG')
  })
})
