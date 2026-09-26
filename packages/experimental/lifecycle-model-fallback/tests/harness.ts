import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmError, ReasoningEffortId, createUserMessage, resolveRetryPolicy, type GenerateOptions, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as fallback from '@deepseek-ai/dsh-experimental-lifecycle-model-fallback'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const TABLE_FIXTURES = fileURLToPath(new URL('../../lifecycle-table/tests/fixtures/', import.meta.url))
const roots: string[] = []
const contexts: Context[] = []

/** The efforts the Claude Code test route advertises. */
export const CLAUDE_EFFORTS = { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }, { id: ReasoningEffortId('xhigh'), name: 'Extra high' }] }

/** A response script entry that fails the request with a code. */
export function failWith(code: string): (options: GenerateOptions) => StreamChunk[] {
  return () => {
    throw new LlmError(`route down (${code})`, code)
  }
}

/** A mock adapter that also carries a same-route retry policy, for the llm-retry ordering test. */
export class RetryingMockAdapter extends MockAdapter {
  constructor(
    script: ConstructorParameters<typeof MockAdapter>[0],
    private readonly policy: ResolvedRetryPolicy | undefined,
    reasoning?: ConstructorParameters<typeof MockAdapter>[1],
  ) {
    super(script, reasoning)
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined {
    return this.policy
  }
}

/** A one-retry normal policy with a one-millisecond backoff. */
export function oneRetry(): ResolvedRetryPolicy {
  return resolveRetryPolicy(
    { mode: 'normal', maxRetries: 1, retryableCodes: ['SERVER'], backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } },
    'fallback test policy',
  )
}

/** A workspace whose `lifecycle/` holds the English table and registry fixtures. */
export async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-fallback-'))
  roots.push(root)
  await mkdir(join(root, 'lifecycle'), { recursive: true })
  for (const file of ['lifecycle.yml', 'agent-registry.yml']) await copyFile(join(TABLE_FIXTURES, file), join(root, 'lifecycle', file))
  return root
}

/** What a loop test starts from. */
export interface LoopSetup {
  readonly ctx: Context
  readonly claude: MockAdapter
  readonly codex: MockAdapter
  readonly root: string
}

/** Options of {@link setupLoop}. */
export interface LoopOptions {
  readonly claude?: MockAdapter
  readonly codex?: MockAdapter
  readonly config?: Record<string, unknown>
  /** Plugins mounted before the fallback, such as llm-retry. */
  readonly before?: (ctx: Context) => Promise<void>
}

/** The loop with two mock routes (`claude-code` with efforts, `codex` without) and the fallback plugin. */
export async function setupLoop(options: LoopOptions = {}): Promise<LoopSetup> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SubagentRuntime, {})
  await options.before?.(ctx)
  await ctx.plugin(fallback, { lifecycleDir: 'lifecycle', ...options.config })
  await ctx.plugin(AgentLoop, { agents: [] })
  const claude = options.claude ?? new MockAdapter([textResponse('done')], CLAUDE_EFFORTS)
  const codex = options.codex ?? new MockAdapter([textResponse('done')])
  ctx.llm.registerAdapter(['claude-code'], claude)
  ctx.llm.registerAdapter(['codex'], codex)
  return { ctx, claude, codex, root: await workspace() }
}

/** A child agent of the loop labeled as a lifecycle role child; `label: null` creates an unlabeled agent. */
export async function childAgent(setup: LoopSetup, label: string | null, id = 'lifecycle-child'): Promise<Agent> {
  const agent = await setup.ctx.agentLoop.create(SessionId(id), {
    provider: 'claude-code', model: 'opus', reasoningEffort: ReasoningEffortId('xhigh'),
  }, { cwd: setup.root })
  if (label !== null) agent.session.append('subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'spawn', label })
  return agent
}

/** Send one user turn and wait for the agent to go idle. */
export async function turn(agent: Agent, text = 'go'): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/** The provider, model, and effort of each request an adapter served. */
export function routesOf(adapter: MockAdapter): string[] {
  return adapter.requests.map(request => `${request.provider}/${request.model}${request.reasoningEffort === undefined ? '' : `@${String(request.reasoningEffort)}`}`)
}

/** The reason kind of the last `turn/end` event. */
export function lastTurnEnd(agent: Agent): string | undefined {
  const ends = agent.session.snapshotEvents().filter(event => event.type === 'turn/end')
  const last = ends.at(-1)
  return last === undefined ? undefined : (last.data as { reason: { kind: string } }).reason.kind
}

/** Dispose every context and remove every workspace. */
export async function cleanup(): Promise<void> {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
}
