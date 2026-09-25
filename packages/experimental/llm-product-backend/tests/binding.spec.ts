import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  SessionLogOffset,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
} from '@deepseek-ai/dsh-session'
import {
  bindingProjection,
  conversationMissing,
  productNotSignedIn,
  productConversationBindingSchema,
  type ProductConversationBinding,
} from '@deepseek-ai/dsh-experimental-llm-product-backend'

// Test-local event vocabulary standing in for the two backends' binding events.
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test-backend/thread': ProductConversationBinding
    'test-backend/other': ProductConversationBinding
  }
}

const header = { id: brandString<SessionId>('s1') } as SessionHeader

function bindingEvent(
  type: 'test-backend/thread' | 'test-backend/other',
  data: ProductConversationBinding,
): SessionEvent<'test-backend/thread' | 'test-backend/other'> {
  return { type, seq: SessionSeq(1), time: 1, data }
}

describe('bindingProjection', () => {
  const projection = bindingProjection('testThread', 'test-backend/thread')

  const unbound: ProductConversationBinding | null = null

  it('starts unbound and binds on its own event', () => {
    expect(projection.key).toBe('testThread')
    expect(projection.stateVersion).toBe(1)
    expect(projection.init(header, SessionLogOffset(0))).toBeNull()
    const bound = projection.apply(unbound, bindingEvent('test-backend/thread', { conversationId: 'thread-A', cwd: '/work' }))
    expect(bound).toEqual({ conversationId: 'thread-A', cwd: '/work' })
    const rebound = projection.apply(bound, bindingEvent('test-backend/thread', { conversationId: 'thread-B', cwd: '/work', model: 'm' }))
    expect(rebound).toEqual({ conversationId: 'thread-B', cwd: '/work', model: 'm' })
  })

  it('returns the same state reference for events it does not own', () => {
    const state = { conversationId: 'thread-A', cwd: '/work' }
    expect(projection.apply(state, bindingEvent('test-backend/other', { conversationId: 'x', cwd: '/w' }))).toBe(state)
  })

  it('fails loud on a malformed binding event', () => {
    const malformed = { ...bindingEvent('test-backend/thread', { conversationId: 'thread-A', cwd: '/work' }), data: { cwd: '/work' } }
    expect(() => projection.apply(unbound, malformed as SessionEvent)).toThrow()
    expect(productConversationBindingSchema.safeParse(null).success).toBe(true)
    expect(productConversationBindingSchema.safeParse({ conversationId: '', cwd: '/w' }).success).toBe(false)
  })
})

describe('errors', () => {
  it('names the product and conversation in a missing-conversation error', () => {
    const error = conversationMissing('Codex', 'thread-A')
    expect(error.failure.code).toBe('PRODUCT_CONVERSATION_MISSING')
    expect(error.message).toContain('thread-A')
    expect(error.message).toContain('Codex')
    expect(error.message).not.toContain('said:')
    expect(conversationMissing('Codex', 'thread-A', 'thread not found').message).toContain('(Codex said: thread not found)')
  })

  it('tells the user how to sign in when the product has no account', () => {
    const error = productNotSignedIn('Codex', 'codex login')
    expect(error.failure.code).toBe('MISSING_CREDENTIAL')
    expect(error.message).toContain('codex login')
  })
})
