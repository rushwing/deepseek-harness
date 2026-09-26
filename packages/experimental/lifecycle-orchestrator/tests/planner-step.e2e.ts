import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootProductionProfile } from '../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { SEED_REQ_ID, writeSeedReq } from './seed-req.ts'

/** Key-gated smoke: a real Planner child takes one lifecycle step on the shipped default route. */

const BUNDLE_PATCH = fileURLToPath(new URL('../../lifecycle-team-profile/cordis.patch.yml', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./fixtures/e2e/headless.patch.yml', import.meta.url))
const LEGAL_FROM_PLANNER_REVIEW = ['T02', 'T15', 'T17']

let ctx: Context | undefined
let handle: AgentHandle | undefined
let cwd: string | undefined

afterEach(async () => {
  await handle?.dispose()
  handle = undefined
  await ctx?.fiber.dispose()
  ctx = undefined
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true })
  cwd = undefined
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('lifecycle planner step with-key smoke', () => {
  it('scaffolds a workspace and drives one Planner step of the seed REQ through a real role child', async () => {
    loadEnv('lifecycle-planner-step-e2e')
    cwd = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-planner-e2e-'))
    ctx = await bootProductionProfile({
      binName: 'lifecycle-planner-step-e2e',
      profile: 'headless',
      overlayPaths: [resolveConfigPath(BUNDLE_PATCH, undefined), resolveConfigPath(OVERLAY, undefined)],
    })
    handle = await ctx.agents.create({ sessionId: SessionId('lifecycle-planner-e2e'), meta: { cwd } })
    const { agent } = handle
    const signal = new AbortController().signal
    const call = (name: string, args: unknown) => ctx!.tools.execute({ signal, callId: ToolCallId(`e2e-${name}`), name, arguments: args, agent })

    const init = await call('lifecycle_init', { scaffold: 'full' })
    if (init.isError) throw new Error(init.error.message)
    await writeSeedReq(cwd)

    const run = await call('lifecycle_run', { reqId: SEED_REQ_ID, maxSteps: 1 })
    if (run.isError) throw new Error(run.error.message)
    const value = run.value
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('the run result is not an object')
    const steps = value.steps
    if (!Array.isArray(steps) || steps.length !== 1) throw new Error(`expected one step, got ${JSON.stringify(steps)}`)
    const [step] = steps
    if (typeof step !== 'object' || step === null || Array.isArray(step)) throw new Error('the step is not an object')
    expect(step).toMatchObject({ uid: 'planner-001', role: 'planner', state: 'req_review' })
    expect(['applied', 'rejected']).toContain(step.outcome)
    if (step.outcome === 'applied') {
      expect(LEGAL_FROM_PLANNER_REVIEW).toContain(step.transition)
      expect(value.stopped).toBe('max-steps')
    }
    const phases = agent.session.snapshotEvents().filter(event => event.type === 'lifecycle/step').map(event => (event.data as { phase: string }).phase)
    expect(phases[0]).toBe('started')
    expect(['completed', 'rejected']).toContain(phases[1])
  }, 600_000)
})
