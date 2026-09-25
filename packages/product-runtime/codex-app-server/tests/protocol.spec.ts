import { describe, expect, it } from 'vitest'
import {
  abortError,
  expectObject,
  expectString,
  raceAbort,
  turnFailureInfo,
  unattendedDecision,
} from '@deepseek-ai/dsh-codex-app-server'

describe('frame validation', () => {
  it('names the source and label when a member has the wrong type', () => {
    expect(() => expectObject(null, 'thread')).toThrow('codex app-server: app-server returned invalid thread')
    expect(() => expectObject([], 'thread', 'my-client')).toThrow('my-client: app-server returned invalid thread')
    expect(() => expectString('', 'id')).toThrow('codex app-server: app-server returned invalid id')
    expect(expectObject({ a: 1 }, 'thread')).toEqual({ a: 1 })
    expect(expectString('x', 'id')).toBe('x')
  })
})

describe('raceAbort', () => {
  it('rejects immediately when the signal is already aborted, with a synthesized message for non-Error reasons', async () => {
    const controller = new AbortController()
    controller.abort('operator stop')
    await expect(raceAbort(Promise.reject(new Error('late protocol failure')), controller.signal))
      .rejects.toThrow('codex app-server: app-server request aborted: operator stop')
    expect(abortError(controller.signal, 'my-client').message).toBe('my-client: app-server request aborted: operator stop')
  })

  it('passes the pending value through when nothing aborts', async () => {
    await expect(raceAbort(Promise.resolve(42), new AbortController().signal)).resolves.toBe(42)
  })

  it('rejects with the Error reason when aborted while pending', async () => {
    const controller = new AbortController()
    const pending = raceAbort(new Promise<never>(() => {}), controller.signal)
    controller.abort(new Error('late stop'))
    await expect(pending).rejects.toThrow('late stop')
  })
})

describe('unattendedDecision', () => {
  it('prefers cancel, then decline, from the offered decisions', () => {
    expect(unattendedDecision({ availableDecisions: ['accept', 'cancel', 'decline'] })).toBe('cancel')
    expect(unattendedDecision({ availableDecisions: ['accept', 'decline'] })).toBe('decline')
  })

  it('declines when the request offers no decision list', () => {
    expect(unattendedDecision({})).toBe('decline')
    expect(unattendedDecision({ availableDecisions: null })).toBe('decline')
  })

  it('fails loud when the offered list has no unattended decision', () => {
    expect(() => unattendedDecision({ availableDecisions: ['accept'] }))
      .toThrow('offered no unattended approval decision')
    expect(() => unattendedDecision({ availableDecisions: 'accept' }))
      .toThrow('offered no unattended approval decision')
  })
})

describe('turnFailureInfo', () => {
  it('classifies string error codes into coarse categories', () => {
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'contextWindowExceeded' } }))
      .toEqual({ category: 'limit', maxTokens: true })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'usageLimitExceeded' } }))
      .toEqual({ category: 'limit' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'sessionBudgetExceeded' } }))
      .toEqual({ category: 'limit' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'serverOverloaded' } }))
      .toEqual({ category: 'service' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'internalServerError' } }))
      .toEqual({ category: 'service' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'unauthorized' } }))
      .toEqual({ category: 'access-policy' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'cyberPolicy' } }))
      .toEqual({ category: 'access-policy' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'misalignmentPolicyViolation' } }))
      .toEqual({ category: 'access-policy' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'threadRollbackFailed' } }))
      .toEqual({ category: 'product-error' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'other' } }))
      .toEqual({ category: 'product-error' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'sandboxError' } }))
      .toEqual({ category: 'access-policy', sandboxFailure: true })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'badRequest' } }))
      .toEqual({ category: 'product-error' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 'somethingNew' } }))
      .toEqual({ category: 'unknown' })
  })

  it('classifies structured transport errors and keeps a valid HTTP status', () => {
    expect(turnFailureInfo({
      status: 'failed',
      error: { codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } } },
    })).toEqual({ category: 'transport', httpStatus: 502 })
    expect(turnFailureInfo({
      status: 'failed',
      error: { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 70_000 } } },
    })).toEqual({ category: 'transport' })
    expect(turnFailureInfo({
      status: 'failed',
      error: { codexErrorInfo: { activeTurnNotSteerable: {} } },
    })).toEqual({ category: 'product-error' })
    expect(turnFailureInfo({
      status: 'failed',
      error: { codexErrorInfo: { somethingNewer: {} } },
    })).toEqual({ category: 'unknown' })
  })

  it('returns unknown for malformed or non-failed turns', () => {
    expect(turnFailureInfo({ status: 'interrupted' })).toEqual({ category: 'unknown' })
    expect(turnFailureInfo({ status: 'failed', error: null })).toEqual({ category: 'unknown' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: 7 } })).toEqual({ category: 'unknown' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: { a: {}, b: {} } } }))
      .toEqual({ category: 'unknown' })
    expect(turnFailureInfo({ status: 'failed', error: { codexErrorInfo: { httpConnectionFailed: 'x' } } }))
      .toEqual({ category: 'unknown' })
  })
})
