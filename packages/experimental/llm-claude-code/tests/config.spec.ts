import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Config, resolveClaudeCodeBackendSpec } from '@deepseek-ai/dsh-experimental-llm-claude-code'

describe('resolveClaudeCodeBackendSpec', () => {
  it('defaults to one bridged claude-code route with the safe process settings', () => {
    const spec = resolveClaudeCodeBackendSpec(new Config({}))
    expect([...spec.routes.entries()]).toEqual([['claude-code', { permissionMode: 'bridge' }]])
    expect(spec.env).toEqual({})
    expect(spec.disposeGraceMs).toBe(3000)
    expect(spec.turnIdleTimeoutMs).toBeUndefined()
  })

  it('keeps every configured route with its own permission mode', () => {
    const spec = resolveClaudeCodeBackendSpec(new Config({
      routes: {
        'claude-code': {},
        'claude-code-unattended': { permissionMode: 'dontAsk' },
        'claude-code-bypass': { permissionMode: 'bypassPermissions' },
      },
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-home' },
      disposeGraceMs: 500,
      turnIdleTimeoutMs: 60_000,
    }))
    expect([...spec.routes.entries()]).toEqual([
      ['claude-code', { permissionMode: 'bridge' }],
      ['claude-code-unattended', { permissionMode: 'dontAsk' }],
      ['claude-code-bypass', { permissionMode: 'bypassPermissions' }],
    ])
    expect(spec.env).toEqual({ CLAUDE_CONFIG_DIR: '/tmp/claude-home' })
    expect(spec.disposeGraceMs).toBe(500)
    expect(spec.turnIdleTimeoutMs).toBe(60_000)
  })

  it('fails loud on an empty route set, an empty route name, or an invalid duration', () => {
    expect(() => resolveClaudeCodeBackendSpec(new Config({ routes: {} }))).toThrow('at least one route')
    expect(() => resolveClaudeCodeBackendSpec(new Config({ routes: { '': {} } }))).toThrow('route names must be non-empty')
    expect(() => resolveClaudeCodeBackendSpec(new Config({ disposeGraceMs: 0 }))).toThrow('disposeGraceMs')
    expect(() => resolveClaudeCodeBackendSpec(new Config({ disposeGraceMs: MAX_TIMER_DELAY_MS + 1 }))).toThrow('disposeGraceMs')
    expect(() => resolveClaudeCodeBackendSpec(new Config({ turnIdleTimeoutMs: -1 }))).toThrow('turnIdleTimeoutMs')
  })
})
