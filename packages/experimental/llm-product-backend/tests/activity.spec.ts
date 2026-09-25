import { describe, expect, it } from 'vitest'
import { activityLine } from '@deepseek-ai/dsh-experimental-llm-product-backend'

describe('activityLine', () => {
  it('describes commands by status and exit code on one line', () => {
    expect(activityLine({ kind: 'command', command: 'ls -la', status: 'started' })).toBe('running `ls -la`')
    expect(activityLine({ kind: 'command', command: 'ls -la', status: 'completed', exitCode: 0 })).toBe('ran `ls -la` (exit 0)')
    expect(activityLine({ kind: 'command', command: 'make', status: 'completed' })).toBe('ran `make`')
    expect(activityLine({ kind: 'command', command: 'make', status: 'failed', exitCode: 2 })).toBe('command `make` failed (exit 2)')
    expect(activityLine({ kind: 'command', command: 'rm -rf x', status: 'declined' })).toBe('declined command `rm -rf x`')
  })

  it('collapses whitespace and bounds long commands', () => {
    expect(activityLine({ kind: 'command', command: 'git \n  status\t--short', status: 'completed' })).toBe('ran `git status --short`')
    const long = 'x'.repeat(300)
    const line = activityLine({ kind: 'command', command: long, status: 'started' })
    expect(line.length).toBeLessThan(220)
    expect(line.endsWith('…`')).toBe(true)
  })

  it('describes file changes with their paths', () => {
    expect(activityLine({ kind: 'file-change', paths: ['a.ts'], status: 'started' })).toBe('editing a.ts')
    expect(activityLine({ kind: 'file-change', paths: ['a.ts', 'b.ts'], status: 'completed' })).toBe('edited a.ts, b.ts')
    expect(activityLine({ kind: 'file-change', paths: [], status: 'completed' })).toBe('edited files')
    expect(activityLine({ kind: 'file-change', paths: ['a.ts'], status: 'failed' })).toBe('failed to edit a.ts')
    expect(activityLine({ kind: 'file-change', paths: ['a.ts'], status: 'declined' })).toBe('declined edits to a.ts')
  })

  it('describes other tools by name', () => {
    expect(activityLine({ kind: 'tool', name: 'web_search', status: 'started' })).toBe('using tool web_search')
    expect(activityLine({ kind: 'tool', name: 'web_search', status: 'completed' })).toBe('used tool web_search')
    expect(activityLine({ kind: 'tool', name: 'web_search', status: 'failed' })).toBe('tool web_search failed')
    expect(activityLine({ kind: 'tool', name: 'web_search', status: 'declined' })).toBe('declined tool web_search')
  })
})
