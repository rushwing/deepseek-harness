import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { assertDuration, resolveRoutes } from '@deepseek-ai/dsh-experimental-llm-product-backend'

describe('resolveRoutes', () => {
  it('keeps every configured route with its own mode in configuration order', () => {
    const routes = resolveRoutes('llm-test', {
      codex: { permissionMode: 'bridge' },
      'codex-unattended': { permissionMode: 'never' },
    })
    expect([...routes.entries()]).toEqual([
      ['codex', { permissionMode: 'bridge' }],
      ['codex-unattended', { permissionMode: 'never' }],
    ])
  })

  it('fails loud on an empty route set or an empty route name', () => {
    expect(() => resolveRoutes('llm-test', {})).toThrow('llm-test: routes must declare at least one route')
    expect(() => resolveRoutes('llm-test', { '': { permissionMode: 'bridge' } })).toThrow('llm-test: route names must be non-empty')
  })
})

describe('assertDuration', () => {
  it('accepts positive finite durations up to the timer ceiling and rejects the rest', () => {
    expect(() => { assertDuration('llm-test', 'disposeGraceMs', 1) }).not.toThrow()
    expect(() => { assertDuration('llm-test', 'disposeGraceMs', MAX_TIMER_DELAY_MS) }).not.toThrow()
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMER_DELAY_MS + 1]) {
      expect(() => { assertDuration('llm-test', 'disposeGraceMs', value) })
        .toThrow(`llm-test: disposeGraceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
    }
  })
})
