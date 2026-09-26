import { readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { actorOf } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { REQ_010, agentAt, cleanup, setField, withoutProviderSets } from './workspace-helper.ts'
import { RV_009, RV_010, bugReport, happyPathChildren, registerWriteTool, reviewRecord, setupDriver, writeArtifact } from './driver-helper.ts'

const signal = new AbortController().signal

afterEach(cleanup)

/** Move REQ-PLAT-010 to req_review owned by the evaluator, the state a review child works in. */
async function atEvaluatorReview(root: string): Promise<void> {
  await setField(root, REQ_010, 'status', 'req_review')
  await setField(root, REQ_010, 'owner', 'evaluator-002')
}

describe('lifecycle_run fences role children', () => {
  it('rejects a step whose child edited another REQ\'s artifact and restores every file', async () => {
    const { ctx, root, agent } = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: async (workspace) => {
        await writeArtifact(workspace, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }]))
        await writeArtifact(workspace, RV_009, `${await readFile(join(workspace, RV_009), 'utf8')}\nTampered.\n`)
      },
      proposal: { transition: 'T03', summary: 'Review passes' },
    }], { answers: 'none', prepare: atEvaluatorReview })
    const rv009 = await readFile(join(root, RV_009), 'utf8')
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.stopped).toBe('rejected')
    expect(result.steps).toMatchObject([{ uid: 'evaluator-002', role: 'evaluator', state: 'req_review', transition: 'T03', outcome: 'rejected' }])
    expect(result.steps[0]?.reason).toContain('RV-PLAT-009')
    expect(result.violations.join('\n')).toContain('RV-PLAT-009.md: outside the write scope of evaluator @ req_review on REQ-PLAT-010')
    expect(await readFile(join(root, RV_009), 'utf8')).toBe(rv009)
    expect(existsSync(join(root, ...RV_010.split('/')))).toBe(false)
    expect((await readFile(join(root, REQ_010), 'utf8'))).toContain('status: req_review\nowner: evaluator-002\n')
    const phases = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/step').map(event => (event.data as { phase: string }).phase)
    expect(phases).toEqual(['started', 'rejected'])
  })

  it('rejects a proposal whose guards fail, one without a transition, and one that is not JSON, rolling the edits back', async () => {
    const wrongRole = await setupDriver([{ label: 'lifecycle:planner-001@req_review:REQ-PLAT-010', proposal: { transition: 'T03', summary: 'Skip the evaluator' } }], {
      answers: ['T01'],
    })
    const guard = await wrongRole.ctx.lifecycle.run(wrongRole.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(guard.stopped).toBe('rejected')
    expect(guard.steps.map(step => step.outcome)).toEqual(['applied', 'rejected'])
    expect(guard.violations.join('\n')).toContain('evaluator')

    const silent = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: root => writeArtifact(root, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }])),
      proposal: null,
    }], { answers: 'none', prepare: atEvaluatorReview })
    const none = await silent.ctx.lifecycle.run(silent.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(none).toMatchObject({ stopped: 'rejected', steps: [{ outcome: 'rejected', transition: null }] })
    expect(none.violations.join('\n')).toContain('proposal')
    expect(existsSync(join(silent.root, ...RV_010.split('/')))).toBe(false)

    const garbled = await setupDriver([{ label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010', text: 'Done.\n\n```json\n{ not json\n```\n' }], {
      answers: 'none',
      prepare: atEvaluatorReview,
      config: { proposalChannel: 'text' },
    })
    const bad = await garbled.ctx.lifecycle.run(garbled.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(bad.stopped).toBe('rejected')
    expect(garbled.provider.requests[0]?.outputSchema).toBeUndefined()
  })

  it('reads a fenced JSON proposal when the channel is text', async () => {
    const { ctx, agent, provider } = await setupDriver(happyPathChildren().slice(0, 1), { answers: ['T01'], config: { proposalChannel: 'text', maxStepsPerRun: 2 } })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.steps.map(step => step.transition)).toEqual(['T01', 'T02'])
    expect(provider.requests[0]?.outputSchema).toBeUndefined()
  })

  it('records a failed step and restores the tree when the child fails or exceeds the step timeout', async () => {
    const failing = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: root => writeArtifact(root, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }])),
      stopReason: 'error',
      text: 'The model errored.',
    }], { answers: 'none', prepare: atEvaluatorReview })
    const failed = await failing.ctx.lifecycle.run(failing.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(failed).toMatchObject({ stopped: 'failed', steps: [{ uid: 'evaluator-002', outcome: 'failed', reason: 'the child stopped with error' }] })
    expect(existsSync(join(failing.root, ...RV_010.split('/')))).toBe(false)
    expect(failing.agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/step').map(event => (event.data as { phase: string }).phase)).toEqual(['started', 'failed'])

    const hanging = await setupDriver([{ label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010', hang: true }], {
      answers: 'none',
      prepare: atEvaluatorReview,
      config: { stepTimeoutMs: 20 },
    })
    const timedOut = await hanging.ctx.lifecycle.run(hanging.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(timedOut).toMatchObject({ stopped: 'failed', steps: [{ outcome: 'failed', reason: 'the child stopped with aborted after 20 ms' }] })
    expect(hanging.provider.disposed).toHaveLength(1)
  })

  it('denies a child\'s write outside its scope through the tool executor and lets scoped writes through', async () => {
    const outcomes: { path: string; error: string | undefined }[] = []
    const { ctx, root, agent } = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      act: async (_request, childId) => {
        const child = agentAt(ctx, root, String(childId), { origin: 'subagent', delegationDepth: 1, parentSession: agent.id })
        for (const [label, content] of [
          [RV_009, 'tampered'],
          [RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }])],
          ['notes.txt', 'outside the tasks tree'],
          ['lifecycle/tasks/archive/done/REQ-PLAT-009.md', 'archived'],
        ] as const) {
          const result = await ctx.tools.execute({
            signal, callId: ToolCallId(`child-write-${label}`), name: 'write', agent: child,
            arguments: { file_path: join(root, ...label.split('/')), content },
          })
          outcomes.push({ path: label, error: result.isError ? result.error.message : undefined })
        }
      },
      proposal: { transition: 'T03', summary: 'Review passes' },
    }], { answers: 'none', prepare: atEvaluatorReview, config: { maxStepsPerRun: 1 } })
    const written = registerWriteTool(ctx)
    const rv009 = await readFile(join(root, RV_009), 'utf8')
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.steps.map(step => step.outcome)).toEqual(['applied'])
    expect(outcomes.map(outcome => outcome.error === undefined ? 'ok' : outcome.error)).toEqual([
      expect.stringContaining('RV-PLAT-009.md: outside the write scope of evaluator @ req_review on REQ-PLAT-010'),
      'ok',
      'ok',
      expect.stringContaining('archive'),
    ])
    expect(written).toHaveLength(2)
    expect(await readFile(join(root, RV_009), 'utf8')).toBe(rv009)

    // Outside a step a child of the same driver is not fenced, and the root agent never is.
    for (const caller of [agentAt(ctx, root, 'lifecycle-late-child', { origin: 'subagent', delegationDepth: 1, parentSession: agent.id }), agent]) {
      const stray = await ctx.tools.execute({
        signal, callId: ToolCallId(`after-step-${caller.id}`), name: 'write', agent: caller,
        arguments: { file_path: join(root, ...RV_009.split('/')), content: rv009 },
      })
      expect(stray.isError).toBe(false)
    }
  })

  it('needs the briefs and a seat for the acting role', async () => {
    const { ctx, root, agent } = await setupDriver([], {
      answers: 'none',
      prepare: async (workspace) => {
        await atEvaluatorReview(workspace)
        await writeArtifact(workspace, 'lifecycle/standards/briefs.md', '# Briefs\n')
      },
    })
    await expect(ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)).rejects.toMatchObject({ code: 'NO_BRIEF' })
    expect((await readFile(join(root, REQ_010), 'utf8'))).toContain('owner: evaluator-002')
  })
})

describe('lifecycle_run keeps the tables, briefs, and its own contract safe', () => {
  it('rejects a child that edits the tables or the briefs and restores them', async () => {
    const TABLE = 'lifecycle/lifecycle.yml'
    const BRIEFS = 'lifecycle/standards/briefs.md'
    const { ctx, root, agent } = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: async (workspace) => {
        await writeArtifact(workspace, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }]))
        for (const label of [TABLE, BRIEFS]) {
          await writeArtifact(workspace, label, `${await readFile(join(workspace, ...label.split('/')), 'utf8')}\n# tampered\n`)
        }
      },
      proposal: { transition: 'T03', summary: 'Review passes' },
    }], { answers: 'none', prepare: atEvaluatorReview })
    const table = await readFile(join(root, ...TABLE.split('/')), 'utf8')
    const briefs = await readFile(join(root, ...BRIEFS.split('/')), 'utf8')
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.stopped).toBe('rejected')
    expect(result.violations.join('\n')).toContain('lifecycle/lifecycle.yml: outside the write scope')
    expect(result.violations.join('\n')).toContain('lifecycle/standards/briefs.md: outside the write scope')
    expect(await readFile(join(root, ...TABLE.split('/')), 'utf8')).toBe(table)
    expect(await readFile(join(root, ...BRIEFS.split('/')), 'utf8')).toBe(briefs)
    expect(existsSync(join(root, ...RV_010.split('/')))).toBe(false)
  })

  it('fails the step, restores the tree, and closes the step record when judging the child throws', async () => {
    const { ctx, root, agent } = await setupDriver([{
      label: 'lifecycle:planner-001@req_review:REQ-PLAT-010',
      edit: workspace => rm(join(workspace, ...REQ_010.split('/'))),
      proposal: { transition: 'T02', summary: 'Scope written' },
    }], { answers: ['T01'] })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.stopped).toBe('failed')
    expect(result.steps.map(step => step.outcome)).toEqual(['applied', 'failed'])
    expect(result.steps[1]?.reason).toContain('REQ-PLAT-010')
    expect(existsSync(join(root, ...REQ_010.split('/')))).toBe(true)
    expect((await readFile(join(root, REQ_010), 'utf8'))).toContain('status: req_review\nowner: planner-001\n')
    const phases = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/step').map(event => (event.data as { phase: string }).phase)
    expect(phases).toEqual(['started', 'failed'])
  })

  it('fails the step and closes the step record when the provider cannot start the child', async () => {
    const { ctx, agent } = await setupDriver([{ label: 'lifecycle:planner-001@req_review:REQ-PLAT-010', startError: 'the provider is offline' }], { answers: ['T01'] })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result).toMatchObject({ stopped: 'failed', steps: [{ outcome: 'applied' }, { outcome: 'failed', reason: 'the provider is offline' }] })
    const steps = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/step').map(event => event.data as { phase: string; childSessionId: string | null })
    expect(steps.map(step => step.phase)).toEqual(['started', 'failed'])
    expect(steps[1]?.childSessionId).toBeNull()
  })

  it('pauses the run with the child\'s question when it hands over needsHuman, keeping its scoped edits', async () => {
    const question = 'Which acceptance criterion governs pagination?'
    const { ctx, root, agent } = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: workspace => writeArtifact(workspace, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002', verdict: 'REJECT' }])),
      text: `Blocked on a ruling.\n\n\`\`\`json\n${JSON.stringify({ needsHuman: true, question })}\n\`\`\`\n`,
    }], { answers: 'none', prepare: atEvaluatorReview, config: { proposalChannel: 'text' } })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result).toMatchObject({
      stopped: 'needs-human',
      pendingHuman: { state: 'req_review', options: ['T03', 'T03b', 'T03c', 'T04', 'T15'], question },
      steps: [{ uid: 'evaluator-002', transition: null, outcome: 'paused', reason: question }],
    })
    expect(existsSync(join(root, ...RV_010.split('/')))).toBe(true)
    expect((await readFile(join(root, REQ_010), 'utf8'))).toContain('owner: evaluator-002\n')
    const phases = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/step').map(event => (event.data as { phase: string }).phase)
    expect(phases).toEqual(['started', 'completed'])
  })

  it('rejects a question hand-over whose edits left the write scope', async () => {
    const { ctx, root, agent } = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: async workspace => writeArtifact(workspace, RV_009, `${await readFile(join(workspace, RV_009), 'utf8')}\nTampered.\n`),
      text: 'Blocked.\n\n```json\n{"needsHuman":true,"question":"Which AC applies?"}\n```\n',
    }], { answers: 'none', prepare: atEvaluatorReview, config: { proposalChannel: 'text' } })
    const rv009 = await readFile(join(root, RV_009), 'utf8')
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result).toMatchObject({ stopped: 'rejected', steps: [{ outcome: 'rejected', transition: null }] })
    expect(await readFile(join(root, RV_009), 'utf8')).toBe(rv009)
  })

  it('refuses a second run or a hand-applied transition while a run owns the workspace', async () => {
    const controller = new AbortController()
    const { ctx, root, agent } = await setupDriver([{ label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010', hang: true }], {
      answers: 'none',
      prepare: atEvaluatorReview,
    })
    const pending = ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    await expect(ctx.lifecycle.run(agentAt(ctx, root, 'second-driver'), { reqId: 'REQ-PLAT-010' }, signal)).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' })
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T04', summary: 'Meanwhile' })).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' })
    controller.abort()
    expect((await pending).stopped).toBe('failed')
    await expect(ctx.lifecycle.transition(root, { reqId: 'REQ-PLAT-010', transition: 'T04', summary: 'Afterwards' })).resolves.toMatchObject({ id: 'T04' })
  })
})

describe('lifecycle_run edge paths', () => {
  it('rejects a human decision whose effects cannot seat the next owner', async () => {
    const { ctx, root, agent } = await setupDriver([], {
      answers: ['T01'],
      prepare: async (workspace) => {
        await withoutProviderSets(workspace)
      },
    })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result).toMatchObject({ stopped: 'rejected', steps: [{ uid: 'human-001', role: 'human', state: 'draft', transition: 'T01', outcome: 'rejected' }] })
    expect(result.violations.join('\n')).toContain('planner')
    expect((await readFile(join(root, REQ_010), 'utf8'))).toContain('status: draft\nowner: human-001\n')
  })

  it('rejects a proposal naming a transition or event the table lacks, and rolls back a new unbound BUG', async () => {
    const unknownTransition = await setupDriver([{ label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010', proposal: { transition: 'T99', summary: 'x' } }], {
      answers: 'none',
      prepare: atEvaluatorReview,
    })
    const first = await unknownTransition.ctx.lifecycle.run(unknownTransition.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(first).toMatchObject({ stopped: 'rejected', violations: ['T99 is not a transition of the lifecycle table'], steps: [{ transition: 'T99' }] })

    const unknownEvent = await setupDriver([{ label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010', proposal: { event: 'no_such_event', summary: 'x' } }], {
      answers: 'none',
      prepare: atEvaluatorReview,
    })
    const second = await unknownEvent.ctx.lifecycle.run(unknownEvent.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(second).toMatchObject({ stopped: 'rejected', violations: ['no_such_event is not an event of the lifecycle table'], steps: [{ transition: 'no_such_event' }] })

    const unbound = 'lifecycle/tasks/bugs/platform/BUG-PLAT-011.md'
    const bound = 'lifecycle/tasks/bugs/platform/BUG-PLAT-010.md'
    const bugs = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: async (workspace) => {
        await writeArtifact(workspace, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }]))
        await writeArtifact(workspace, bound, bugReport('BUG-PLAT-010', 'REQ-PLAT-010'))
        await writeArtifact(workspace, unbound, bugReport('BUG-PLAT-011', ''))
      },
      proposal: { transition: 'T03', summary: 'Review passes with findings' },
    }], { answers: 'none', prepare: atEvaluatorReview })
    const third = await bugs.ctx.lifecycle.run(bugs.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(third.stopped).toBe('rejected')
    expect(third.violations).toEqual([expect.stringContaining('BUG-PLAT-011 names REQ-PLAT-010 neither')])
    expect(existsSync(join(bugs.root, ...bound.split('/')))).toBe(false)
    expect(existsSync(join(bugs.root, ...unbound.split('/')))).toBe(false)
  })

  it('accepts a new BUG bound to the REQ', async () => {
    const bound = 'lifecycle/tasks/bugs/platform/BUG-PLAT-010.md'
    const { ctx, root, agent } = await setupDriver([{
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: async (workspace) => {
        await writeArtifact(workspace, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }]))
        await writeArtifact(workspace, bound, bugReport('BUG-PLAT-010', 'REQ-PLAT-010'))
      },
      proposal: { transition: 'T03', summary: 'Review passes with one finding filed' },
    }], { answers: 'none', prepare: atEvaluatorReview, config: { maxStepsPerRun: 1 } })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result).toMatchObject({ stopped: 'max-steps', steps: [{ transition: 'T03', outcome: 'applied' }] })
    expect(existsSync(join(root, ...bound.split('/')))).toBe(true)
  })

  it('ends a failed step when the parent signal aborts, without the timeout suffix', async () => {
    const controller = new AbortController()
    const { ctx, agent, provider } = await setupDriver([{ label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010', hang: true }], {
      answers: 'none',
      prepare: atEvaluatorReview,
    })
    const pending = ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    controller.abort()
    const result = await pending
    expect(result).toMatchObject({ stopped: 'failed', steps: [{ outcome: 'failed', reason: 'the child stopped with aborted' }] })
    expect(provider.disposed).toHaveLength(1)
  })

  it('omits the request fields a provider does not support and still reads the text proposal', async () => {
    const { ctx, agent, provider } = await setupDriver(happyPathChildren().slice(0, 1), {
      answers: ['T01'],
      config: { maxStepsPerRun: 2 },
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.steps.map(step => step.transition)).toEqual(['T01', 'T02'])
    const [request] = provider.requests
    expect(request?.agentOptions).toBeUndefined()
    expect(request?.toolFilter).toBeUndefined()
    expect(request?.maxDepth).toBeUndefined()
    expect(request?.outputSchema).toBeUndefined()
  })

  it('needs a registered provider, a positive step ceiling, and a Session working directory', async () => {
    const missing = await setupDriver([], { answers: 'none', config: { subagentProvider: 'missing' } })
    await expect(missing.ctx.lifecycle.run(missing.agent, { reqId: 'REQ-PLAT-010' }, signal)).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    const { ctx, agent } = await setupDriver([], { answers: 'none' })
    await expect(ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010', maxSteps: 0 }, signal)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(ctx.lifecycle.run(agentAt(ctx, undefined, 'homeless'), { reqId: 'REQ-PLAT-010' }, signal)).rejects.toMatchObject({ code: 'NO_WORKSPACE' })
    await expect(ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-404' }, signal)).rejects.toMatchObject({ code: 'UNKNOWN_REQ' })
  })

  it('propagates an answerer crash and treats an empty selection as Stop', async () => {
    const crashing = await setupDriver([], { answers: ['BOOM'] })
    await expect(crashing.ctx.lifecycle.run(crashing.agent, { reqId: 'REQ-PLAT-010' }, signal)).rejects.toThrow('the answerer crashed')
    const empty = await setupDriver([], { answers: [''] })
    const result = await empty.ctx.lifecycle.run(empty.agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.stopped).toBe('needs-human')
    expect(empty.agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/human-decision').map(event => (event.data as { answer: string | null }).answer))
      .toEqual([null, 'Stop'])
  })

  it('resolves the acting registered agent and refuses a human or unknown uid', async () => {
    const { ctx, root } = await setupDriver([], { answers: 'none' })
    const load = ctx.lifecycle.load(root)
    if (load.tables === undefined) throw new Error('tables')
    const { registry } = load.tables
    expect(actorOf(registry, 'generator-001', 'tc_impl')).toMatchObject({ route: { provider: 'claude-code', model: 'opus' }, effort: 'high' })
    expect(() => actorOf(registry, 'human-001', 'draft')).toThrow('not a registered role agent with a route')
    expect(() => actorOf(registry, 'nobody-001', 'draft')).toThrow('not a registered role agent with a route')
  })

  it('sends no reasoning effort for a role agent whose registry entry declares none', async () => {
    const { ctx, agent, provider } = await setupDriver(happyPathChildren().slice(0, 1), {
      answers: ['T01'],
      config: { maxStepsPerRun: 2 },
      prepare: async (workspace) => {
        const path = join(workspace, 'lifecycle', 'agent-registry.yml')
        const text = await readFile(path, 'utf8')
        await writeFile(path, text.replace('    effort: xhigh\n', ''), 'utf8')
      },
    })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result.steps.map(step => step.transition)).toEqual(['T01', 'T02'])
    expect(provider.requests[0]?.agentOptions).toEqual({ provider: 'claude-code', model: 'opus' })
    const started = agent.session.snapshotEvents().find(event => event.type === 'lifecycle/step')
    expect(started?.data).toMatchObject({ uid: 'planner-001', effort: null })
  })

  it('fails the step when no child is scripted for the seat', async () => {
    const { ctx, agent } = await setupDriver([], { answers: ['T01'] })
    const result = await ctx.lifecycle.run(agent, { reqId: 'REQ-PLAT-010' }, signal)
    expect(result).toMatchObject({ stopped: 'failed', steps: [{ outcome: 'applied' }, { outcome: 'failed' }] })
    expect(result.steps[1]?.reason).toContain('no scripted child for lifecycle:planner-001@req_review:REQ-PLAT-010')
  })
})
