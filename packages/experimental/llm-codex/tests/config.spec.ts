import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Config, resolveCodexBackendSpec } from '@deepseek-ai/dsh-experimental-llm-codex'

describe('resolveCodexBackendSpec', () => {
  it('defaults to one bridged codex route with the safe process settings', () => {
    const spec = resolveCodexBackendSpec(new Config({}))
    expect([...spec.routes.entries()]).toEqual([['codex', { permissionMode: 'bridge' }]])
    expect(spec.env).toEqual({})
    expect(spec.disposeGraceMs).toBe(3000)
    expect(spec.turnIdleTimeoutMs).toBeUndefined()
  })

  it('keeps every configured route with its own permission mode', () => {
    const spec = resolveCodexBackendSpec(new Config({
      routes: {
        codex: {},
        'codex-unattended': { permissionMode: 'never' },
        'codex-bypass': { permissionMode: 'dangerously-bypass-approvals-and-sandbox' },
      },
      env: { CODEX_HOME: '/tmp/codex-home' },
      disposeGraceMs: 500,
      turnIdleTimeoutMs: 60_000,
    }))
    expect([...spec.routes.entries()]).toEqual([
      ['codex', { permissionMode: 'bridge' }],
      ['codex-unattended', { permissionMode: 'never' }],
      ['codex-bypass', { permissionMode: 'dangerously-bypass-approvals-and-sandbox' }],
    ])
    expect(spec.env).toEqual({ CODEX_HOME: '/tmp/codex-home' })
    expect(spec.disposeGraceMs).toBe(500)
    expect(spec.turnIdleTimeoutMs).toBe(60_000)
  })

  it('fails loud on an empty route set, an empty route name, or an invalid grace', () => {
    expect(() => resolveCodexBackendSpec(new Config({ routes: {} }))).toThrow('at least one route')
    expect(() => resolveCodexBackendSpec(new Config({ routes: { '': {} } }))).toThrow('route names must be non-empty')
    expect(() => resolveCodexBackendSpec(new Config({ disposeGraceMs: 0 }))).toThrow('disposeGraceMs')
    expect(() => resolveCodexBackendSpec(new Config({ disposeGraceMs: MAX_TIMER_DELAY_MS + 1 }))).toThrow('disposeGraceMs')
    expect(() => resolveCodexBackendSpec(new Config({ turnIdleTimeoutMs: -1 }))).toThrow('turnIdleTimeoutMs')
  })
})
