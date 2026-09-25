import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexAppServerArgv, threadPermissionParams } from '@deepseek-ai/dsh-codex-app-server'
import { CodexAppServerHost } from '@deepseek-ai/dsh-experimental-llm-codex'
import { completeHandshake, fakeSpawner } from './fake-app-server.ts'

const signal = (): AbortSignal => new AbortController().signal

function host(spawner = fakeSpawner(), stderr?: string[]): CodexAppServerHost {
  return new CodexAppServerHost({
    spawn: spawner.spawn,
    cwd: '/host',
    env: { CODEX_HOME: '/home/codex' },
    disposeGraceMs: 1234,
    handler: async () => ({ decision: 'decline' }),
    ...stderr === undefined ? {} : { stderr: (chunk: Buffer) => { stderr.push(chunk.toString()) } },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CodexAppServerHost', () => {
  it('starts nothing until the first connection is requested, then spawns the pinned command once', async () => {
    const spawner = fakeSpawner()
    const h = host(spawner)
    expect(spawner.children).toHaveLength(0)
    const first = h.connection(signal())
    const second = h.connection(signal())
    const child = await spawner.nextChild()
    expect(child.spec.argv).toEqual(codexAppServerArgv())
    expect(child.spec.cwd).toBe('/host')
    expect(child.spec.env).toEqual({ CODEX_HOME: '/home/codex' })
    expect(child.spec.graceMs).toBe(1234)
    expect(child.spec.stdio).toEqual({ stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    await completeHandshake(child)
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(spawner.children).toHaveLength(1)
    await h.dispose()
  })

  it('forwards the product stderr to the host sink, whether the stream yields bytes or text', async () => {
    const spawner = fakeSpawner()
    const lines: string[] = []
    const h = host(spawner, lines)
    const connecting = h.connection(signal())
    const child = await spawner.nextChild()
    child.stderr.write('codex: warning\n')
    child.stderr.setEncoding('utf8')
    child.stderr.write('codex: second\n')
    await completeHandshake(child)
    await connecting
    expect(lines.join('')).toBe('codex: warning\ncodex: second\n')
    await h.dispose()
  })

  it('writes the product stderr to the Host process stderr when no sink is given', async () => {
    const written: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    const spawner = fakeSpawner()
    const h = host(spawner)
    const connecting = h.connection(signal())
    const child = await spawner.nextChild()
    child.stderr.write('codex: to the host\n')
    await completeHandshake(child)
    await connecting
    expect(written.join('')).toContain('codex: to the host')
    await h.dispose()
  })

  it('reports a process the seam could not run and lets the next request retry', async () => {
    const spawner = fakeSpawner()
    const h = host(spawner)
    const connecting = h.connection(signal())
    const child = await spawner.nextChild()
    child.fail(new Error('spawn failed: ENOENT'))
    await expect(connecting).rejects.toThrow()
    const retrying = h.connection(signal())
    const second = await spawner.nextChild()
    await completeHandshake(second)
    await retrying
    await h.dispose()
  })

  it('terminates once when disposed during the handshake', async () => {
    const spawner = fakeSpawner()
    const h = host(spawner)
    const connecting = h.connection(signal())
    const child = await spawner.nextChild()
    await h.dispose()
    await expect(connecting).rejects.toThrow()
    expect(child.terminated()).toBe(1)
  })

  it('respawns after the process exits and forgets the threads the old process served', async () => {
    const spawner = fakeSpawner()
    const h = host(spawner)
    const connecting = h.connection(signal())
    const child = await spawner.nextChild()
    await completeHandshake(child)
    const connection = await connecting
    h.markThreadLive('thread-A')
    expect(h.threadIsLive('thread-A')).toBe(true)
    child.settle({ exitCode: 1, signal: null })
    await expect(connection.startThread({ cwd: '/w', permission: threadPermissionParams('never') }, signal()))
      .rejects.toThrow()
    expect(h.threadIsLive('thread-A')).toBe(false)
    const reconnecting = h.connection(signal())
    const replacement = await spawner.nextChild()
    await completeHandshake(replacement)
    const next = await reconnecting
    expect(next).not.toBe(connection)
    expect(spawner.children).toHaveLength(2)
    await h.dispose()
  })

  it('reports a failed handshake and lets the next request retry', async () => {
    const spawner = fakeSpawner()
    const h = host(spawner)
    const connecting = h.connection(signal())
    const child = await spawner.nextChild()
    child.peer.respondError(await child.peer.nextMethod('initialize'), -32000, 'not ready')
    await expect(connecting).rejects.toThrow('not ready')
    expect(child.terminated()).toBe(1)
    const retrying = h.connection(signal())
    const second = await spawner.nextChild()
    await completeHandshake(second)
    await retrying
    await h.dispose()
  })

  it('terminates the process on dispose and refuses connections afterwards', async () => {
    const spawner = fakeSpawner()
    const h = host(spawner)
    const connecting = h.connection(signal())
    const child = await spawner.nextChild()
    await completeHandshake(child)
    const connection = await connecting
    await h.dispose()
    expect(child.terminated()).toBe(1)
    expect(connection.closed).toBe(true)
    await expect(h.connection(signal())).rejects.toThrow('host is disposed')
    await h.dispose()
  })

  it('disposes cleanly when no process was ever started', async () => {
    const h = host()
    await expect(h.dispose()).resolves.toBeUndefined()
  })
})
