import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  createAssistantMessage,
  createSystemMessage,
  createUserMessage,
  markAgentLoopRequest,
  type GenerateOptions,
  type RequestMessage,
} from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { isEphemeralRequest, newUserInput } from '@deepseek-ai/dsh-experimental-llm-product-backend'

const user = (text: string): RequestMessage =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistant = (text: string): RequestMessage =>
  createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'codex', model: 'gpt-5.6-sol' } })

describe('newUserInput', () => {
  it('returns the user messages after the last assistant message, in order', () => {
    expect(newUserInput([
      createSystemMessage('You are dsh.'),
      user('first'),
      assistant('reply one'),
      user('second'),
      user('third'),
    ])).toEqual(['second', 'third'])
  })

  it('returns every user message when no assistant message exists yet', () => {
    expect(newUserInput([createSystemMessage('sys'), user('hello')])).toEqual(['hello'])
  })

  it('concatenates the text blocks of one message and skips messages with no text', () => {
    expect(newUserInput([
      assistant('a'),
      createUserMessage({
        content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }],
        source: { kind: 'user' },
      }),
      createUserMessage({ content: [], source: { kind: 'user' } }),
      { role: 'user', content: [{ type: 'text', text: 'request-only input' }] },
    ])).toEqual(['line one\nline two', 'request-only input'])
  })

  it('keeps only text blocks of a user message', () => {
    expect(newUserInput([
      createUserMessage({
        content: [{ type: 'reasoning', text: 'not user text' }, { type: 'text', text: 'kept' }],
        source: { kind: 'user' },
      }),
    ])).toEqual(['kept'])
  })

  it('ignores system, developer, and tool messages after the last assistant message', () => {
    expect(newUserInput([
      assistant('a'),
      createSystemMessage('updated prompt'),
      user('ask'),
    ])).toEqual(['ask'])
  })

  it('returns nothing when the last message is the assistant', () => {
    expect(newUserInput([user('a'), assistant('b')])).toEqual([])
    expect(newUserInput([])).toEqual([])
  })
})

describe('isEphemeralRequest', () => {
  const base = (): GenerateOptions => ({ provider: 'codex', model: 'm', messages: [], sessionId: brandString<SessionId>('s1') })

  it('treats a loop-built Session request as bound', () => {
    expect(isEphemeralRequest(markAgentLoopRequest(base()))).toBe(false)
  })

  it('treats auxiliary purposes, sessionless requests, and unmarked requests as ephemeral', () => {
    expect(isEphemeralRequest(markAgentLoopRequest({ ...base(), purpose: 'session-title' }))).toBe(true)
    expect(isEphemeralRequest(markAgentLoopRequest({ ...base(), purpose: 'compaction' }))).toBe(true)
    expect(isEphemeralRequest(markAgentLoopRequest({ provider: 'codex', model: 'm', messages: [] }))).toBe(true)
    expect(isEphemeralRequest(base())).toBe(true)
  })
})
