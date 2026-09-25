import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  CodexAppServerConnection,
  type CodexServerRequest,
  type CodexTurnObserver,
} from '@deepseek-ai/dsh-codex-app-server'

type JsonObject = Record<string, unknown>

class ProtocolPeer {
  private buffer = ''
  private readonly frames: JsonObject[] = []
  private readonly wakeups = new Set<() => void>()

  constructor(
    input: PassThrough,
    private readonly output: PassThrough,
  ) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) this.frames.push(JSON.parse(line) as JsonObject)
      }
      for (const wake of this.wakeups) wake()
      this.wakeups.clear()
    })
  }

  async next(predicate: (frame: JsonObject) => boolean): Promise<JsonObject> {
    for (;;) {
      const index = this.frames.findIndex(predicate)
      if (index >= 0) return this.frames.splice(index, 1)[0]!
      await new Promise<void>((resolve) => { this.wakeups.add(resolve) })
    }
  }

  nextMethod(method: string): Promise<JsonObject> {
    return this.next(frame => frame.method === method)
  }

  nextResponse(id: unknown): Promise<JsonObject> {
    return this.next(frame => frame.id === id && frame.method === undefined)
  }

  send(...frames: readonly JsonObject[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }

  respond(requestFrame: JsonObject, result: unknown): void {
    this.send({ id: requestFrame.id, result })
  }

  /** Frames received from the client that no `next()` call has consumed yet. */
  pending(): readonly JsonObject[] {
    return [...this.frames]
  }

  respondError(requestFrame: JsonObject, code: number, message: string): void {
    this.send({ id: requestFrame.id, error: { code, message } })
  }

  request(id: string, method: string, params: JsonObject): void {
    this.send({ id, method, params })
  }

  notify(method: string, params: JsonObject): void {
    this.send({ method, params })
  }
}

interface Harness {
  readonly peer: ProtocolPeer
  readonly connection: CodexAppServerConnection
  readonly fromServer: PassThrough
  readonly toServer: PassThrough
  readonly requests: CodexServerRequest[]
}

function harness(
  handler: (request: CodexServerRequest) => Promise<unknown> = async () => ({ decision: 'decline' }),
): Harness {
  const fromServer = new PassThrough()
  const toServer = new PassThrough()
  const peer = new ProtocolPeer(toServer, fromServer)
  const requests: CodexServerRequest[] = []
  const connection = new CodexAppServerConnection(fromServer, toServer, async (request) => {
    requests.push(request)
    return handler(request)
  })
  connection.start()
  return { peer, connection, fromServer, toServer, requests }
}

const signal = (): AbortSignal => new AbortController().signal

async function initialized(h: Harness): Promise<void> {
  const initializing = h.connection.initialize(signal())
  const initialize = await h.peer.nextMethod('initialize')
  expect(initialize.params).toEqual({
    clientInfo: { name: 'deepseek-harness', title: 'DeepSeek Harness', version: '0.0.1' },
    capabilities: { experimentalApi: false, requestAttestation: false },
  })
  h.peer.respond(initialize, { userAgent: 'codex-cli 0.153.4' })
  await initializing
  expect(await h.peer.nextMethod('initialized')).toEqual({ jsonrpc: '2.0', method: 'initialized' })
}

function observer(): CodexTurnObserver & {
  readonly text: string[]
  readonly reasoning: string[]
  readonly items: string[]
  readonly usage: JsonObject[]
} {
  const text: string[] = []
  const reasoning: string[] = []
  const items: string[] = []
  const usage: JsonObject[] = []
  return {
    text,
    reasoning,
    items,
    usage,
    onTextDelta: (delta) => { text.push(delta) },
    onReasoningDelta: (delta) => { reasoning.push(delta) },
    onItemStarted: (item) => { items.push(`started:${String(item.type)}:${String(item.id)}`) },
    onItemCompleted: (item) => { items.push(`completed:${String(item.type)}:${String(item.id)}`) },
    onUsage: (breakdown) => { usage.push(breakdown as unknown as JsonObject) },
  }
}

describe('handshake and threads', () => {
  it('performs the initialize handshake once', async () => {
    const h = harness()
    await initialized(h)
    h.connection.close()
  })

  it('starts a persistent thread with the mode fields and returns its id', async () => {
    const h = harness()
    await initialized(h)
    const starting = h.connection.startThread({
      cwd: '/work/repo',
      permissionMode: 'approve-for-me',
      model: 'gpt-5.6-sol',
    }, signal())
    const threadStart = await h.peer.nextMethod('thread/start')
    expect(threadStart.params).toEqual({
      cwd: '/work/repo',
      ephemeral: false,
      model: 'gpt-5.6-sol',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
    })
    h.peer.respond(threadStart, { thread: { id: 'thread-A', ephemeral: false } })
    expect(await starting).toEqual({ threadId: 'thread-A' })
    h.connection.close()
  })

  it('can start an ephemeral thread for auxiliary work', async () => {
    const h = harness()
    await initialized(h)
    const starting = h.connection.startThread({
      cwd: '/work/repo',
      permissionMode: 'never',
      ephemeral: true,
    }, signal())
    const threadStart = await h.peer.nextMethod('thread/start')
    expect(threadStart.params).toEqual({ cwd: '/work/repo', ephemeral: true, approvalPolicy: 'never' })
    h.peer.respond(threadStart, { thread: { id: 'thread-E', ephemeral: true } })
    expect(await starting).toEqual({ threadId: 'thread-E' })
    h.connection.close()
  })

  it('rejects a thread/start response without a thread id', async () => {
    const h = harness()
    await initialized(h)
    const starting = h.connection.startThread({ cwd: '/work', permissionMode: 'never' }, signal())
    h.peer.respond(await h.peer.nextMethod('thread/start'), { thread: {} })
    await expect(starting).rejects.toThrow('app-server returned invalid thread/start thread id')
    h.connection.close()
  })

  it('resumes a thread by id with the mode fields and reports the thread it got back', async () => {
    const h = harness()
    await initialized(h)
    const resuming = h.connection.resumeThread('thread-A', {
      cwd: '/work/repo',
      permissionMode: 'never',
    }, signal())
    const resume = await h.peer.nextMethod('thread/resume')
    expect(resume.params).toEqual({ threadId: 'thread-A', cwd: '/work/repo', approvalPolicy: 'never' })
    h.peer.respond(resume, { thread: { id: 'thread-A', ephemeral: false, cwd: '/work/repo' } })
    expect(await resuming).toEqual({ threadId: 'thread-A' })
    h.connection.close()
  })

  it('passes a model override through thread/resume', async () => {
    const h = harness()
    await initialized(h)
    const resuming = h.connection.resumeThread('thread-A', {
      cwd: '/work/repo',
      permissionMode: 'never',
      model: 'gpt-5.6-mini',
    }, signal())
    const resume = await h.peer.nextMethod('thread/resume')
    expect(resume.params).toEqual({ threadId: 'thread-A', cwd: '/work/repo', model: 'gpt-5.6-mini', approvalPolicy: 'never' })
    h.peer.respond(resume, { thread: { id: 'thread-A', ephemeral: false } })
    expect(await resuming).toEqual({ threadId: 'thread-A' })
    h.connection.close()
  })

  it('surfaces a thread/resume error response as a rejection', async () => {
    const h = harness()
    await initialized(h)
    const resuming = h.connection.resumeThread('gone', { cwd: '/work', permissionMode: 'never' }, signal())
    h.peer.respondError(await h.peer.nextMethod('thread/resume'), -32000, 'no such thread')
    await expect(resuming).rejects.toThrow('no such thread')
    h.connection.close()
  })
})

async function startedThread(h: Harness, threadId: string): Promise<void> {
  const starting = h.connection.startThread({ cwd: '/work', permissionMode: 'never' }, signal())
  h.peer.respond(await h.peer.nextMethod('thread/start'), { thread: { id: threadId, ephemeral: false } })
  await starting
}

describe('turns', () => {
  it('runs one turn and streams text, reasoning, items, and usage to the observer', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const seen = observer()
    const running = h.connection.runTurn('thread-A', {
      input: ['hello', 'world'],
      model: 'gpt-5.6-sol',
      effort: 'high',
    }, signal(), seen)
    const turnStart = await h.peer.nextMethod('turn/start')
    expect(turnStart.params).toEqual({
      threadId: 'thread-A',
      input: [
        { type: 'text', text: 'hello', text_elements: [] },
        { type: 'text', text: 'world', text_elements: [] },
      ],
      model: 'gpt-5.6-sol',
      effort: 'high',
    })
    h.peer.respond(turnStart, { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('turn/started', { threadId: 'thread-A', turn: { id: 'turn-1' } })
    h.peer.notify('item/started', { threadId: 'thread-A', turnId: 'turn-1', item: { type: 'reasoning', id: 'r1' } })
    h.peer.notify('item/reasoning/textDelta', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'r1', contentIndex: 0, delta: 'thinking ' })
    h.peer.notify('item/reasoning/summaryTextDelta', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'r1', summaryIndex: 0, delta: 'summary' })
    h.peer.notify('item/completed', { threadId: 'thread-A', turnId: 'turn-1', item: { type: 'reasoning', id: 'r1' } })
    h.peer.notify('item/started', { threadId: 'thread-A', turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1' } })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'm1', delta: 'Hi ' })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'm1', delta: 'there' })
    h.peer.notify('item/completed', { threadId: 'thread-A', turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1', text: 'Hi there', phase: 'final_answer' } })
    h.peer.notify('thread/tokenUsage/updated', {
      threadId: 'thread-A',
      turnId: 'turn-1',
      tokenUsage: {
        last: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningOutputTokens: 1, totalTokens: 15 },
        total: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningOutputTokens: 1, totalTokens: 15 },
      },
    })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    expect(await running).toEqual({ status: 'completed', turnId: 'turn-1', finalText: 'Hi there' })
    expect(seen.text).toEqual(['Hi ', 'there'])
    expect(seen.reasoning).toEqual(['thinking ', 'summary'])
    expect(seen.items).toEqual([
      'started:reasoning:r1',
      'completed:reasoning:r1',
      'started:agentMessage:m1',
      'completed:agentMessage:m1',
    ])
    expect(seen.usage).toEqual([
      { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningOutputTokens: 1, totalTokens: 15 },
    ])
    h.connection.close()
  })

  it('omits model and effort from turn/start when the caller has none', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['x'] }, signal(), observer())
    const turnStart = await h.peer.nextMethod('turn/start')
    expect(turnStart.params).toEqual({ threadId: 'thread-A', input: [{ type: 'text', text: 'x', text_elements: [] }] })
    h.peer.respond(turnStart, { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    expect(await running).toEqual({ status: 'completed', turnId: 'turn-1', finalText: undefined })
    h.connection.close()
  })

  it('routes notifications by thread and turn so concurrent turns do not cross', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    await startedThread(h, 'thread-B')
    const seenA = observer()
    const seenB = observer()
    const runningA = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), seenA)
    const runningB = h.connection.runTurn('thread-B', { input: ['b'] }, signal(), seenB)
    const startA = await h.peer.next(frame => frame.method === 'turn/start' && (frame.params as JsonObject).threadId === 'thread-A')
    const startB = await h.peer.next(frame => frame.method === 'turn/start' && (frame.params as JsonObject).threadId === 'thread-B')
    h.peer.respond(startA, { turn: { id: 'turn-A1', status: 'inProgress', items: [] } })
    h.peer.respond(startB, { turn: { id: 'turn-B1', status: 'inProgress', items: [] } })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-B', turnId: 'turn-B1', itemId: 'm', delta: 'B says' })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-A', turnId: 'turn-A1', itemId: 'm', delta: 'A says' })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-A', turnId: 'stale-turn', itemId: 'm', delta: 'ignored' })
    h.peer.notify('turn/completed', { threadId: 'thread-B', turn: { id: 'turn-B1', status: 'completed', items: [] } })
    expect(await runningB).toEqual({ status: 'completed', turnId: 'turn-B1', finalText: undefined })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-A1', status: 'completed', items: [] } })
    expect(await runningA).toEqual({ status: 'completed', turnId: 'turn-A1', finalText: undefined })
    expect(seenA.text).toEqual(['A says'])
    expect(seenB.text).toEqual(['B says'])
    h.connection.close()
  })

  it('rejects a second concurrent turn on the same thread', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const first = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    await expect(h.connection.runTurn('thread-A', { input: ['b'] }, signal(), observer()))
      .rejects.toThrow('thread "thread-A" already has an active turn')
    const turnStart = await h.peer.nextMethod('turn/start')
    h.peer.respond(turnStart, { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    await first
    h.connection.close()
  })

  it('reports a failed turn with its coarse classification and message', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('turn/completed', {
      threadId: 'thread-A',
      turn: {
        id: 'turn-1',
        status: 'failed',
        items: [],
        error: { message: 'stream dropped', codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } },
      },
    })
    expect(await running).toEqual({
      status: 'failed',
      turnId: 'turn-1',
      failure: { category: 'transport', httpStatus: 502 },
      message: 'stream dropped',
    })
    h.connection.close()
  })

  it('reports an interrupted turn and keeps the text streamed so far', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const seen = observer()
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), seen)
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'm', delta: 'part' })
    h.connection.interrupt('thread-A', 'turn-1')
    const interrupt = await h.peer.nextMethod('turn/interrupt')
    expect(interrupt.params).toEqual({ threadId: 'thread-A', turnId: 'turn-1' })
    h.peer.respond(interrupt, {})
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'interrupted', items: [] } })
    expect(await running).toEqual({ status: 'interrupted', turnId: 'turn-1' })
    expect(seen.text).toEqual(['part'])
    h.connection.close()
  })

  it('rejects the turn when the caller aborts and frees the thread', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const controller = new AbortController()
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, controller.signal, observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    controller.abort(new Error('caller cancelled'))
    await expect(running).rejects.toThrow('caller cancelled')
    expect(h.connection.activeTurn('thread-A')).toBeUndefined()
    h.connection.close()
  })

  it('exposes the active turn id while a turn runs', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    expect(h.connection.activeTurn('thread-A')).toBeUndefined()
    const turnStart = await h.peer.nextMethod('turn/start')
    h.peer.respond(turnStart, { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    await vi.waitFor(() => { expect(h.connection.activeTurn('thread-A')).toBe('turn-1') })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    await running
    expect(h.connection.activeTurn('thread-A')).toBeUndefined()
    h.connection.close()
  })

  it('fails a turn whose terminal status is not one the protocol defines', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'weird', items: [] } })
    await expect(running).rejects.toThrow('invalid terminal turn status weird')
    h.connection.close()
  })
})

describe('server requests', () => {
  it('routes approval and user-input requests to the handler and answers with its result', async () => {
    const h = harness(async (request) => {
      if (request.method === 'item/tool/requestUserInput') return { answers: { q1: { answers: ['yes'] } } }
      return { decision: 'accept' }
    })
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.request('sr-1', 'item/commandExecution/requestApproval', {
      threadId: 'thread-A', turnId: 'turn-1', itemId: 'c1', command: 'ls', availableDecisions: ['accept', 'decline'],
    })
    expect(await h.peer.nextResponse('sr-1')).toEqual({ jsonrpc: '2.0', id: 'sr-1', result: { decision: 'accept' } })
    h.peer.request('sr-2', 'item/tool/requestUserInput', {
      threadId: 'thread-A', turnId: 'turn-1', itemId: 'q', isBlocking: true, questions: [{ id: 'q1', header: 'H', question: 'Q?' }],
    })
    expect(await h.peer.nextResponse('sr-2')).toEqual({ jsonrpc: '2.0', id: 'sr-2', result: { answers: { q1: { answers: ['yes'] } } } })
    expect(h.requests.map(request => [request.method, request.threadId, request.turnId])).toEqual([
      ['item/commandExecution/requestApproval', 'thread-A', 'turn-1'],
      ['item/tool/requestUserInput', 'thread-A', 'turn-1'],
    ])
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    await running
    h.connection.close()
  })

  it('turns a handler failure into a JSON-RPC error response without killing other threads', async () => {
    const h = harness(async () => { throw new Error('answerer unavailable') })
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.request('sr-1', 'item/fileChange/requestApproval', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'f1' })
    expect(await h.peer.nextResponse('sr-1')).toEqual({
      jsonrpc: '2.0',
      id: 'sr-1',
      error: { code: -32603, message: 'answerer unavailable' },
    })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    expect(await running).toEqual({ status: 'completed', turnId: 'turn-1', finalText: undefined })
    h.connection.close()
  })

  it('passes a request whose thread is unknown to the handler with no turn id', async () => {
    const h = harness()
    await initialized(h)
    h.peer.request('sr-1', 'mcpServer/elicitation/request', { threadId: 'other', turnId: null, itemId: null })
    expect(await h.peer.nextResponse('sr-1')).toEqual({ jsonrpc: '2.0', id: 'sr-1', result: { decision: 'decline' } })
    expect(h.requests).toEqual([{
      method: 'mcpServer/elicitation/request',
      params: { threadId: 'other', turnId: null, itemId: null },
      threadId: 'other',
      turnId: undefined,
    }])
    h.connection.close()
  })
})

describe('catalog and account', () => {
  it('lists visible models across pages', async () => {
    const h = harness()
    await initialized(h)
    const listing = h.connection.listModels(signal())
    const first = await h.peer.nextMethod('model/list')
    expect(first.params).toEqual({ cursor: null, includeHidden: false, limit: 100 })
    h.peer.respond(first, {
      data: [
        { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', description: 'd', hidden: false, isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'l' }, { reasoningEffort: 'high', description: 'h' }], inputModalities: ['text', 'image'] },
        { id: 'hidden-one', model: 'hidden-one', displayName: 'Hidden', description: 'd', hidden: true, isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] },
      ],
      nextCursor: 'page-2',
    })
    const second = await h.peer.nextMethod('model/list')
    expect(second.params).toEqual({ cursor: 'page-2', includeHidden: false, limit: 100 })
    h.peer.respond(second, {
      data: [
        { id: 'gpt-5.6-mini', model: 'gpt-5.6-mini', displayName: 'GPT-5.6 Mini', description: 'small', hidden: false, isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'm' }] },
      ],
      nextCursor: null,
    })
    expect(await listing).toEqual([
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        description: 'd',
        isDefault: true,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: ['low', 'high'],
        inputModalities: ['text', 'image'],
      },
      {
        id: 'gpt-5.6-mini',
        displayName: 'GPT-5.6 Mini',
        description: 'small',
        isDefault: false,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['medium'],
        inputModalities: ['text'],
      },
    ])
    h.connection.close()
  })

  it('reads the account without forcing a token refresh', async () => {
    const h = harness()
    await initialized(h)
    const reading = h.connection.readAccount(signal())
    const read = await h.peer.nextMethod('account/read')
    expect(read.params).toEqual({ refreshToken: false })
    h.peer.respond(read, { account: { type: 'chatgpt', email: 'a@b.c', planType: 'pro' }, requiresOpenaiAuth: true })
    expect(await reading).toEqual({ signedIn: true, requiresOpenaiAuth: true, account: { type: 'chatgpt', email: 'a@b.c', planType: 'pro' } })
    h.connection.close()
  })

  it('reports a signed-out account', async () => {
    const h = harness()
    await initialized(h)
    const reading = h.connection.readAccount(signal())
    h.peer.respond(await h.peer.nextMethod('account/read'), { account: null, requiresOpenaiAuth: true })
    expect(await reading).toEqual({ signedIn: false, requiresOpenaiAuth: true, account: null })
    h.connection.close()
  })
})

describe('edge cases', () => {
  it('replays notifications that arrive before turn/start answers', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const seen = observer()
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), seen)
    const turnStart = await h.peer.nextMethod('turn/start')
    h.peer.notify('turn/started', { threadId: 'thread-A', turn: { id: 'turn-1' } })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'm', delta: 'early' })
    h.peer.notify('item/plan/delta', { threadId: 'thread-A', turnId: 'turn-1', itemId: 'p', delta: 'plan text' })
    h.peer.notify('account/updated', { planType: 'pro' })
    h.peer.notify('item/agentMessage/delta', { threadId: 'thread-Z', turnId: 'turn-1', itemId: 'm', delta: 'other thread' })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(seen.text).toEqual([])
    h.peer.respond(turnStart, { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    await vi.waitFor(() => { expect(seen.text).toEqual(['early']) })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    expect(await running).toEqual({ status: 'completed', turnId: 'turn-1', finalText: undefined })
    h.connection.close()
  })

  it('falls back to the last unphased message when no final answer was marked', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('item/completed', { threadId: 'thread-A', turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1', text: 'thinking aloud', phase: 'commentary' } })
    h.peer.notify('item/completed', { threadId: 'thread-A', turnId: 'turn-1', item: { type: 'agentMessage', id: 'm2', text: 'plain answer', phase: null } })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    expect(await running).toEqual({ status: 'completed', turnId: 'turn-1', finalText: 'plain answer' })
    h.connection.close()
  })

  it('fails the turn on malformed token usage', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    await vi.waitFor(() => { expect(h.connection.activeTurn('thread-A')).toBe('turn-1') })
    h.peer.notify('thread/tokenUsage/updated', {
      threadId: 'thread-A',
      turnId: 'turn-1',
      tokenUsage: { last: { inputTokens: 'ten', cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 } },
    })
    await expect(running).rejects.toThrow('app-server returned invalid token usage inputTokens')
    h.connection.close()
  })

  it('uses a fixed message when a failed turn carries no error object', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'failed', items: [] } })
    expect(await running).toEqual({
      status: 'failed',
      turnId: 'turn-1',
      failure: { category: 'unknown' },
      message: 'Codex turn failed',
    })
    h.connection.close()
  })

  it('fails active turns on an input stream error and an output stream error', async () => {
    const input = harness()
    await initialized(input)
    await startedThread(input, 'thread-A')
    const inputTurn = input.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    input.peer.respond(await input.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    input.fromServer.emit('error', new Error('stdout broke'))
    await expect(inputTurn).rejects.toThrow('stdout broke')
    expect(input.connection.closed).toBe(true)
    input.connection.close()

    const output = harness()
    await initialized(output)
    await startedThread(output, 'thread-A')
    const outputTurn = output.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    output.peer.respond(await output.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    output.toServer.emit('error', new Error('stdin broke'))
    await expect(outputTurn).rejects.toThrow('stdin broke')
    expect(output.connection.closed).toBe(true)
    output.connection.close()
  })

  it('ignores a refused interrupt request', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.connection.interrupt('thread-A', 'turn-1')
    h.peer.respondError(await h.peer.nextMethod('turn/interrupt'), -32000, 'no active turn')
    h.peer.notify('turn/completed', { threadId: 'thread-A', turn: { id: 'turn-1', status: 'completed', items: [] } })
    expect(await running).toEqual({ status: 'completed', turnId: 'turn-1', finalText: undefined })
    h.connection.close()
  })

  it('does not send an interrupt after close', async () => {
    const h = harness()
    await initialized(h)
    h.connection.close()
    h.connection.interrupt('thread-A', 'turn-1')
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(h.peer.pending().filter(frame => frame.method === 'turn/interrupt')).toEqual([])
  })

  it('rejects a thread/start response whose thread is not an object', async () => {
    const h = harness()
    await initialized(h)
    const starting = h.connection.startThread({ cwd: '/w', permissionMode: 'never' }, signal())
    h.peer.respond(await h.peer.nextMethod('thread/start'), { thread: 'nope' })
    await expect(starting).rejects.toThrow('app-server returned invalid thread/start thread')
    h.connection.close()
  })

  it('tolerates sparse catalog entries and rejects a non-array catalog', async () => {
    const h = harness()
    await initialized(h)
    const listing = h.connection.listModels(signal())
    h.peer.respond(await h.peer.nextMethod('model/list'), {
      data: [
        {
          id: 'bare',
          hidden: false,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: ['not-an-object', { reasoningEffort: '' }, { reasoningEffort: 'medium' }],
          inputModalities: 'text',
        },
        { id: 'barer', hidden: false, defaultReasoningEffort: 'low' },
      ],
      nextCursor: 7,
    })
    expect(await listing).toEqual([
      {
        id: 'bare',
        displayName: 'bare',
        description: '',
        isDefault: false,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['medium'],
        inputModalities: [],
      },
      {
        id: 'barer',
        displayName: 'barer',
        description: '',
        isDefault: false,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [],
        inputModalities: ['text'],
      },
    ])

    const broken = h.connection.listModels(signal())
    h.peer.respond(await h.peer.nextMethod('model/list'), { data: 'nope' })
    await expect(broken).rejects.toThrow('app-server returned invalid model/list data')
    h.connection.close()
  })

  it('treats a missing account field as signed out', async () => {
    const h = harness()
    await initialized(h)
    const reading = h.connection.readAccount(signal())
    h.peer.respond(await h.peer.nextMethod('account/read'), { requiresOpenaiAuth: false })
    expect(await reading).toEqual({ signedIn: false, requiresOpenaiAuth: false, account: null })
    h.connection.close()
  })
})

describe('closure', () => {
  it('fails every active turn when the protocol stream ends', async () => {
    const h = harness()
    await initialized(h)
    await startedThread(h, 'thread-A')
    const running = h.connection.runTurn('thread-A', { input: ['a'] }, signal(), observer())
    h.peer.respond(await h.peer.nextMethod('turn/start'), { turn: { id: 'turn-1', status: 'inProgress', items: [] } })
    h.fromServer.end()
    await expect(running).rejects.toThrow('app-server protocol stream closed')
    expect(h.connection.closed).toBe(true)
    h.connection.close()
  })

  it('rejects new work after close and stays idempotent', async () => {
    const h = harness()
    await initialized(h)
    h.connection.close()
    h.connection.close()
    await expect(h.connection.startThread({ cwd: '/w', permissionMode: 'never' }, signal()))
      .rejects.toThrow('connection is closed')
    expect(h.connection.closed).toBe(true)
  })
})
