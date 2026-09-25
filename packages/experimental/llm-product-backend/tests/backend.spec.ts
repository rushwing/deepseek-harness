import { describe, expect, it } from 'vitest'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmError, createAssistantMessage, createUserMessage, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  finishForFailure,
  providerDisplayInfo,
  readBinding,
  requireNewUserInput,
  resolveProductTarget,
  routeOf,
  streamProductTurn,
  thrown,
  unlistedModelInfo,
  type BackendIdentity,
  type ProductTarget,
} from '@deepseek-ai/dsh-experimental-llm-product-backend'

const identity: BackendIdentity = { source: 'llm-test', product: 'Test Product' }
const user = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })

function agentWith(id: string, cwd: string | undefined): Agent {
  return { id: SessionId(id), session: { header: cwd === undefined ? {} : { cwd } } } as Agent
}

function agents(...entries: Agent[]): Pick<AgentRegistry, 'get'> {
  return { get: id => entries.find(agent => agent.id === id) }
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (error: unknown) {
    if (error instanceof LlmError) return error.failure.code
    throw error
  }
  throw new Error('expected a throw')
}

describe('providerDisplayInfo and routeOf', () => {
  it('names the default route after the product and qualifies the others', () => {
    expect(providerDisplayInfo('Codex', 'codex', 'codex')).toEqual({ id: 'codex', name: 'Codex' })
    expect(providerDisplayInfo('Codex', 'codex', 'codex-unattended')).toEqual({ id: 'codex-unattended', name: 'Codex (codex-unattended)' })
    expect(unlistedModelInfo('codex', 'gpt-next')).toEqual({ provider: 'codex', id: 'gpt-next', name: 'gpt-next', inputModalities: ['text'] })
  })

  it('returns the configured route and refuses unknown ones', () => {
    const routes = new Map([['codex', { permissionMode: 'bridge' }]])
    expect(routeOf(identity, routes, 'codex')).toEqual({ permissionMode: 'bridge' })
    expect(code(() => routeOf(identity, routes, 'nope'))).toBe('NO_ROUTE')
  })
})

describe('requireNewUserInput', () => {
  it('returns the trailing user texts and refuses a request without any', () => {
    expect(requireNewUserInput(identity, [user])).toEqual(['hello'])
    const assistant = createAssistantMessage({ content: [{ type: 'text', text: 'reply' }], source: { provider: 'p', model: 'm' } })
    expect(code(() => requireNewUserInput(identity, [user, assistant]))).toBe('EMPTY_REQUEST')
  })
})

describe('resolveProductTarget', () => {
  const bound = agentWith('bound', '/work')
  const homeless = agentWith('homeless', undefined)
  const registry = agents(bound, homeless)
  const request = (extra: Partial<GenerateOptions>): GenerateOptions =>
    markAgentLoopRequest({ provider: 'p', model: 'm', messages: [user], ...extra })

  it('binds loop requests with a live Agent to the Session workspace', () => {
    expect(resolveProductTarget(identity, request({ sessionId: bound.id }), registry, '/host'))
      .toEqual({ kind: 'bound', agent: bound, cwd: '/work' })
  })

  it('runs auxiliary and session-less requests ephemerally in the Agent workspace or the fallback', () => {
    expect(resolveProductTarget(identity, request({ sessionId: bound.id, purpose: 'compaction' }), registry, '/host'))
      .toEqual({ kind: 'ephemeral', cwd: '/work' })
    expect(resolveProductTarget(identity, { provider: 'p', model: 'm', messages: [user] }, registry, '/host'))
      .toEqual({ kind: 'ephemeral', cwd: '/host' })
    expect(resolveProductTarget(identity, request({ sessionId: homeless.id, purpose: 'session-title' }), registry, '/host'))
      .toEqual({ kind: 'ephemeral', cwd: '/host' })
  })

  it('refuses bound requests without a live Agent or a workspace', () => {
    expect(code(() => resolveProductTarget(identity, request({ sessionId: SessionId('ghost') }), registry, '/host'))).toBe('NO_LIVE_AGENT')
    expect(code(() => resolveProductTarget(identity, request({ sessionId: homeless.id }), registry, '/host'))).toBe('NO_WORKSPACE')
  })
})

describe('readBinding', () => {
  const agent = agentWith('bound', '/work')
  const target: ProductTarget = { kind: 'bound', agent, cwd: '/work' }

  it('returns null for ephemeral targets without reading', () => {
    expect(readBinding(identity, 'key', { kind: 'ephemeral', cwd: '/x' }, () => { throw new Error('not read') })).toBeNull()
  })

  it('returns the Session binding when its workspace matches', () => {
    const binding = { conversationId: 'c1', cwd: '/work' }
    expect(readBinding(identity, 'key', target, () => binding)).toBe(binding)
    expect(readBinding(identity, 'key', target, () => null)).toBeNull()
  })

  it('fails loud on a missing projection or a moved workspace', () => {
    expect(code(() => readBinding(identity, 'key', target, () => undefined))).toBe('PROJECTION_MISSING')
    expect(code(() => readBinding(identity, 'key', target, () => ({ conversationId: 'c1', cwd: '/elsewhere' })))).toBe('WORKSPACE_MISMATCH')
  })
})

describe('finishForFailure and streamProductTurn', () => {
  it('converts failures to finishes by signal state and error kind', () => {
    const aborted = new AbortController()
    aborted.abort()
    expect(finishForFailure(new Error('gone'), aborted.signal)).toEqual({ kind: 'aborted', failure: { message: 'gone', code: 'ABORTED' } })
    expect(finishForFailure(new LlmError('limit', 'RATE_LIMIT'), undefined)).toEqual({ kind: 'error', failure: { message: 'limit', code: 'RATE_LIMIT' } })
    expect(finishForFailure('plain string', undefined)).toEqual({ kind: 'error', failure: { message: 'plain string', code: 'UNKNOWN' } })
    expect(thrown(new Error('e')).message).toBe('e')
  })

  it('streams what the turn produced and finishes a rejected turn with its failure', async () => {
    const collect = async (stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> => {
      const chunks: StreamChunk[] = []
      for await (const chunk of stream) chunks.push(chunk)
      return chunks
    }
    const ok = await collect(streamProductTurn(undefined, async (turn) => {
      turn.text('hi')
      turn.finish({ kind: 'stop' })
    }))
    expect(ok.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    const failed = await collect(streamProductTurn(undefined, async (turn) => {
      turn.text('partial')
      throw new LlmError('boom', 'SERVER')
    }))
    expect(failed.some(chunk => chunk.type === 'text-delta' && chunk.text === 'partial')).toBe(true)
    expect(failed.at(-1)).toEqual({ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'SERVER' } } })
  })
})
