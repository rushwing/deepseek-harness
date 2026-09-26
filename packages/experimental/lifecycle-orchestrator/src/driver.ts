/**
 * The deterministic driver behind `lifecycle_run`: one fresh role child per
 * step, its edits fenced to its write scope, its proposal judged and applied
 * by the tables, and the human deciding at the human-owned states. Files are
 * the only state: every step re-reads the tree, and a rejected or failed step
 * restores every byte it touched.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/driver
 */

import { posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  effortFor,
  transitionById,
  type AgentRegistry,
  type AgentRoute,
  type ReasoningEffort,
  type RegisteredAgent,
} from '@deepseek-ai/dsh-experimental-lifecycle-table'
import { textOf, type ArtifactGraph } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { delegationDepthOf, type SubagentProvider, type SubagentResult, type SubagentRun, type SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { Briefs } from './briefs/parse.ts'
import { renderBrief } from './briefs/render.ts'
import { LifecycleError } from './errors.ts'
import type { LifecycleHumanDecisionEvent, LifecycleStepEvent } from './events.ts'
import { decideWithHuman } from './human.ts'
import type { Config, LifecycleService } from './index.ts'
import { PROPOSAL_SCHEMA, parseProposal, type Proposal } from './proposal.ts'
import { denialOf, unboundBug, writeScope, type WriteScope } from './scope.ts'
import { transitionEvent } from './tools/transition.ts'
import { diffTree, restoreTree, snapshotTree, type Tree } from './tree.ts'
import type { WriteGuard } from './write-guard.ts'
import {
  applyStep,
  graphOf,
  legalTransitionsOf,
  lintWorkspace,
  requireReq,
  requireTables,
  roleOf,
  violationText,
  type LegalTransition,
  type LifecycleLoad,
  type LifecycleTables,
} from './workspace.ts'

/** What `lifecycle_run` is asked to do. */
export interface RunRequest {
  readonly reqId: string
  /** A ceiling below the configured `maxStepsPerRun`; a higher value is capped. */
  readonly maxSteps?: number | undefined
}

/** Why a run ended. */
export type RunStop = 'done' | 'blocked' | 'needs-human' | 'rejected' | 'lint-red' | 'max-steps' | 'failed'

/** One step the run took, by a role child or by the human. */
export interface RunStep {
  readonly uid: string
  readonly role: string
  readonly state: string
  /** The transition id or event name proposed; `null` when the child proposed none. */
  readonly transition: string | null
  readonly outcome: 'applied' | 'rejected' | 'failed'
  readonly reason: string | null
}

/** The run report. */
export interface RunResult {
  readonly reqId: string
  readonly steps: RunStep[]
  readonly stopped: RunStop
  /** The human-owned state and its legal transitions when the run stopped for a decision. */
  readonly pendingHuman: { readonly state: string; readonly options: string[] } | null
  /** Lint violations of a `lint-red` stop, or the problems of the rejecting or failing step. */
  readonly violations: string[]
}

/** What the driver composes. */
export interface DriverDeps {
  readonly ctx: Context
  readonly service: LifecycleService
  readonly config: Config
  readonly guard: WriteGuard
}

/** A registered role agent with the route and effort the registry loader guarantees for a role. */
export interface Actor {
  readonly agent: RegisteredAgent
  readonly route: AgentRoute
  readonly effort: ReasoningEffort
}

interface Run {
  readonly deps: DriverDeps
  readonly agent: Agent
  readonly cwd: string
  readonly load: LifecycleLoad
  readonly tables: LifecycleTables
  readonly provider: SubagentProvider
  readonly briefs: Briefs
  readonly tasksDir: string
  readonly signal: AbortSignal
  readonly reqId: string
  readonly steps: RunStep[]
}

type Outcome =
  | { readonly kind: 'applied'; readonly step: RunStep }
  | { readonly kind: 'stopped'; readonly stopped: 'rejected' | 'failed'; readonly step: RunStep; readonly violations: string[] }
  | { readonly kind: 'pending'; readonly pendingHuman: { readonly state: string; readonly options: string[] } }

interface ChildOutcome {
  readonly childId: string
  readonly result: SubagentResult
  readonly timedOut: boolean
}

interface StepIdentity {
  readonly reqId: string
  readonly uid: string
  readonly role: string
  readonly state: string
  readonly provider: string
  readonly route: { readonly provider: string; readonly model: string }
  readonly effort: string
}

const HUMAN = 'human'
const DONE = 'done'
const BLOCKED = 'blocked'
const TASKS = 'tasks'
const BUGS = 'bugs'
const COMPLETED = 'completed'
/** The orchestrator's own tools a role child never sees. */
const OWN_TOOLS: readonly string[] = ['lifecycle_run', 'lifecycle_transition', 'lifecycle_init']

/**
 * The registered agent behind a REQ owner, with the route and effort the
 * registry loader requires of every non-human role.
 * @param registry - the loaded registry.
 * @param uid - the owner uid.
 * @param state - the REQ state, which selects the per-state effort.
 * @returns the actor.
 * @throws LifecycleError `TABLES_INVALID` for an unregistered uid, a human, or an agent without an effort for the state.
 */
export function actorOf(registry: AgentRegistry, uid: string, state: string): Actor {
  const agent = registry.agents.find(entry => String(entry.uid) === uid)
  if (agent === undefined || agent.route === undefined) {
    throw new LifecycleError('TABLES_INVALID', `${uid} is not a registered role agent with a route`)
  }
  const effort = effortFor(agent, state)
  /* v8 ignore next -- the registry loader requires a default effort for every role agent */
  if (effort === undefined) throw new LifecycleError('TABLES_INVALID', `${uid} declares no reasoning effort for ${state}`)
  return { agent, route: agent.route, effort }
}

function requireProvider(ctx: Context, name: string): SubagentProvider {
  const provider = ctx.subagents.getProvider(name)
  if (provider === undefined) {
    throw new LifecycleError('NO_PROVIDER', `subagent provider ${name} is not registered; lifecycle_run spawns role children through it`)
  }
  return provider
}

function requireBriefs(service: LifecycleService, cwd: string): Briefs {
  const parsed = service.briefs(cwd)
  if (parsed.briefs === undefined) {
    throw new LifecycleError('NO_BRIEF', `${service.dir}/standards/briefs.md does not parse: ${parsed.problems.join('; ')}`)
  }
  return parsed.briefs
}

function finish(run: Run, stopped: RunStop, extra: Partial<Pick<RunResult, 'pendingHuman' | 'violations'>> = {}): RunResult {
  return { reqId: run.reqId, steps: run.steps, stopped, pendingHuman: null, violations: [], ...extra }
}

function stepEvent(identity: StepIdentity, childSessionId: string | null, phase: LifecycleStepEvent['phase'], reason: string | null): LifecycleStepEvent {
  return { version: 1, ...identity, childSessionId, phase, reason }
}

function agentOptionsOf(actor: Actor): AgentOptions {
  return { provider: actor.route.provider, model: actor.route.model, reasoningEffort: brandString<ReasoningEffortId>(actor.effort) }
}

/**
 * Drive one REQ: fresh role children step it forward until it is done,
 * blocked, waiting on the human, rejected, red, failed, or at the step ceiling.
 * @param deps - the composed services and configuration.
 * @param agent - the root agent whose Session logs the run.
 * @param cwd - the absolute workspace directory.
 * @param request - the REQ and the optional step ceiling.
 * @param signal - abort cancels the running child and ends the run.
 * @returns the run report.
 * @throws LifecycleError for invalid tables, an unknown REQ, a missing provider or briefs, or an invalid ceiling.
 */
export async function runLifecycle(
  deps: DriverDeps, agent: Agent, cwd: string, request: RunRequest, signal: AbortSignal,
): Promise<RunResult> {
  const { config, service } = deps
  if (request.maxSteps !== undefined && (!Number.isInteger(request.maxSteps) || request.maxSteps < 1)) {
    throw new LifecycleError('INVALID_REQUEST', 'maxSteps must be a positive integer')
  }
  const load = service.load(cwd)
  const tables = requireTables(load)
  const provider = requireProvider(deps.ctx, config.subagentProvider)
  const briefs = requireBriefs(service, cwd)
  const ceiling = request.maxSteps === undefined ? config.maxStepsPerRun : Math.min(config.maxStepsPerRun, request.maxSteps)
  const run: Run = {
    deps, agent, cwd, load, tables, provider, briefs, tasksDir: posix.join(service.dir, TASKS), signal, reqId: request.reqId, steps: [],
  }
  while (run.steps.length < ceiling) {
    const pre = graphOf(load)
    const req = requireReq(pre, request.reqId)
    if (req.status === DONE) return finish(run, 'done')
    if (req.status === BLOCKED) return finish(run, 'blocked')
    const red = lintWorkspace(cwd, load, request.reqId).violations.map(violationText)
    if (red.length > 0) return finish(run, 'lint-red', { violations: red })
    const owner = textOf(req.fm.owner)
    const role = roleOf(tables.registry, owner)
    const legal = legalTransitionsOf(tables, req)
    const outcome = role === HUMAN
      ? await humanStep(run, pre, req.status, owner, legal)
      : await roleStep(run, pre, req.status, owner, role, legal)
    if (outcome.kind === 'pending') return finish(run, 'needs-human', { pendingHuman: outcome.pendingHuman })
    run.steps.push(outcome.step)
    if (outcome.kind === 'stopped') return finish(run, outcome.stopped, { violations: outcome.violations })
  }
  return finish(run, 'max-steps')
}

async function humanStep(run: Run, pre: ArtifactGraph, state: string, owner: string, legal: readonly LegalTransition[]): Promise<Outcome> {
  const options = legal.map(transition => transition.id)
  const decisionEvent = (phase: LifecycleHumanDecisionEvent['phase'], answer: string | null): LifecycleHumanDecisionEvent => (
    { version: 1, reqId: run.reqId, state, options, phase, answer }
  )
  run.agent.session.append('lifecycle/human-decision', decisionEvent('requested', null))
  const decision = await decideWithHuman(
    run.deps.ctx, run.deps.config.humanDecisions, run.agent, { reqId: run.reqId, state, options: legal }, run.signal,
  )
  switch (decision.kind) {
    case 'unavailable':
      run.agent.session.append('lifecycle/human-decision', decisionEvent('unavailable', null))
      return { kind: 'pending', pendingHuman: { state, options } }
    case 'stop':
      run.agent.session.append('lifecycle/human-decision', decisionEvent('answered', decision.answer))
      return { kind: 'pending', pendingHuman: { state, options } }
    case 'transition': {
      run.agent.session.append('lifecycle/human-decision', decisionEvent('answered', decision.id))
      const result = await applyStep(run.cwd, run.load, pre, { reqId: run.reqId, transition: decision.id, summary: `Decided by ${owner}` })
      if (!result.applied) {
        const reason = result.violations.join('; ')
        const step: RunStep = { uid: owner, role: HUMAN, state, transition: decision.id, outcome: 'rejected', reason }
        return { kind: 'stopped', stopped: 'rejected', step, violations: result.violations }
      }
      run.agent.session.append('lifecycle/transition', transitionEvent(result))
      return { kind: 'applied', step: { uid: owner, role: HUMAN, state, transition: decision.id, outcome: 'applied', reason: null } }
    }
    /* v8 ignore next 2 -- closed-union exhaustiveness guard */
    default:
      return assertNever(decision)
  }
}

function nameProblems(tables: LifecycleTables, proposal: Proposal): string[] {
  const problems: string[] = []
  if (proposal.transition !== undefined && transitionById(tables.table, proposal.transition) === undefined) {
    problems.push(`${proposal.transition} is not a transition of the lifecycle table`)
  }
  if (proposal.event !== undefined && tables.table.events[proposal.event] === undefined) {
    problems.push(`${proposal.event} is not an event of the lifecycle table`)
  }
  return problems
}

function scopeProblems(run: Run, scope: WriteScope, pre: ArtifactGraph, before: Tree, after: Tree): string[] {
  const diff = diffTree(before, after)
  const touched = [...diff.changed, ...diff.added, ...diff.deleted]
  const problems = touched.flatMap((label) => {
    const denial = denialOf(scope, label, run.tasksDir, pre)
    return denial === undefined ? [] : [denial]
  })
  const newBugs = diff.added.filter(label => label.startsWith(`${run.tasksDir}/${BUGS}/`))
    .filter(label => denialOf(scope, label, run.tasksDir, pre) === undefined)
  if (newBugs.length > 0) {
    const post = graphOf(run.load)
    for (const label of newBugs) {
      const problem = unboundBug(post, label, run.reqId)
      if (problem !== undefined) problems.push(problem)
    }
  }
  return problems
}

async function runChild(run: Run, actor: Actor, brief: string, scope: WriteScope, pre: ArtifactGraph): Promise<ChildOutcome> {
  const { deps, agent, cwd, tasksDir, signal } = run
  const caps = run.provider.capabilities
  // The step ends with the run's abort or the configured timeout, whichever comes first.
  const stepSignal = AbortSignal.any([signal, AbortSignal.timeout(deps.config.stepTimeoutMs)])
  const request: SubagentStartRequest = {
    label: `lifecycle:${String(actor.agent.uid)}@${scope.state}:${scope.reqId}`,
    prompt: [{ type: 'text', text: brief }],
    parent: agent,
    signal: stepSignal,
    ...(caps.agentOptions ? { agentOptions: agentOptionsOf(actor) } : {}),
    ...(caps.toolFilter ? { toolFilter: { deny: [...deps.config.delegationToolNames, ...OWN_TOOLS] } } : {}),
    ...(caps.depthLimit ? { maxDepth: delegationDepthOf(agent) + 1 } : {}),
    ...(caps.outputSchema && deps.config.proposalChannel === 'auto' ? { outputSchema: PROPOSAL_SCHEMA } : {}),
  }
  let child: SubagentRun | undefined
  const close = deps.guard.open(String(agent.id), { cwd, tasksDir, scope, pre })
  try {
    child = await deps.ctx.subagents.start(run.provider.name, request)
    const result = await child.result
    return { childId: String(child.id), result, timedOut: stepSignal.aborted && !signal.aborted }
  } finally {
    close()
    await child?.dispose()
  }
}

async function roleStep(
  run: Run, pre: ArtifactGraph, state: string, owner: string, role: string, legal: readonly LegalTransition[],
): Promise<Outcome> {
  const { deps, agent, cwd, tasksDir, reqId } = run
  const actor = actorOf(run.tables.registry, owner, state)
  const identity: StepIdentity = {
    reqId,
    uid: owner,
    role,
    state,
    provider: run.provider.name,
    route: { provider: actor.route.provider, model: actor.route.model },
    effort: actor.effort,
  }
  const brief = renderBrief(run.briefs, {
    role,
    state,
    reqId,
    uid: owner,
    legalTransitions: legal.map(transition => transition.id),
    lifecycleDir: deps.service.dir,
    notes: actor.agent.notes,
  })
  agent.session.append('lifecycle/step', stepEvent(identity, null, 'started', null))
  const before = await snapshotTree(cwd, tasksDir)
  const scope = writeScope(role, state, reqId)
  const child = await runChild(run, actor, brief, scope, pre)
  const step = (transition: string | null, outcome: RunStep['outcome'], reason: string | null): RunStep => (
    { uid: owner, role, state, transition, outcome, reason }
  )
  type Phase = 'rejected' | 'failed'
  const reject = async (problems: string[], transition: string | null, phase: Phase = 'rejected'): Promise<Outcome> => {
    await restoreTree(cwd, before, await snapshotTree(cwd, tasksDir))
    const reason = problems.join('; ')
    agent.session.append('lifecycle/step', stepEvent(identity, child.childId, phase, reason))
    return { kind: 'stopped', stopped: phase, step: step(transition, phase, reason), violations: problems }
  }
  if (child.result.stopReason !== COMPLETED) {
    const timing = child.timedOut ? ` after ${String(deps.config.stepTimeoutMs)} ms` : ''
    return reject([`the child stopped with ${child.result.stopReason}${timing}`], null, 'failed')
  }
  const parsed = parseProposal(child.result)
  if (!parsed.ok) return reject([parsed.problem], null)
  const { proposal } = parsed
  const proposed = proposal.transition === undefined ? String(proposal.event) : proposal.transition
  const after = await snapshotTree(cwd, tasksDir)
  const problems = [...nameProblems(run.tables, proposal), ...scopeProblems(run, scope, pre, before, after)]
  if (problems.length > 0) return reject(problems, proposed)
  const applied = await applyStep(cwd, run.load, pre, {
    reqId,
    transition: proposal.transition,
    event: proposal.event,
    summary: proposal.summary,
    decisions: proposal.decisions,
    pr: proposal.pr,
  })
  if (!applied.applied) return reject(applied.violations, proposed)
  agent.session.append('lifecycle/transition', transitionEvent(applied))
  agent.session.append('lifecycle/step', stepEvent(identity, child.childId, 'completed', null))
  return { kind: 'applied', step: step(applied.id, 'applied', null) }
}
