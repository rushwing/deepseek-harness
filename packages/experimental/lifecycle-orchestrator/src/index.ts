/**
 * Lifecycle team orchestrator: `ctx.lifecycle` reads a workspace's lifecycle
 * tables and artifacts, lints them, checks role hand-overs, and lists the
 * legal transitions of a REQ; the `lifecycle_*` tools, the `/lifecycle`
 * command, and the `lifecycle:policy` prompt section expose it to models and
 * users. The plugin default-exports the service class.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ArtifactGraph } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import { bannedPhrasesIn, parseBriefs, type Briefs } from './briefs/parse.ts'
import { LifecycleError } from './errors.ts'
import { renderLint, renderStatus } from './render.ts'
import { policyText } from './section.ts'
import { checkInTool, lintTool, statusTool } from './tools.ts'
import { runLifecycle, type RunRequest, type RunResult } from './driver.ts'
import { initTool } from './tools/init.ts'
import { runTool } from './tools/run.ts'
import { transitionTool } from './tools/transition.ts'
import { WriteGuard } from './write-guard.ts'
import {
  applyStep,
  checkIn,
  graphOf,
  legalTransitions,
  lintWorkspace,
  loadTables,
  statusOf,
  type CheckInRequest,
  type CheckInResult,
  type LegalTransition,
  type LifecycleLoad,
  type LifecycleStatus,
  type LintReport,
  type TransitionRequest,
  type TransitionResult,
} from './workspace.ts'

export { BANNED_PHRASES, bannedPhrasesIn, parseBriefs, type BriefText, type Briefs, type BriefsParse, type SharedBriefText } from './briefs/parse.ts'
export { renderBrief, type BriefRequest } from './briefs/render.ts'
export { BRIEFS } from './defaults/briefs.ts'
export { GUIDE, STANDARDS } from './defaults/standards.ts'
export { ARTIFACT_CONTRACT, LIFECYCLE_TABLE } from './defaults/tables.ts'
export { LifecycleError, type LifecycleErrorCode } from './errors.ts'
export { handlesOf, planRegistry, type Handles, type RegistryPlan, type SeatedRoute } from './tools/init.ts'
export type { LifecycleHumanDecisionEvent, LifecycleLintEvent, LifecycleStepEvent, LifecycleTransitionEvent } from './events.ts'
export { decisionsOf, isRecord, renderTransition, requireRoot, transitionEvent } from './tools/transition.ts'
export { actorOf, runLifecycle, type Actor, type DriverDeps, type RunRequest, type RunResult, type RunStep, type RunStop } from './driver.ts'
export { renderRun } from './tools/run.ts'
export { PROPOSAL_SCHEMA, parseProposal, type ParsedProposal, type Proposal } from './proposal.ts'
export { WRITE_KINDS, denialOf, unboundBug, writeScope, type WriteScope } from './scope.ts'
export { WriteGuard, type StepCell } from './write-guard.ts'
export { STOP, decideWithHuman, type HumanDecision, type HumanRequest } from './human.ts'
export { diffTree, restoreTree, snapshotTree, type Tree, type TreeDiff } from './tree.ts'
export type {
  CheckInRequest,
  CheckInResult,
  LegalTransition,
  LifecycleLoad,
  LifecycleStatus,
  LifecycleTables,
  LintReport,
  ReqStatus,
  TransitionRequest,
  TransitionResult,
} from './workspace.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    lifecycle: LifecycleService
  }
}

/** Where the lifecycle files live. */
export interface Config {
  /**
   * The directory, relative to the Session's working directory, that holds
   * `lifecycle.yml`, `agent-registry.yml`, `artifact-contract.yml`, and `tasks/`.
   */
  lifecycleDir: string
  /** The most steps one `lifecycle_run` takes; a call may only lower it. */
  maxStepsPerRun: number
  /** Tools denied to role children so a child never delegates; names absent from a deployment are ignored. */
  delegationToolNames: string[]
  /** `ask` uses the user-questions service when composed and stops otherwise; `stop` never asks. */
  humanDecisions: 'ask' | 'stop'
  /** Abort a role child after this long; the step fails and nothing is applied. */
  stepTimeoutMs: number
  /** `auto` requests structured output when the provider supports it, else reads the trailing fenced JSON; `text` always reads the text. */
  proposalChannel: 'auto' | 'text'
  /** The subagent provider that runs role children. */
  subagentProvider: string
}

const TABLE_FILE = 'lifecycle.yml'
const BRIEFS_FILE = 'standards/briefs.md'
const COMMAND = 'lifecycle'
const USAGE = 'Usage: /lifecycle status [REQ-ID] | lint [REQ-ID]'
const STATUS = 'status'
const LINT = 'lint'
const ALL = 'all'

/**
 * The lifecycle service and its registrations. Every method reads the files
 * under `<cwd>/<lifecycleDir>/` afresh; nothing is cached between calls.
 */
export class LifecycleService extends Service {
  static inject = ['tools', 'systemPrompt', 'subagents']

  /** Schemastery configuration of the orchestrator. */
  static Config = z.object({
    lifecycleDir: z.string().default('lifecycle'),
    maxStepsPerRun: z.number().step(1).min(1).default(8),
    delegationToolNames: z.array(z.string()).default(['subagent', 'workflow', 'ralph', 'spawn_teammate', 'send_message', 'interrupt_agent']),
    humanDecisions: z.union(['ask', 'stop']).default('ask'),
    stepTimeoutMs: z.number().step(1).min(1).default(1_800_000),
    proposalChannel: z.union(['auto', 'text']).default('auto'),
    subagentProvider: z.string().default('spawn'),
  })

  /** The lifecycle directory relative to a Session's working directory. */
  readonly dir: string

  /** The resolved configuration. */
  readonly config: Config

  private readonly guard: WriteGuard

  constructor(ctx: Context, config: Config) {
    if (config.lifecycleDir.trim() === '') throw new Error('lifecycleDir must name a directory relative to the Session working directory')
    if (config.subagentProvider.trim() === '') throw new Error('subagentProvider must name a registered subagent provider')
    if (config.delegationToolNames.some(name => name.trim() === '')) throw new Error('delegationToolNames must not contain a blank name')
    super(ctx, 'lifecycle')
    this.dir = config.lifecycleDir
    this.config = config
    this.guard = new WriteGuard(ctx)
    ctx.tools.register(initTool(this, ctx))
    ctx.tools.register(runTool(this))
    ctx.tools.register(statusTool(this))
    ctx.tools.register(checkInTool(this))
    ctx.tools.register(lintTool(this))
    ctx.tools.register(transitionTool(this))
    ctx.systemPrompt.section({
      name: 'lifecycle:policy',
      order: ctx.systemPrompt.getSectionOrder('LIFECYCLE_POLICY'),
      text: (context) => {
        const cwd = context.agent === undefined ? undefined : context.agent.session.header.cwd
        return cwd !== undefined && this.hasTables(cwd) ? policyText(this.dir) : ''
      },
    })
    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-experimental-lifecycle-orchestrator'),
        name: COMMAND,
        description: 'Show lifecycle status or lint the lifecycle artifacts',
        input: { hint: 'status [REQ-ID] | lint [REQ-ID]' },
        handler: ({ agent, rawInput }) => {
          const [verb = '', reqId, ...rest] = rawInput.trim().split(/\s+/).filter(word => word !== '')
          if ((verb !== STATUS && verb !== LINT) || rest.length > 0) return { kind: 'error', text: USAGE }
          const cwd = agent.session.header.cwd
          if (cwd === undefined) return { kind: 'error', text: `/${COMMAND} needs a Session with a working directory` }
          try {
            const text = verb === STATUS
              ? renderStatus(this.status(cwd, reqId))
              : renderLint(this.lint(cwd, reqId), reqId === undefined ? ALL : reqId)
            return { kind: 'success', text }
          } catch (error: unknown) {
            if (error instanceof LifecycleError) return { kind: 'error', text: error.message }
            throw error
          }
        },
      })
    })
  }

  /**
   * Whether the working directory carries a lifecycle table.
   * @param cwd - the absolute workspace directory.
   * @returns `true` when `<cwd>/<dir>/lifecycle.yml` exists.
   */
  hasTables(cwd: string): boolean {
    return existsSync(join(cwd, this.dir, TABLE_FILE))
  }

  /**
   * Load the role briefs of a workspace from `<dir>/standards/briefs.md`,
   * checked against the table's role states and, with the registry's agent
   * notes, scanned for the phrases the prompting gates forbid.
   * @param cwd - the absolute workspace directory.
   * @returns the briefs, or every problem (the tables' problems first).
   */
  briefs(cwd: string): { readonly briefs: Briefs | undefined; readonly problems: readonly string[] } {
    const load = this.load(cwd)
    if (load.tables === undefined) return { briefs: undefined, problems: load.problems }
    const label = `${this.dir}/${BRIEFS_FILE}`
    const path = join(load.root, ...BRIEFS_FILE.split('/'))
    if (!existsSync(path)) return { briefs: undefined, problems: [`${label}: missing`] }
    const parsed = parseBriefs(readFileSync(path, 'utf8'), load.tables.table, label)
    const problems = [...parsed.problems]
    for (const agent of load.tables.registry.agents) {
      for (const phrase of bannedPhrasesIn(agent.notes ?? '')) {
        problems.push(`${this.dir}/agent-registry.yml: ${String(agent.uid)} notes contain the banned phrase '${phrase}'`)
      }
    }
    return problems.length === 0 ? { briefs: parsed.briefs, problems: [] } : { briefs: undefined, problems }
  }

  /**
   * Load the four tables of a workspace.
   * @param cwd - the absolute workspace directory.
   * @returns the tables, or every problem that prevented them.
   */
  load(cwd: string): LifecycleLoad {
    return loadTables(cwd, this.dir)
  }

  /**
   * The artifact graph of a workspace.
   * @param cwd - the absolute workspace directory.
   * @returns the graph of `<dir>/tasks/`.
   * @throws `TABLES_INVALID` when the tables did not load.
   */
  graph(cwd: string): ArtifactGraph {
    return graphOf(this.load(cwd))
  }

  /**
   * Lint the workspace's artifacts.
   * @param cwd - the absolute workspace directory.
   * @param reqId - when given, keep only the violations of that REQ's files.
   * @returns the violations and their count per rule.
   * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
   */
  lint(cwd: string, reqId?: string): LintReport {
    return lintWorkspace(cwd, this.load(cwd), reqId)
  }

  /**
   * Run the hard-stop checks for one caller on one REQ.
   * @param cwd - the absolute workspace directory.
   * @param request - who checks in, on which REQ, in which state, for which transition.
   * @returns the three checks and the verdict.
   * @throws `TABLES_INVALID` or `UNKNOWN_TRANSITION`.
   */
  checkIn(cwd: string, request: CheckInRequest): CheckInResult {
    return checkIn(this.load(cwd), request)
  }

  /**
   * The transitions the current owner of a REQ may take.
   * @param cwd - the absolute workspace directory.
   * @param reqId - the REQ.
   * @returns the transitions in table order.
   * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
   */
  legalTransitions(cwd: string, reqId: string): LegalTransition[] {
    return legalTransitions(this.load(cwd), reqId)
  }

  /**
   * Apply one transition or lifecycle event to a REQ by hand: guards judged
   * on the current tree, effects written atomically, the step and the REQ
   * family linted, and every file restored when the result is red.
   * @param cwd - the absolute workspace directory.
   * @param request - the REQ, the step, the summary, and the decisions.
   * @returns what was applied, or the violations with nothing written.
   */
  transition(cwd: string, request: TransitionRequest): Promise<TransitionResult> {
    const load = this.load(cwd)
    return applyStep(cwd, load, graphOf(load), request)
  }

  /**
   * Drive one REQ through fresh role children from the agent's Session
   * working directory, logging every step, transition, and human decision
   * to the agent's Session.
   * @param agent - the root agent that drives; its Session must have a working directory.
   * @param request - the REQ and the optional step ceiling.
   * @param signal - abort cancels the running child and ends the run.
   * @returns the run report.
   * @throws LifecycleError `NO_WORKSPACE` without a working directory; the driver's own codes otherwise.
   */
  async run(agent: Agent, request: RunRequest, signal: AbortSignal): Promise<RunResult> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new LifecycleError('NO_WORKSPACE', 'lifecycle_run needs a Session with a working directory')
    return await runLifecycle({ ctx: this.ctx, service: this, config: this.config, guard: this.guard }, agent, cwd, request, signal)
  }

  /**
   * The lifecycle position of one REQ or of every REQ.
   * @param cwd - the absolute workspace directory.
   * @param reqId - when given, report that REQ only.
   * @returns the report.
   * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
   */
  status(cwd: string, reqId?: string): LifecycleStatus {
    return statusOf(this.load(cwd), reqId)
  }
}

export default LifecycleService
