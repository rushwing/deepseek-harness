import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  type AgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
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
  ClaudeCodeBackendAdapter,
  Config,
  claudeCodeSessionProjection,
  resolveClaudeCodeBackendSpec,
} from '@deepseek-ai/dsh-experimental-llm-claude-code'
import { fakeQueryFactory, fakeSpawner, type FakeQueryFactory, type FakeSpawner, type ScriptedQuery } from './fake-claude.ts'

const user = (text: string): RequestMessage =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistant = (text: string): RequestMessage =>
  createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'claude-code', model: 'sonnet' } })

interface Fixture {
  readonly ctx: Context
  readonly harness: AgentLoopTestHarness
  readonly spawner: FakeSpawner
  readonly queries: FakeQueryFactory
  readonly adapter: ClaudeCodeBackendAdapter
  readonly approvals: string[]
  readonly stderr: string[]
}

interface FixtureOptions {
  readonly turnIdleTimeoutMs?: number
  readonly approve?: 'allowed-once' | 'rejected'
  readonly withoutProjection?: true
  readonly projections?: Pick<SessionProjectionRegistry, 'stateOf'>
  /** Replace the spawn operation the adapter calls. */
  readonly spawn?: FakeSpawner['spawn']
  /** Let the fake SDK skip spawning a CLI process. */
  readonly spawns?: false
  /** Leave the stderr sink unset so the adapter writes to the Host process stderr. */
  readonly hostStderr?: true
}

const fixtures: Fixture[] = []

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  if (options.withoutProjection === undefined) ctx.sessionProjections.register(claudeCodeSessionProjection)
  const spec = resolveClaudeCodeBackendSpec(new Config({
    routes: {
      'claude-code': {},
      'claude-code-unattended': { permissionMode: 'dontAsk' },
      'claude-code-plan': { permissionMode: 'plan' },
      'claude-code-bypass': { permissionMode: 'bypassPermissions' },
    },
    env: { CLAUDE_CONFIG_DIR: '/claude-home' },
    disposeGraceMs: 50,
    ...options.turnIdleTimeoutMs === undefined ? {} : { turnIdleTimeoutMs: options.turnIdleTimeoutMs },
  }))
  const spawner = fakeSpawner()
  const queries = fakeQueryFactory(spawner, options.spawns === undefined ? {} : { spawns: options.spawns })
  const approvals: string[] = []
  const stderr: string[] = []
  const adapter = new ClaudeCodeBackendAdapter({
    spec,
    query: queries.factory,
    spawn: options.spawn ?? spawner.spawn,
    cwd: '/host',
    agents: ctx.agents,
    projections: options.projections ?? ctx.sessionProjections,
    approval: {
      request: async (request) => {
        approvals.push(`${request.toolName}:${request.reason ?? ''}`)
        return options.approve ?? 'allowed-once'
      },
    },
    userQuestions: { ask: async () => ({ answers: [] }) },
    ...options.hostStderr === undefined ? { stderr: (line: string) => { stderr.push(line) } } : {},
  })
  const created: Fixture = { ctx, harness, spawner, queries, adapter, approvals, stderr }
  fixtures.push(created)
  return created
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.ctx.fiber.dispose()
  vi.restoreAllMocks()
})

async function agentAt(f: Fixture, id: string, cwd = '/work'): Promise<Agent> {
  return f.harness.create(SessionId(id), { provider: 'claude-code', model: 'sonnet' }, { cwd })
}

function loopRequest(agent: Agent, messages: RequestMessage[], extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return markAgentLoopRequest({ provider: 'claude-code', model: 'sonnet', messages, sessionId: agent.id, ...extra })
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

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

const text = (chunks: readonly StreamChunk[]): string => chunks.map(chunk => (chunk.type === 'text-delta' ? chunk.text : '')).join('')
const reasoning = (chunks: readonly StreamChunk[]): string => chunks.map(chunk => (chunk.type === 'reasoning-delta' ? chunk.text : '')).join('')

function finish(chunks: readonly StreamChunk[]): StreamChunk & { type: 'finish' } {
  const last = chunks.at(-1)
  if (last?.type !== 'finish') throw new Error(`stream ended without finish: ${JSON.stringify(last)}`)
  return last
}

const init = (sessionId: string): SDKMessage => ({ type: 'system', subtype: 'init', session_id: sessionId, model: 'sonnet' } as SDKMessage)
const textDelta = (delta: string): SDKMessage => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } },
  parent_tool_use_id: null,
  session_id: 'cs-1',
} as SDKMessage)
const thinkingDelta = (delta: string): SDKMessage => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: delta } },
  parent_tool_use_id: null,
  session_id: 'cs-1',
} as SDKMessage)
const toolUse = (id: string, name: string, input: Record<string, unknown>): SDKMessage => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  parent_tool_use_id: null,
  session_id: 'cs-1',
} as SDKMessage)
const toolResult = (id: string, isError = false): SDKMessage => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'done' }] },
  parent_tool_use_id: null,
  session_id: 'cs-1',
})
const otherMessage = (message: Record<string, unknown>): SDKMessage => message as SDKMessage
const usage = { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 }
const success = (result: string, extra: Record<string, unknown> = {}): SDKMessage => ({
  type: 'result', subtype: 'success', is_error: false, result, usage, session_id: 'cs-1', ...extra,
} as SDKMessage)
const resultError = (subtype: string, errors: string[]): SDKMessage => ({
  type: 'result', subtype, is_error: true, usage, session_id: 'cs-1', errors,
} as SDKMessage)

/** Wait until the fake SDK has read the adapter's prompt message. */
async function sent(query: ScriptedQuery): Promise<void> {
  for (let attempts = 0; attempts < 50 && query.sent.length === 0; attempts += 1) {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }
}

function abortedBy(query: ScriptedQuery): Promise<unknown> {
  const signal = query.options.abortController?.signal
  if (signal === undefined) throw new Error('the adapter passed no abort controller')
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(signal.reason); return }
    signal.addEventListener('abort', () => { resolve(signal.reason) }, { once: true })
  })
}

describe('ClaudeCodeBackendAdapter catalog', () => {
  it('describes routes and reads the model catalog once from a short-lived query', async () => {
    const f = await fixture()
    expect(f.adapter.providerInfo('claude-code')).toEqual({ id: 'claude-code', name: 'Claude Code' })
    expect(f.adapter.providerInfo('claude-code-plan')).toEqual({ id: 'claude-code-plan', name: 'Claude Code (claude-code-plan)' })
    const listing = f.adapter.listModels('claude-code')
    const q = await f.queries.nextQuery()
    expect(q.options).toMatchObject({ cwd: '/host', persistSession: false, permissionMode: 'dontAsk' })
    expect(q.options.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/claude-home' })
    q.resolveModels([
      { value: 'sonnet', displayName: 'Claude Sonnet', description: 'Balanced', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
      { value: 'opus', displayName: 'Claude Opus', description: '', supportsEffort: false },
    ])
    expect(await listing).toEqual([
      { provider: 'claude-code', id: 'sonnet', name: 'Claude Sonnet', description: 'Balanced', inputModalities: ['text'] },
      { provider: 'claude-code', id: 'opus', name: 'Claude Opus', inputModalities: ['text'] },
    ])
    expect(q.closed()).toBe(1)
    expect(q.child()?.spec).toMatchObject({ cwd: '/host', graceMs: 50 })
    expect(await f.adapter.resolveModel('claude-code', 'sonnet')).toEqual({
      provider: 'claude-code',
      id: 'sonnet',
      name: 'Claude Sonnet',
      description: 'Balanced',
      inputModalities: ['text'],
      reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: 'low' }, { id: ReasoningEffortId('medium'), name: 'medium' }, { id: ReasoningEffortId('high'), name: 'high' }] },
    })
    expect(await f.adapter.resolveModel('claude-code', 'opus')).toEqual({ provider: 'claude-code', id: 'opus', name: 'Claude Opus', inputModalities: ['text'] })
    expect(await f.adapter.resolveModel('claude-code-plan', 'haiku')).toEqual({ provider: 'claude-code-plan', id: 'haiku', name: 'haiku', inputModalities: ['text'] })
    expect(f.queries.queries).toHaveLength(1)
  })

  it('reports a catalog query the CLI refuses as a transport failure and retries on the next read', async () => {
    const f = await fixture()
    const first = f.adapter.listModels('claude-code')
    const q = await f.queries.nextQuery()
    q.options.stderr?.('Not logged in · Please run /login\n')
    q.rejectModels(new Error('Claude Code process exited with code 1'))
    const error = await first.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).failure.code).toBe('TRANSPORT')
    expect((error as LlmError).message).toContain('Not logged in')
    expect(q.closed()).toBe(1)
    const second = f.adapter.listModels('claude-code')
    const retry = await f.queries.nextQuery()
    retry.resolveModels([])
    expect(await second).toEqual([])
  })
})

describe('ClaudeCodeBackendAdapter turns', () => {
  it('runs the first turn as a fresh bridged query, binds the reported session, and streams text, reasoning, activity, and usage', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1', '/work')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('hello')], { reasoningEffort: ReasoningEffortId('high') })))
    const q = await f.queries.nextQuery()
    expect(q.options).toMatchObject({
      cwd: '/work',
      model: 'sonnet',
      effort: 'high',
      permissionMode: 'default',
      persistSession: true,
      includePartialMessages: true,
    })
    expect(q.options.resume).toBeUndefined()
    expect(q.options.disallowedTools).toBeUndefined()
    expect(q.options.allowDangerouslySkipPermissions).toBeUndefined()
    expect(q.options.canUseTool).toBeDefined()
    expect(q.options.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/claude-home' })
    expect(q.child()?.spec).toMatchObject({ cwd: '/work', graceMs: 50 })
    await sent(q)
    expect(q.sent).toEqual([{ type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null }])
    q.emit(init('cs-1'))
    q.emit(thinkingDelta('hmm'))
    q.emit(textDelta('Hi '))
    q.emit(textDelta('there'))
    q.emit(toolUse('tu1', 'Bash', { command: 'pnpm  test' }))
    q.emit(toolResult('tu1'))
    q.emit(toolUse('tu2', 'Edit', { file_path: 'src/a.ts' }))
    q.emit(toolResult('tu2', true))
    q.emit(toolUse('tu3', 'WebSearch', { query: 'vitest' }))
    q.emit(toolResult('tu3'))
    q.emit(toolUse('tu4', 'Grep', { pattern: 'x' }))
    q.emit(toolResult('tu4'))
    q.emit(toolResult('unknown-tool-use'))
    q.emit(toolUse('tu5', 'Bash', {}))
    q.emit(toolResult('tu5'))
    q.emit(toolUse('tu6', 'NotebookEdit', { notebook_path: 'n.ipynb' }))
    q.emit(toolResult('tu6'))
    q.emit(toolUse('tu7', 'Edit', {}))
    q.emit(toolResult('tu7'))
    q.emit(toolUse('tu8', 'WebSearch', {}))
    q.emit(toolResult('tu8'))
    q.emit(otherMessage({ type: 'system', subtype: 'status', status: null, session_id: 'cs-1' }))
    q.emit(otherMessage({ type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null, session_id: 'cs-1' }))
    q.emit(otherMessage({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } }, parent_tool_use_id: null, session_id: 'cs-1' }))
    q.emit(otherMessage({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'complete text' }] }, parent_tool_use_id: null, session_id: 'cs-1' }))
    q.emit(otherMessage({ type: 'user', message: { role: 'user', content: 'plain follow-up' }, parent_tool_use_id: null }))
    q.emit(otherMessage({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'note' }] }, parent_tool_use_id: null }))
    q.emit(otherMessage({ type: 'tool_progress', tool_use_id: 'tu1', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 1, session_id: 'cs-1' }))
    q.emit(success('Hi there'))
    const chunks = await collecting
    expect(text(chunks)).toBe('Hi there')
    expect(reasoning(chunks)).toBe([
      'hmm',
      'ran `pnpm test`\n',
      'failed to edit src/a.ts\n',
      'searched the web for "vitest"\n',
      'used tool Grep\n',
      'used tool Bash\n',
      'edited n.ipynb\n',
      'edited files\n',
      'used tool WebSearch\n',
    ].join(''))
    expect(chunks.find(chunk => chunk.type === 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 5 },
    })
    expect(finish(chunks).reason).toEqual({ kind: 'stop' })
    expect(f.ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toEqual({ conversationId: 'cs-1', cwd: '/work', model: 'sonnet' })
    expect(q.closed()).toBe(1)
    expect(f.spawner.children).toHaveLength(1)
  })

  it('resumes the bound session on later turns with only the new user input', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const first = collect(f.adapter.stream(loopRequest(agent, [user('one')])))
    const q1 = await f.queries.nextQuery()
    q1.emit(init('cs-1'))
    q1.emit(success('reply'))
    await first
    const second = collect(f.adapter.stream(loopRequest(agent, [user('one'), assistant('reply'), user('two'), user('three')])))
    const q2 = await f.queries.nextQuery()
    expect(q2.options.resume).toBe('cs-1')
    await sent(q2)
    expect(q2.sent[0]?.message.content).toBe('two\n\nthree')
    q2.emit(init('cs-1'))
    q2.emit(success('ok'))
    expect(finish(await second).reason).toEqual({ kind: 'stop' })
    expect(f.ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toMatchObject({ conversationId: 'cs-1' })
  })

  it('reports a bound session the CLI no longer has instead of starting a new one', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const first = collect(f.adapter.stream(loopRequest(agent, [user('one')])))
    const q1 = await f.queries.nextQuery()
    q1.emit(init('cs-1'))
    q1.emit(success('reply'))
    await first
    const second = collect(f.adapter.stream(loopRequest(agent, [user('two')])))
    const q2 = await f.queries.nextQuery()
    q2.options.stderr?.('No conversation found with session ID: cs-1\n')
    q2.fail(new Error('Claude Code process exited with code 1'))
    const reason = finish(await second).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') {
      expect(reason.failure.code).toBe('PRODUCT_CONVERSATION_MISSING')
      expect(reason.failure.message).toContain('cs-1')
      expect(reason.failure.message).toContain('No conversation found')
    }
    expect(f.stderr.join('')).toContain('No conversation found')
    expect(q2.closed()).toBe(1)

    const third = collect(f.adapter.stream(loopRequest(agent, [user('three')])))
    const q3 = await f.queries.nextQuery()
    q3.fail(new Error('Claude Code process exited with code 3'))
    const quiet = finish(await third).reason
    expect(quiet).toMatchObject({ kind: 'error', failure: { code: 'PRODUCT_CONVERSATION_MISSING' } })
    if (quiet.kind === 'error') expect(quiet.failure.message).toContain('exited with code 3')
  })

  it('reports a query that dies after the session started as a transport failure with the CLI stderr', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const q = await f.queries.nextQuery()
    q.emit(init('cs-1'))
    for (const word of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']) q.options.stderr?.(`${word}\n`)
    q.options.stderr?.('segfault\n')
    q.fail(new Error('Claude Code process exited with code 139'))
    const reason = finish(await collecting).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') {
      expect(reason.failure.code).toBe('TRANSPORT')
      expect(reason.failure.message).toContain('exited with code 139')
      expect(reason.failure.message).toContain('segfault')
      expect(reason.failure.message).toContain('charlie')
      expect(reason.failure.message).not.toContain('alpha')
    }

    const quiet = collect(f.adapter.stream(loopRequest(agent, [user('again')])))
    const q2 = await f.queries.nextQuery()
    q2.emit(init('cs-1'))
    q2.fail(new Error('Claude Code process exited with code 2'))
    expect(finish(await quiet).reason).toEqual({
      kind: 'error',
      failure: { message: 'Claude Code process exited with code 2', code: 'TRANSPORT' },
    })
  })

  it('writes the CLI stderr to the Host process stderr when no sink is given', async () => {
    const written: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    const f = await fixture({ hostStderr: true })
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const q = await f.queries.nextQuery()
    q.options.stderr?.('claude: to the host\n')
    q.emit(init('cs-1'))
    q.emit(success('ok'))
    await collecting
    expect(written.join('')).toContain('claude: to the host')
  })

  it('closes a query for which the SDK spawned no process and reports a spawn that throws', async () => {
    const f = await fixture({ spawns: false })
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const q = await f.queries.nextQuery()
    expect(q.child()).toBeUndefined()
    q.emit(init('cs-1'))
    q.emit(success('ok'))
    expect(finish(await collecting).reason).toEqual({ kind: 'stop' })
    expect(f.spawner.children).toHaveLength(0)

    const broken = await fixture({ spawn: () => { throw 'no claude binary on this host' } })
    const other = await agentAt(broken, 'session-2')
    expect(finish(await collect(broken.adapter.stream(loopRequest(other, [user('go')])))).reason)
      .toEqual({ kind: 'error', failure: { message: 'no claude binary on this host', code: 'UNKNOWN' } })
  })

  it('runs native routes with their Claude Code mode and unattended callbacks', async () => {
    const f = await fixture()
    const cases = [
      { provider: 'claude-code-unattended', mode: 'dontAsk', disallowed: ['AskUserQuestion'], skip: undefined },
      { provider: 'claude-code-plan', mode: 'plan', disallowed: ['AskUserQuestion', 'ExitPlanMode'], skip: undefined },
      { provider: 'claude-code-bypass', mode: 'bypassPermissions', disallowed: ['AskUserQuestion'], skip: true },
    ] as const
    for (const [index, entry] of cases.entries()) {
      const agent = await f.harness.create(SessionId(`native-${String(index)}`), { provider: entry.provider, model: 'sonnet' }, { cwd: '/work' })
      const collecting = collect(f.adapter.stream(markAgentLoopRequest({ provider: entry.provider, model: 'sonnet', messages: [user('go')], sessionId: agent.id })))
      const q = await f.queries.nextQuery()
      expect(q.options.permissionMode).toBe(entry.mode)
      expect(q.options.disallowedTools).toEqual(entry.disallowed)
      expect(q.options.allowDangerouslySkipPermissions).toBe(entry.skip)
      expect(await q.options.canUseTool?.('Bash', { command: 'ls' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' }))
        .toEqual({ behavior: 'deny', message: 'this unattended Claude Code route cannot request human approval' })
      q.emit(init(`cs-${String(index)}`))
      q.emit(success('ok'))
      expect(finish(await collecting).reason).toEqual({ kind: 'stop' })
    }
    expect(f.approvals).toEqual([])
  })

  it('bridges tool permissions of bound bridged turns to the approval service', async () => {
    const f = await fixture({ approve: 'rejected' })
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const q = await f.queries.nextQuery()
    expect(await q.options.canUseTool?.('Bash', { command: 'make' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' }))
      .toEqual({ behavior: 'deny', message: 'dsh declined the Bash tool call' })
    expect(f.approvals).toEqual(['claude-code:Bash:make'])
    q.emit(init('cs-1'))
    q.emit(success('ok'))
    await collecting
  })

  it('runs auxiliary and session-less requests as unpersisted queries without touching the binding', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const titling = collect(f.adapter.stream(loopRequest(agent, [user('title this')], { purpose: 'session-title' })))
    const q1 = await f.queries.nextQuery()
    expect(q1.options).toMatchObject({ cwd: '/work', persistSession: false })
    expect(q1.options.resume).toBeUndefined()
    expect(await q1.options.canUseTool?.('Bash', { command: 'ls' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' }))
      .toMatchObject({ behavior: 'deny' })
    q1.emit(init('ephemeral-1'))
    q1.emit(textDelta('A title'))
    q1.emit(success('A title'))
    expect(text(await titling)).toBe('A title')
    expect(f.ctx.sessionProjections.stateOf(agent.session, 'claudeCodeSession')).toBeNull()

    const oneShot = collect(f.adapter.stream({ provider: 'claude-code', model: 'sonnet', messages: [user('no session')] }))
    const q2 = await f.queries.nextQuery()
    expect(q2.options).toMatchObject({ cwd: '/host', persistSession: false })
    q2.emit(init('ephemeral-2'))
    q2.emit(success('ok'))
    expect(finish(await oneShot).reason).toEqual({ kind: 'stop' })
  })

  it('aborts the query when the request aborts and finishes as aborted', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const controller = new AbortController()
    const output = reader(f.adapter.stream(loopRequest(agent, [user('long task')], { signal: controller.signal })))
    const q = await f.queries.nextQuery()
    q.emit(init('cs-1'))
    q.emit(textDelta('partial'))
    await output.until(chunk => chunk.type === 'text-delta')
    controller.abort(new Error('user cancelled'))
    expect(await abortedBy(q)).toBeInstanceOf(Error)
    q.fail(new Error('This operation was aborted'))
    const chunks = await output.rest()
    expect(text(chunks)).toBe('partial')
    expect(finish(chunks).reason).toEqual({ kind: 'aborted', failure: { message: 'user cancelled', code: 'ABORTED' } })
    expect(q.closed()).toBe(1)

    const plain = new AbortController()
    const second = collect(f.adapter.stream(loopRequest(agent, [user('again')], { signal: plain.signal })))
    const q2 = await f.queries.nextQuery()
    q2.emit(init('cs-1'))
    plain.abort('stop now')
    await abortedBy(q2)
    q2.fail(new Error('This operation was aborted'))
    expect(finish(await second).reason).toEqual({ kind: 'aborted', failure: { message: 'stop now', code: 'ABORTED' } })
  })

  it('fails the turn as a TIMEOUT when the CLI stays silent past the idle limit', async () => {
    const f = await fixture({ turnIdleTimeoutMs: 40 })
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const q = await f.queries.nextQuery()
    q.emit(init('cs-1'))
    const cause = await abortedBy(q)
    expect(cause).toBeInstanceOf(LlmError)
    q.fail(new Error('This operation was aborted'))
    const reason = finish(await collecting).reason
    expect(reason.kind).toBe('error')
    if (reason.kind === 'error') expect(reason.failure.code).toBe('TIMEOUT')
  })

  it('maps result errors to failure codes', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const cases: Array<{ message: SDKMessage; code: string; text: string }> = [
      { message: resultError('error_max_turns', ['hit the turn limit']), code: 'MAX_TURNS', text: 'hit the turn limit' },
      { message: resultError('error_max_budget_usd', []), code: 'BUDGET_EXCEEDED', text: 'error_max_budget_usd' },
      { message: resultError('error_max_structured_output_retries', ['bad json']), code: 'INVALID_RESULT', text: 'bad json' },
      { message: resultError('error_during_execution', ['boom']), code: 'PRODUCT_ERROR', text: 'boom' },
      { message: success('rate limited', { is_error: true, api_error_status: 429 }), code: 'RATE_LIMIT', text: 'rate limited' },
      { message: success('unauthorized', { is_error: true, api_error_status: 401 }), code: 'AUTH', text: 'unauthorized' },
      { message: success('upstream', { is_error: true, api_error_status: 503 }), code: 'SERVER', text: 'upstream' },
      { message: success('', { is_error: true }), code: 'PRODUCT_ERROR', text: 'Claude Code reported an API error' },
      { message: resultError('error_new_kind', ['unfamiliar']), code: 'UNKNOWN', text: 'unfamiliar' },
    ]
    for (const entry of cases) {
      const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
      const q = await f.queries.nextQuery()
      q.emit(init('cs-1'))
      q.emit(entry.message)
      const reason = finish(await collecting).reason
      expect(reason).toEqual({ kind: 'error', failure: { message: entry.text, code: entry.code } })
    }
  })

  it('uses the result text when no partial message streamed and fails a turn that ends without a result', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1')
    const collecting = collect(f.adapter.stream(loopRequest(agent, [user('go')])))
    const q = await f.queries.nextQuery()
    q.emit(init('cs-1'))
    q.emit(success('Whole answer'))
    const chunks = await collecting
    expect(text(chunks)).toBe('Whole answer')
    expect(finish(chunks).reason).toEqual({ kind: 'stop' })

    const silent = collect(f.adapter.stream(loopRequest(agent, [user('again')])))
    const q2 = await f.queries.nextQuery()
    q2.emit(init('cs-1'))
    q2.end()
    const reason = finish(await silent).reason
    expect(reason).toEqual({ kind: 'error', failure: { message: 'Claude Code ended the turn without a result', code: 'INVALID_RESULT' } })
  })

  it('fails the stream for requests it cannot run without starting a query', async () => {
    const f = await fixture()
    const orphan = finish(await collect(f.adapter.stream(markAgentLoopRequest({
      provider: 'claude-code', model: 'sonnet', messages: [user('go')], sessionId: SessionId('nobody'),
    })))).reason
    expect(orphan).toMatchObject({ kind: 'error', failure: { code: 'NO_LIVE_AGENT' } })

    const homeless = await f.harness.create(SessionId('homeless'), { provider: 'claude-code', model: 'sonnet' })
    expect(finish(await collect(f.adapter.stream(loopRequest(homeless, [user('go')])))).reason)
      .toMatchObject({ kind: 'error', failure: { code: 'NO_WORKSPACE' } })

    const agent = await agentAt(f, 'session-1')
    expect(finish(await collect(f.adapter.stream(loopRequest(agent, [assistant('only me')])))).reason)
      .toMatchObject({ kind: 'error', failure: { code: 'EMPTY_REQUEST' } })
    expect(finish(await collect(f.adapter.stream(loopRequest(agent, [user('go')], { provider: 'not-claude' })))).reason)
      .toMatchObject({ kind: 'error', failure: { code: 'NO_ROUTE' } })
    expect(finish(await collect(f.adapter.stream(loopRequest(agent, [user('go')], { reasoningEffort: ReasoningEffortId('turbo') })))).reason)
      .toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(f.queries.queries).toEqual([])
  })

  it('fails loud when the projection is missing or the projection store throws', async () => {
    const missing = await fixture({ withoutProjection: true })
    const agent = await agentAt(missing, 'session-1')
    expect(finish(await collect(missing.adapter.stream(loopRequest(agent, [user('go')])))).reason)
      .toMatchObject({ kind: 'error', failure: { code: 'PROJECTION_MISSING' } })

    const broken = await fixture({ projections: { stateOf: () => { throw new Error('projection store exploded') } } })
    const other = await agentAt(broken, 'session-2')
    expect(finish(await collect(broken.adapter.stream(loopRequest(other, [user('go')])))).reason)
      .toEqual({ kind: 'error', failure: { message: 'projection store exploded', code: 'UNKNOWN' } })
  })

  it('refuses a request whose Session is bound to a different workspace', async () => {
    const f = await fixture()
    const agent = await agentAt(f, 'session-1', '/work')
    agent.session.append('claude-code/session', { conversationId: 'cs-1', cwd: '/elsewhere' })
    const reason = finish(await collect(f.adapter.stream(loopRequest(agent, [user('two')])))).reason
    expect(reason).toMatchObject({ kind: 'error', failure: { code: 'WORKSPACE_MISMATCH' } })
    if (reason.kind === 'error') {
      expect(reason.failure.message).toContain('/elsewhere')
      expect(reason.failure.message).toContain('/work')
    }
  })
})
