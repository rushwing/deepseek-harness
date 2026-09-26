import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleError } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { REQ_009, REQ_010, TC_009_01, cleanup, emptyDirectory, setField, setup, withoutProviderSets, workspace, writeText } from './workspace-helper.ts'

afterEach(cleanup)

async function block009(root: string, restoreState: string, restoreOwner: string): Promise<void> {
  await setField(root, REQ_009, 'status', 'blocked')
  await setField(root, REQ_009, 'pending_bugs', '[BUG-PLAT-003]')
  await setField(root, REQ_009, 'blocked_reason', 'waiting on BUG-PLAT-003')
  await setField(root, REQ_009, 'blocked_from_status', restoreState)
  await setField(root, REQ_009, 'blocked_from_owner', restoreOwner)
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error: unknown) {
    return error instanceof LifecycleError ? error.code : `not a LifecycleError: ${String(error)}`
  }
  return undefined
}

describe('ctx.lifecycle.load', () => {
  it('loads the four tables of a workspace and reports missing or invalid files', async () => {
    const ctx = await setup()
    const root = await workspace()
    const load = ctx.lifecycle.load(root)
    expect(load.problems).toEqual([])
    expect(load.dir).toBe('lifecycle')
    expect(load.root).toBe(join(root, 'lifecycle'))
    expect(load.tables?.registry.activeSet).toBe('mixed')
    expect(load.tables?.table.version).toBe(2)
    const empty = await emptyDirectory()
    expect(ctx.lifecycle.load(empty)).toEqual({
      root: join(empty, 'lifecycle'),
      dir: 'lifecycle',
      tables: undefined,
      problems: [
        'lifecycle/lifecycle.yml: missing',
        'lifecycle/agent-registry.yml: missing',
        'lifecycle/tasks/id-scheme.yml: missing',
        'lifecycle/artifact-contract.yml: missing',
      ],
    })
    await writeText(root, 'lifecycle/artifact-contract.yml', 'version: 9\n')
    const broken = ctx.lifecycle.load(root)
    expect(broken.tables).toBeUndefined()
    expect(broken.problems.join('\n')).toMatch(/^lifecycle\/artifact-contract\.yml: version/m)
    const table = await workspace()
    await writeText(table, 'lifecycle/lifecycle.yml', 'version: 1\n')
    expect(ctx.lifecycle.load(table).problems.join('\n')).toMatch(/^lifecycle\/lifecycle\.yml: .*version/m)
    const registry = await workspace()
    await writeText(registry, 'lifecycle/agent-registry.yml', 'version: 1\nroles: {}\nagents: []\n')
    expect(ctx.lifecycle.load(registry).problems.join('\n')).toMatch(/^lifecycle\/agent-registry\.yml: /m)
    const scheme = await workspace()
    await writeText(scheme, 'lifecycle/tasks/id-scheme.yml', 'scopes: 1\n')
    expect(ctx.lifecycle.load(scheme).problems.join('\n')).toMatch(/^lifecycle\/tasks\/id-scheme\.yml: /m)
    const asFile = await emptyDirectory()
    await writeText(asFile, 'lifecycle', 'not a directory\n')
    expect(ctx.lifecycle.load(asFile).problems).toHaveLength(4)
    const asDirectory = await workspace()
    await rm(join(asDirectory, 'lifecycle', 'lifecycle.yml'))
    await mkdir(join(asDirectory, 'lifecycle', 'lifecycle.yml'))
    expect(() => ctx.lifecycle.load(asDirectory)).toThrow(/EISDIR/)
  })

  it('reads the directory name from its configuration', async () => {
    const ctx = await setup('process')
    const root = await workspace()
    expect(ctx.lifecycle.load(root).problems).toEqual([
      'process/lifecycle.yml: missing',
      'process/agent-registry.yml: missing',
      'process/tasks/id-scheme.yml: missing',
      'process/artifact-contract.yml: missing',
    ])
  })
})

describe('ctx.lifecycle.graph and lint', () => {
  it('builds the graph and lints the whole tree or one REQ family', async () => {
    const ctx = await setup()
    const root = await workspace()
    expect(ctx.lifecycle.graph(root).reqs.has('REQ-PLAT-009')).toBe(true)
    expect(ctx.lifecycle.lint(root)).toEqual({ violations: [], counts: {} })
    await setField(root, REQ_010, 'owner', 'ghost-001')
    await setField(root, TC_009_01, 'status', 'green')
    const all = ctx.lifecycle.lint(root)
    const files = new Set(all.violations.map(violation => violation.file))
    expect(files).toEqual(new Set([REQ_010, TC_009_01]))
    expect(Object.values(all.counts).reduce((sum, count) => sum + count, 0)).toBe(all.violations.length)
    expect(all.counts['req-fields']).toBe(1)
    const ten = ctx.lifecycle.lint(root, 'REQ-PLAT-010')
    expect(ten.violations.length).toBeGreaterThan(0)
    expect(ten.violations.every(violation => violation.file === REQ_010)).toBe(true)
    const nine = ctx.lifecycle.lint(root, 'REQ-PLAT-009')
    expect(nine.violations.length).toBeGreaterThan(0)
    expect(nine.violations.every(violation => violation.file === TC_009_01)).toBe(true)
    expect(codeOf(() => ctx.lifecycle.lint(root, 'REQ-PLAT-404'))).toBe('UNKNOWN_REQ')
    const linked = await workspace()
    await writeText(linked, REQ_010, (await readFile(join(linked, REQ_010), 'utf8')).replace(
      '- [PL-PLAT-009](../../plans/platform/PL-PLAT-009.md): the table and rule inventory the lint implements',
      '- [dir](../../plans) and [gone](../../nowhere.md) and [ok](../../plans/platform/PL-PLAT-009.md)',
    ))
    expect(ctx.lifecycle.lint(linked, 'REQ-PLAT-010').violations.map(violation => violation.message)).toEqual([
      "link '../../plans' points to a directory, not a file",
      "link '../../nowhere.md' points to a missing file",
    ])
  })

  it('refuses to read artifacts while the tables are invalid', async () => {
    const ctx = await setup()
    const root = await workspace()
    await writeText(root, 'lifecycle/artifact-contract.yml', 'version: 9\n')
    let message = ''
    try {
      ctx.lifecycle.graph(root)
    } catch (error: unknown) {
      message = error instanceof LifecycleError ? `${error.code}: ${error.message}` : String(error)
    }
    expect(message).toMatch(/^TABLES_INVALID: the lifecycle tables under lifecycle\/ did not load:\n/)
    expect(message).toMatch(/\nlifecycle\/artifact-contract\.yml: version/)
    expect(codeOf(() => ctx.lifecycle.lint(root))).toBe('TABLES_INVALID')
  })
})

describe('ctx.lifecycle.checkIn', () => {
  it('checks the REQ file, the owner, and the state, and exempts the transitions the table marks', async () => {
    const ctx = await setup()
    const root = await workspace()
    const ok = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'draft' })
    expect(ok).toEqual({
      ok: true,
      exempt: false,
      checks: {
        c1: { ok: true, file: REQ_010 },
        c2: { ok: true, expected: 'human-001', actual: 'human-001' },
        c3: { ok: true, status: 'draft', state: 'draft', handles: ['draft', 'req_review', 'pr_draft', 'blocked', 'done'] },
      },
    })
    const wrongOwner = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-010', uid: 'planner-001', state: 'draft' })
    expect(wrongOwner.ok).toBe(false)
    expect(wrongOwner.checks.c2).toEqual({ ok: false, expected: 'human-001', actual: 'planner-001' })
    expect(wrongOwner.checks.c3).toEqual({ ok: false, status: 'draft', state: 'draft', handles: ['req_review'] })
    const wrongState = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'req_review' })
    expect(wrongState.ok).toBe(false)
    expect(wrongState.checks.c3).toMatchObject({ ok: false, status: 'draft', state: 'req_review' })
    const unregistered = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-010', uid: 'ghost-001', state: 'draft' })
    expect(unregistered.checks.c3).toEqual({ ok: false, status: 'draft', state: 'draft', handles: [] })
    const missing = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-404', uid: 'human-001', state: 'draft' })
    expect(missing).toEqual({
      ok: false,
      exempt: false,
      checks: {
        c1: { ok: false, file: null },
        c2: { ok: false, expected: null, actual: 'human-001' },
        c3: { ok: false, status: null, state: 'draft', handles: ['draft', 'req_review', 'pr_draft', 'blocked', 'done'] },
      },
    })
    const recall = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-009', uid: 'human-001', state: 'req_review', transition: 'T19' })
    expect(recall.exempt).toBe(true)
    expect(recall.ok).toBe(true)
    expect(recall.checks.c3.ok).toBe(false)
    const notExempt = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-010', uid: 'planner-001', state: 'draft', transition: 'T01' })
    expect(notExempt).toMatchObject({ ok: false, exempt: false })
    const foreignRecall = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-009', uid: 'planner-001', state: 'req_review', transition: 'T19' })
    expect(foreignRecall.exempt).toBe(false)
    const missingRecall = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-404', uid: 'human-001', state: 'draft', transition: 'T19' })
    expect(missingRecall).toMatchObject({ ok: false, exempt: true })
    const currentOwner = ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'draft', transition: 'T15' })
    expect(currentOwner).toMatchObject({ ok: true, exempt: false })
    expect(codeOf(() => ctx.lifecycle.checkIn(root, { reqId: 'REQ-PLAT-010', uid: 'human-001', state: 'draft', transition: 'T99' }))).toBe('UNKNOWN_TRANSITION')
  })
})

describe('ctx.lifecycle.legalTransitions and status', () => {
  it('lists the transitions the current owner may take, resolving the restore slots', async () => {
    const ctx = await setup()
    const root = await workspace()
    expect(ctx.lifecycle.legalTransitions(root, 'REQ-PLAT-010')).toEqual([
      { id: 'T01', actor: 'human', to: 'req_review', ownerAfter: 'planner', human: true },
      { id: 'T19', actor: 'human', to: 'req_review', ownerAfter: 'planner', human: true },
    ])
    expect(ctx.lifecycle.legalTransitions(root, 'REQ-PLAT-009')).toEqual([])
    await setField(root, REQ_010, 'status', 'req_review')
    await setField(root, REQ_010, 'owner', 'evaluator-001')
    expect(ctx.lifecycle.legalTransitions(root, 'REQ-PLAT-010').map(transition => transition.id)).toEqual(['T03', 'T03b', 'T03c', 'T04', 'T15'])
    expect(ctx.lifecycle.legalTransitions(root, 'REQ-PLAT-010').at(-1)).toEqual({ id: 'T15', actor: 'evaluator', to: 'blocked', ownerAfter: 'human', human: false })
    await block009(root, 'tc_impl', 'generator')
    expect(ctx.lifecycle.legalTransitions(root, 'REQ-PLAT-009')).toEqual([
      { id: 'T16', actor: 'human', to: 'tc_impl', ownerAfter: 'generator', human: true },
    ])
    await setField(root, REQ_009, 'owner', 'ghost-001')
    expect(ctx.lifecycle.legalTransitions(root, 'REQ-PLAT-009')).toEqual([])
    expect(codeOf(() => ctx.lifecycle.legalTransitions(root, 'REQ-PLAT-404'))).toBe('UNKNOWN_REQ')
  })

  it('reports one REQ or every REQ with its owner role, seat, and legal transitions', async () => {
    const ctx = await setup()
    const root = await workspace()
    expect(ctx.lifecycle.status(root, 'REQ-PLAT-010')).toEqual({
      activeSet: 'mixed',
      reqs: [{
        id: 'REQ-PLAT-010',
        status: 'draft',
        owner: 'human-001',
        ownerRole: 'human',
        reviewRound: 0,
        tcPolicy: 'required',
        blocked: null,
        seat: 'human-001',
        legalTransitions: [
          { id: 'T01', actor: 'human', to: 'req_review', ownerAfter: 'planner', human: true },
          { id: 'T19', actor: 'human', to: 'req_review', ownerAfter: 'planner', human: true },
        ],
      }],
    })
    const everything = ctx.lifecycle.status(root)
    expect(everything.reqs.map(req => req.id)).toEqual(['REQ-CBOM-021', 'REQ-PLAT-008', 'REQ-PLAT-009', 'REQ-PLAT-010'])
    await block009(root, 'tc_impl', 'generator')
    const blocked = ctx.lifecycle.status(root, 'REQ-PLAT-009').reqs[0]
    expect(blocked?.blocked).toEqual({ reason: 'waiting on BUG-PLAT-003', pendingBugs: ['BUG-PLAT-003'], restoreState: 'tc_impl', restoreOwner: 'generator' })
    expect(blocked?.seat).toBe('human-001')
    await setField(root, REQ_010, 'status', 'req_review')
    await setField(root, REQ_010, 'owner', 'evaluator-001')
    expect(ctx.lifecycle.status(root, 'REQ-PLAT-010').reqs[0]?.seat).toBe('evaluator-002')
    await setField(root, REQ_010, 'review_round', 'eight')
    expect(ctx.lifecycle.status(root, 'REQ-PLAT-010').reqs[0]?.reviewRound).toBeNull()
    expect(codeOf(() => ctx.lifecycle.status(root, 'REQ-PLAT-404'))).toBe('UNKNOWN_REQ')
    await setField(root, REQ_010, 'owner', 'ghost-001')
    const ghost = ctx.lifecycle.status(root, 'REQ-PLAT-010').reqs[0]
    expect(ghost).toMatchObject({ ownerRole: '', seat: null, legalTransitions: [] })
    await withoutProviderSets(root)
    await setField(root, REQ_010, 'owner', 'planner-001')
    const noSets = ctx.lifecycle.status(root, 'REQ-PLAT-010')
    expect(noSets.activeSet).toBeNull()
    expect(noSets.reqs[0]?.seat).toBeNull()
  })
})
