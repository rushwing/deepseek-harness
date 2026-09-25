import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  type AgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { INTERACTIVE_THREAD_PERMISSION_PARAMS, threadPermissionParams } from '@deepseek-ai/dsh-codex-app-server'
import {
  LlmError,
  ReasoningEffortId,
  createAssistantMessage,
  createUserMessage,
  markAgentLoopRequest,
  type GenerateOptions,
  type RequestMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import {
  CodexAppServerHost,
  CodexBackendAdapter,
  Config,
  ThreadRegistry,
  codexThreadProjection,
  createServerRequestHandler,
  resolveCodexBackendSpec,
} from '@deepseek-ai/dsh-experimental-llm-codex'
import { completeHandshake, fakeSpawner, type FakeChild, type FakeSpawner, type JsonObject } from './fake-app-server.ts'

const user = (text: string): RequestMessage =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistant = (text: string): RequestMessage =>
  createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'codex', model: 'gpt-5.6-sol' } })

interface Fixture {
  readonly ctx: Context
  readonly harness: AgentLoopTestHarness
  readonly spawner: FakeSpawner
  readonly host: CodexAppServerHost
  readonly threads: ThreadRegistry
  readonly adapter: CodexBackendAdapter
  readonly approvals: string[]
}

const fixtures: Fixture[] = []

interface FixtureOptions {
  readonly turnIdleTimeoutMs?: number
  readonly approve?: 'allowed-once' | 'rejected'
  /** Leave the codexThread projection unregistered. */
  readonly withoutProjection?: true
  /** Replace the projection reader the adapter consults. */
  readonly projections?: Pick<SessionProjectionRegistry, 'stateOf'>
  /** Replace the spawn operation the host calls. */
  readonly spawn?: FakeSpawner['spawn']
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  if (options.withoutProjection === undefined) ctx.sessionProjections.register(codexThreadProjection)
  const spec = resolveCodexBackendSpec(new Config({
    routes: { codex: {}, 'codex-unattended': { permissionMode: 'never' } },
    disposeGraceMs: 50,
    ...options.turnIdleTimeoutMs === undefined ? {} : { turnIdleTimeoutMs: options.turnIdleTimeoutMs },
  }))
  const spawner = fakeSpawner()
  const threads = new ThreadRegistry()
  const approvals: string[] = []
  const host = new CodexAppServerHost({
    spawn: options.spawn ?? spawner.spawn,
    cwd: '/host',
    env: spec.env,
    disposeGraceMs: spec.disposeGraceMs,
    handler: createServerRequestHandler(threads, {
      approval: {
        request: async (request) => {
          approvals.push(`${request.toolName}:${request.reason ?? ''}`)
          return options.approve ?? 'allowed-once'
        },
      },
      userQuestions: { ask: async () => ({ answers: [] }) },
    }),
    stderr: () => {},
  })
  const adapter = new CodexBackendAdapter({
    spec,
    host,
    threads,
    cwd: '/host',
    agents: ctx.agents,
    projections: options.projections ?? ctx.sessionProjections,
  })
  const created: Fixture = { ctx, harness, spawner, host, threads, adapter, approvals }
  fixtures.push(created)
  return created
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.host.dispose()
    await f.ctx.fiber.dispose()
  }
})

/** Read a stream incrementally: wait for a chunk, then drain the rest. */
function reader(stream: AsyncIterable<StreamChunk>): {
  until(predicate: (chunk: StreamChunk) => boolean): Promise<void>
  rest(): Promise<StreamChunk[]>
} {
  const iterator = stream[Symbol.asyncIterator]()
  const chunks: StreamChunk[] = []
  return {
    async until(predicate) {
      for (;;) {
        const next = await iterator.next()
        if (next.done === true) throw new Error('stream ended before the awaited chunk')
        chunks.push(next.value)
        if (predicate(next.value)) return
      }
    },
    async rest() {
      for (;;) {
        const next = await iterator.next()
        if (next.done === true) return chunks
        chunks.push(next.value)
      }
    },
  }
}

/** End the fake process and wait until the host has observed its exit. */
async function exit(child: FakeChild): Promise<void> {
  child.settle({ exitCode: 1, signal: null })
  await child.handle.done
}

async function agentAt(f: Fixture, id: string, cwd = '/work'): Promise<Agent> {
  return f.harness.create(SessionId(id), { provider: 'codex', model: 'gpt-5.6-sol' }, { cwd })
}

function loopRequest(agent: Agent, messages: RequestMessage[], extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return markAgentLoopRequest({
    provider: 'codex',
    model: 'gpt-5.6-sol',
    messages,
    sessionId: agent.id,
    ...extra,
  })
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function text(chunks: readonly StreamChunk[]): string {
  return chunks.map(chunk => (chunk.type === 'text-delta' ? chunk.text : '')).join('')
}

function reasoning(chunks: readonly StreamChunk[]): string {
  return chunks.map(chunk => (chunk.type === 'reasoning-delta' ? chunk.text : '')).join('')
}

function finish(chunks: readonly StreamChunk[]): StreamChunk & { type: 'finish' } {
  const last = chunks.at(-1)
  if (last?.type !== 'finish') throw new Error(`stream ended without finish: ${JSON.stringify(last)}`)
  return last
}

/** Answer thread/start with a fresh thread id and return the request frame. */
async function answerThreadStart(child: FakeChild, threadId: string): Promise<JsonObject> {
  const frame = await child.peer.nextMethod('thread/start')
  child.peer.respond(frame, { thread: { id: threadId } })
  return frame
}

async function answerThreadResume(child: FakeChild, threadId: string): Promise<JsonObject> {
  const frame = await child.peer.nextMethod('thread/resume')
  child.peer.respond(frame, { thread: { id: threadId } })
  return frame
}

async function answerTurnStart(child: FakeChild, threadId: string, turnId: string): Promise<JsonObject> {
  const frame = await child.peer.nextMethod('turn/start')
  child.peer.respond(frame, { turn: { id: turnId, status: 'inProgress' } })
  child.peer.notify('turn/started', { threadId, turn: { id: turnId } })
  return frame
}

function completeTurn(child: FakeChild, threadId: string, turnId: string, extra: JsonObject = {}): void {
  child.peer.notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', error: null, ...extra } })
}

describe('CodexBackendAdapter catalog', () => {
  it('describes each configured route and lists the visible Codex models with their efforts', async () => {
    const f = await fixture()
    expect(f.adapter.providerInfo('codex')).toEqual({ id: 'codex', name: 'Codex' })
    expect(f.adapter.providerInfo('codex-unattended')).toEqual({ id: 'codex-unattended', name: 'Codex (codex-unattended)' })
    const listing = f.adapter.listModels('codex')
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    const account = await child.peer.nextMethod('account/read')
    child.peer.respond(account, { account: { type: 'chatgpt', email: 'dev@example.com' }, requiresOpenaiAuth: true })
    const list = await child.peer.nextMethod('model/list')
    child.peer.respond(list, {
      data: [
        {
          id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', description: 'Best for coding', hidden: false, isDefault: true,
          defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }],
          inputModalities: ['text', 'image'],
        },
        {
          id: 'gpt-5.6-mini', displayName: 'GPT-5.6 Mini', description: '', hidden: false, isDefault: false,
          defaultReasoningEffort: 'medium', supportedReasoningEfforts: [], inputModalities: ['text'],
        },
      ],
      nextCursor: null,
    })
    expect(await listing).toEqual([
      { provider: 'codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Best for coding', inputModalities: ['text'] },
      { provider: 'codex', id: 'gpt-5.6-mini', name: 'GPT-5.6 Mini', inputModalities: ['text'] },
    ])
    const resolved = await f.adapter.resolveModel('codex', 'gpt-5.6-sol')
    expect(resolved).toEqual({
      provider: 'codex',
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      description: 'Best for coding',
      inputModalities: ['text'],
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('medium'), name: 'medium' },
          { id: ReasoningEffortId('high'), name: 'high' },
          { id: ReasoningEffortId('xhigh'), name: 'xhigh' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
    expect(await f.adapter.resolveModel('codex', 'gpt-5.6-mini')).toEqual({
      provider: 'codex',
      id: 'gpt-5.6-mini',
      name: 'GPT-5.6 Mini',
      inputModalities: ['text'],
    })
    expect(await f.adapter.resolveModel('codex-unattended', 'gpt-5.6-other')).toEqual({
      provider: 'codex-unattended',
      id: 'gpt-5.6-other',
      name: 'gpt-5.6-other',
      inputModalities: ['text'],
    })
    expect(f.spawner.children).toHaveLength(1)
  })

  it('refuses the catalog with MISSING_CREDENTIAL when Codex has no signed-in account', async () => {
    const f = await fixture()
    const listing = f.adapter.listModels('codex')
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    child.peer.respond(await child.peer.nextMethod('account/read'), { account: null, requiresOpenaiAuth: true })
    const error = await listing.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).failure.code).toBe('MISSING_CREDENTIAL')
    expect((error as LlmError).message).toContain('codex login')
  })
})

describe('CodexBackendAdapter turns', () => {
  it('starts a thread in the Session workspace on the first turn, binds it, and streams the answer', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1', '/work')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('hello')], { reasoningEffort: ReasoningEffortId('high') })))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    const start = await answerThreadStart(child, 'thread-1')
    expect(start.params).toEqual({
      cwd: '/work',
      ephemeral: false,
      model: 'gpt-5.6-sol',
      ...INTERACTIVE_THREAD_PERMISSION_PARAMS,
    })
    const turn = await answerTurnStart(child, 'thread-1', 'turn-1')
    expect(turn.params).toEqual({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      model: 'gpt-5.6-sol',
      effort: 'high',
    })
    child.peer.notify('item/reasoning/textDelta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'r1', delta: 'thinking…' })
    child.peer.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'm1', delta: 'Hi ' })
    child.peer.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'm1', delta: 'there' })
    child.peer.notify('thread/tokenUsage/updated', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tokenUsage: {
        last: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, reasoningOutputTokens: 5, totalTokens: 150 },
        total: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, reasoningOutputTokens: 5, totalTokens: 150 },
      },
    })
    completeTurn(child, 'thread-1', 'turn-1')
    const chunks = await collecting
    expect(reasoning(chunks)).toBe('thinking…')
    expect(text(chunks)).toBe('Hi there')
    expect(chunks.find(chunk => chunk.type === 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 100, outputTokens: 30, totalTokens: 150, cacheReadTokens: 20, reasoningTokens: 5 },
    })
    expect(finish(chunks).reason).toEqual({ kind: 'stop' })
    expect(f.ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toEqual({
      conversationId: 'thread-1',
      cwd: '/work',
      model: 'gpt-5.6-sol',
    })
    expect(f.host.threadIsLive('thread-1')).toBe(true)
    expect(f.threads.get('thread-1')).toBeUndefined()
  })

  it('sends only the new user input on a later turn of a live thread', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const first = collect(f.adapter.stream(loopRequest(agent, [user('one')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    completeTurn(child, 'thread-1', 'turn-1')
    await first
    const second = collect(f.adapter.stream(loopRequest(agent, [user('one'), assistant('reply'), user('two'), user('three')])))
    const turn = await answerTurnStart(child, 'thread-1', 'turn-2')
    expect(turn.params).toMatchObject({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'two', text_elements: [] }, { type: 'text', text: 'three', text_elements: [] }],
    })
    completeTurn(child, 'thread-1', 'turn-2')
    await second
    expect(child.peer.pending().filter(frame => frame.method === 'thread/start' || frame.method === 'thread/resume')).toEqual([])
  })

  it('resumes the bound thread after the app-server restarts and fails loud when Codex no longer has it', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const first = collect(f.adapter.stream(loopRequest(agent, [user('one')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    completeTurn(child, 'thread-1', 'turn-1')
    await first
    await exit(child)

    const second = collect(f.adapter.stream(loopRequest(agent, [user('one'), assistant('reply'), user('two')])))
    const replacement = await f.spawner.nextChild()
    await completeHandshake(replacement)
    const resume = await answerThreadResume(replacement, 'thread-1')
    expect(resume.params).toEqual({ threadId: 'thread-1', cwd: '/work', model: 'gpt-5.6-sol', ...INTERACTIVE_THREAD_PERMISSION_PARAMS })
    await answerTurnStart(replacement, 'thread-1', 'turn-2')
    completeTurn(replacement, 'thread-1', 'turn-2')
    expect(finish(await second).reason).toEqual({ kind: 'stop' })
    await exit(replacement)

    const third = collect(f.adapter.stream(loopRequest(agent, [user('three')])))
    const last = await f.spawner.nextChild()
    await completeHandshake(last)
    last.peer.respondError(await last.peer.nextMethod('thread/resume'), -32600, 'thread not found: thread-1')
    const outcome = finish(await third).reason
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.failure.code).toBe('PRODUCT_CONVERSATION_MISSING')
      expect(outcome.failure.message).toContain('thread-1')
      expect(outcome.failure.message).toContain('thread not found')
    }
    expect(last.peer.pending().filter(frame => frame.method === 'thread/start')).toEqual([])
    expect(f.ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toMatchObject({ conversationId: 'thread-1' })
  })

  it('runs auxiliary and session-less requests on an ephemeral thread without touching the binding', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const titling = collect(f.adapter.stream(loopRequest(agent, [user('title this')], { purpose: 'session-title' })))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    const start = await answerThreadStart(child, 'ephemeral-1')
    expect(start.params).toMatchObject({ cwd: '/work', ephemeral: true })
    await answerTurnStart(child, 'ephemeral-1', 'turn-e1')
    child.peer.notify('item/agentMessage/delta', { threadId: 'ephemeral-1', turnId: 'turn-e1', itemId: 'm', delta: 'A title' })
    completeTurn(child, 'ephemeral-1', 'turn-e1')
    expect(text(await titling)).toBe('A title')
    expect(f.ctx.sessionProjections.stateOf(agent.session, 'codexThread')).toBeNull()

    const oneShot = collect(f.adapter.stream({ provider: 'codex', model: 'gpt-5.6-sol', messages: [user('no session')] }))
    const bare = await answerThreadStart(child, 'ephemeral-2')
    expect(bare.params).toMatchObject({ cwd: '/host', ephemeral: true })
    await answerTurnStart(child, 'ephemeral-2', 'turn-e2')
    completeTurn(child, 'ephemeral-2', 'turn-e2')
    expect(finish(await oneShot).reason).toEqual({ kind: 'stop' })
  })

  it('interrupts the Codex turn when the request aborts and finishes as aborted', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const controller = new AbortController()
    const output = reader(f.adapter.stream(loopRequest(agent, [user('long task')], { signal: controller.signal })))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    child.peer.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'm', delta: 'partial' })
    await output.until(chunk => chunk.type === 'text-delta')
    controller.abort(new Error('user cancelled'))
    const interrupt = await child.peer.nextMethod('turn/interrupt')
    expect(interrupt.params).toEqual({ threadId: 'thread-1', turnId: 'turn-1' })
    child.peer.respond(interrupt, {})
    child.peer.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', error: null } })
    const chunks = await output.rest()
    expect(text(chunks)).toBe('partial')
    expect(finish(chunks).reason).toEqual({ kind: 'aborted', failure: { message: 'user cancelled', code: 'ABORTED' } })
    expect(f.threads.get('thread-1')).toBeUndefined()
  })

  it('interrupts as soon as the turn id is known when the abort arrives before turn/start answers', async () => {
    const f = await fixture({ turnIdleTimeoutMs: 20 })
    const agent = await agentAt(f, 'session-1')
    const controller = new AbortController()
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')], { signal: controller.signal })))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    const start = await child.peer.nextMethod('turn/start')
    controller.abort(new Error('too slow'))
    // The idle timer fires while the abort is already pending; the first stop request wins.
    await new Promise<void>((resolve) => { setTimeout(resolve, 40) })
    child.peer.respond(start, { turn: { id: 'turn-1', status: 'inProgress' } })
    const interrupt = await child.peer.nextMethod('turn/interrupt')
    expect(interrupt.params).toEqual({ threadId: 'thread-1', turnId: 'turn-1' })
    child.peer.respond(interrupt, {})
    child.peer.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', error: null } })
    expect(finish(await collecting).reason).toEqual({ kind: 'aborted', failure: { message: 'too slow', code: 'ABORTED' } })
  })

  it('maps a failed turn to an error finish carrying the Codex failure category', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    child.peer.notify('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'failed', error: { message: 'usage limit reached', codexErrorInfo: 'usageLimitExceeded' } },
    })
    const reason = finish(await collecting).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') {
      expect(reason.failure.code).toBe('RATE_LIMIT')
      expect(reason.failure.message).toBe('usage limit reached')
    }
  })

  it('reports a context-window failure as a max-tokens finish', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    child.peer.notify('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'failed', error: { message: 'context window exceeded', codexErrorInfo: 'contextWindowExceeded' } },
    })
    expect(finish(await collecting).reason).toEqual({ kind: 'max-tokens' })
  })

  it('narrates completed commands, file changes, and tool calls as activity lines', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('do work')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    const completed = (item: JsonObject): void => {
      child.peer.notify('item/completed', { threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 1, item })
    }
    child.peer.notify('item/started', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { type: 'commandExecution', id: 'c1', command: 'pnpm  test', cwd: '/work', commandActions: [], status: 'inProgress' },
    })
    completed({ type: 'commandExecution', id: 'c1', command: 'pnpm  test', cwd: '/work', commandActions: [], status: 'completed', exitCode: 0 })
    completed({ type: 'commandExecution', id: 'c2', command: 'rm -rf dist', cwd: '/work', commandActions: [], status: 'declined', exitCode: null })
    completed({ type: 'commandExecution', id: 'c3', command: 'sleep 1', cwd: '/work', commandActions: [], status: 'inProgress', exitCode: null })
    completed({ type: 'commandExecution', id: 'c4', cwd: '/work', commandActions: [], status: 'completed' })
    completed({ type: 'fileChange', id: 'f1', status: 'completed', changes: [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '' }, { path: 'src/b.ts', kind: { type: 'add' }, diff: '' }] })
    completed({ type: 'mcpToolCall', id: 't1', server: 'docs', tool: 'search', arguments: {}, status: 'failed' })
    completed({ type: 'dynamicToolCall', id: 't2', tool: 'lint', arguments: {}, status: 'somethingNew' })
    completed({ type: 'webSearch', id: 'w1', query: 'vitest coverage' })
    completed({ type: 'plan', id: 'p1', text: 'step one' })
    completed({ type: 'agentMessage', id: 'm1', text: 'done', phase: 'final_answer' })
    child.peer.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'm1', delta: 'done' })
    completeTurn(child, 'thread-1', 'turn-1')
    const chunks = await collecting
    expect(reasoning(chunks)).toBe([
      'ran `pnpm test` (exit 0)',
      'declined command `rm -rf dist`',
      'running `sleep 1`',
      'edited src/a.ts, src/b.ts',
      'tool docs/search failed',
      'used tool lint',
      'searched the web for "vitest coverage"',
    ].map(line => `${line}\n`).join(''))
    expect(text(chunks)).toBe('done')
  })

  it('answers approvals through the bridge for bridge routes and unattended for native routes', async () => {
    const f = await fixture({ approve: 'rejected' })
    const bridged = await agentAt(f, 'bridged')
    const native = await f.harness.create(SessionId('native'), { provider: 'codex-unattended', model: 'gpt-5.6-sol' }, { cwd: '/work' })
    const collecting = collect(f.adapter.stream(loopRequest(bridged, [user('go')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-b')
    await answerTurnStart(child, 'thread-b', 'turn-b')
    child.peer.request('req-1', 'item/commandExecution/requestApproval', {
      threadId: 'thread-b', turnId: 'turn-b', itemId: 'c1', command: 'make', availableDecisions: ['accept', 'decline'],
    })
    expect(await child.peer.nextResponse('req-1')).toMatchObject({ result: { decision: 'decline' } })
    expect(f.approvals).toEqual(['codex:command:make'])
    completeTurn(child, 'thread-b', 'turn-b')
    await collecting

    const unattended = collect(f.adapter.stream(markAgentLoopRequest({
      provider: 'codex-unattended', model: 'gpt-5.6-sol', messages: [user('go')], sessionId: native.id,
    })))
    const start = await answerThreadStart(child, 'thread-n')
    expect(start.params).toMatchObject(threadPermissionParams('never'))
    await answerTurnStart(child, 'thread-n', 'turn-n')
    child.peer.request('req-2', 'item/commandExecution/requestApproval', {
      threadId: 'thread-n', turnId: 'turn-n', itemId: 'c1', command: 'make', availableDecisions: ['accept', 'decline'],
    })
    expect(await child.peer.nextResponse('req-2')).toMatchObject({ result: { decision: 'decline' } })
    expect(f.approvals).toEqual(['codex:command:make'])
    completeTurn(child, 'thread-n', 'turn-n')
    await unattended
  })

  it('fails the turn as a TIMEOUT when Codex stays silent past the idle limit', async () => {
    const f = await fixture({ turnIdleTimeoutMs: 40 })
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    const interrupt = await child.peer.nextMethod('turn/interrupt')
    child.peer.respond(interrupt, {})
    child.peer.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', error: null } })
    const reason = finish(await collecting).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') expect(reason.failure.code).toBe('TIMEOUT')
  })

  it('fails the stream when the Session has no live Agent or no workspace', async () => {
    const f = await fixture()
    const orphan = finish(await collect(f.adapter.stream(markAgentLoopRequest({
      provider: 'codex', model: 'gpt-5.6-sol', messages: [user('go')], sessionId: SessionId('nobody'),
    })))).reason
    expect(orphan.kind).toBe('error')
    if (orphan.kind === 'error') expect(orphan.failure.message).toContain('no live Agent')

    const homeless = await f.harness.create(SessionId('homeless'), { provider: 'codex', model: 'gpt-5.6-sol' })
    const reason = finish(await collect(f.adapter.stream(loopRequest(homeless, [user('go')])))).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') expect(reason.failure.message).toContain('workspace')

    const agent = await agentAt(f, 'session-1')
    const silent = finish(await collect(f.adapter.stream(loopRequest(agent, [assistant('only me')])))).reason
    expect(silent.kind).toBe('error')
    if (silent.kind === 'error') expect(silent.failure.code).toBe('EMPTY_REQUEST')

    const unknownRoute = finish(await collect(f.adapter.stream(loopRequest(agent, [user('go')], { provider: 'not-codex' })))).reason
    expect(unknownRoute.kind).toBe('error')
    if (unknownRoute.kind === 'error') expect(unknownRoute.failure.code).toBe('NO_ROUTE')
    expect(f.spawner.children).toHaveLength(0)
  })

  it('fails loud when the codexThread projection is not registered', async () => {
    const f = await fixture({ withoutProjection: true })
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    const reason = finish(await collecting).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') expect(reason.failure.code).toBe('PROJECTION_MISSING')
  })

  it('reports an unexpected failure with its message and the UNKNOWN code', async () => {
    const f = await fixture({ projections: { stateOf: () => { throw new Error('projection store exploded') } } })
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    const reason = finish(await collecting).reason
    expect(reason).toEqual({ kind: 'error', failure: { message: 'projection store exploded', code: 'UNKNOWN' } })
  })

  it('reports a product that cannot be started as a transport failure', async () => {
    const f = await fixture({ spawn: () => { throw 'no codex wrapper on this host' } })
    const agent = await agentAt(f, 'session-1')
    const reason = finish(await collect(f.adapter.stream(loopRequest(agent, [user('go')])))).reason
    expect(reason).toEqual({ kind: 'error', failure: { message: 'no codex wrapper on this host', code: 'TRANSPORT' } })
  })

  it('reports a process that dies while resuming as a transport failure', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const first = collect(f.adapter.stream(loopRequest(agent, [user('one')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    completeTurn(child, 'thread-1', 'turn-1')
    await first
    await exit(child)
    const second = collect(f.adapter.stream(loopRequest(agent, [user('two')])))
    const replacement = await f.spawner.nextChild()
    await completeHandshake(replacement)
    await replacement.peer.nextMethod('thread/resume')
    await exit(replacement)
    const reason = finish(await second).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') expect(reason.failure.code).toBe('TRANSPORT')
  })

  it('finishes a silent turn with stop and a product-side interruption as aborted', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    completeTurn(child, 'thread-1', 'turn-1')
    expect(finish(await collecting).reason).toEqual({ kind: 'stop' })

    const interrupted = collect(f.adapter.stream(loopRequest(agent, [user('again')])))
    await answerTurnStart(child, 'thread-1', 'turn-2')
    child.peer.notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-2', status: 'interrupted', error: null } })
    expect(finish(await interrupted).reason).toEqual({
      kind: 'aborted',
      failure: { message: 'Codex interrupted the turn', code: 'ABORTED' },
    })
  })

  it('gives up after the grace when Codex answers neither turn/start nor the interrupt', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const early = new AbortController()
    const first = collect(f.adapter.stream(loopRequest(agent, [user('go')], { signal: early.signal })))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await child.peer.nextMethod('turn/start')
    early.abort(new Error('changed my mind'))
    expect(finish(await first).reason).toEqual({ kind: 'aborted', failure: { message: 'changed my mind', code: 'ABORTED' } })
    expect(child.peer.pending().filter(frame => frame.method === 'turn/interrupt')).toEqual([])

    const late = new AbortController()
    const output = reader(f.adapter.stream(loopRequest(agent, [user('go on')], { signal: late.signal })))
    await answerTurnStart(child, 'thread-1', 'turn-2')
    child.peer.notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-2', itemId: 'm', delta: 'partial' })
    await output.until(chunk => chunk.type === 'text-delta')
    late.abort(new Error('stop'))
    const interrupt = await child.peer.nextMethod('turn/interrupt')
    child.peer.respond(interrupt, {})
    expect(finish(await output.rest()).reason).toEqual({ kind: 'aborted', failure: { message: 'stop', code: 'ABORTED' } })
  })

  it('refuses a request whose Session is bound to a different workspace', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1', '/work')
    const first = collect(f.adapter.stream(loopRequest(agent, [user('one')])))
    const child = await f.spawner.nextChild()
    await completeHandshake(child)
    await answerThreadStart(child, 'thread-1')
    await answerTurnStart(child, 'thread-1', 'turn-1')
    completeTurn(child, 'thread-1', 'turn-1')
    await first
    agent.session.append('codex/thread', { conversationId: 'thread-1', cwd: '/elsewhere' })
    const reason = finish(await collect(f.adapter.stream(loopRequest(agent, [user('two')])))).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') {
      expect(reason.failure.message).toContain('/elsewhere')
      expect(reason.failure.message).toContain('/work')
    }
  })
})
