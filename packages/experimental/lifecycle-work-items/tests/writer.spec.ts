import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeWriterFs, writeAtomically, type WriterFs } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-writer-'))
  roots.push(root)
  await writeFile(join(root, 'a.md'), 'alpha\n', 'utf8')
  await writeFile(join(root, 'b.md'), 'beta\n', 'utf8')
  return root
}

async function listing(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isFile()) files[entry.name] = await readFile(join(root, entry.name), 'utf8')
  }
  return files
}

function failing(fs: WriterFs, method: keyof WriterFs, onCall: number, code = 'EIO'): WriterFs {
  let calls = 0
  const fail = (): never => {
    const error = new Error(`injected ${method} failure`)
    Object.assign(error, { code })
    throw error
  }
  return {
    ...fs,
    [method]: async (...args: never[]): Promise<unknown> => {
      calls += 1
      if (calls === onCall) fail()
      return (fs[method] as (...inner: never[]) => Promise<unknown>)(...args)
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('writeAtomically', () => {
  const writes = [
    { path: 'a.md', text: 'alpha 2\n' },
    { path: 'nested/c.md', text: 'gamma\n' },
    { path: 'b.md', text: 'beta 2\n' },
  ]

  it('replaces every file through a temporary name and creates missing directories', async () => {
    const root = await workspace()
    await writeAtomically(root, writes)
    expect(await listing(root)).toEqual({ 'a.md': 'alpha 2\n', 'b.md': 'beta 2\n' })
    expect(await readFile(join(root, 'nested', 'c.md'), 'utf8')).toBe('gamma\n')
    expect((await readdir(root)).filter(name => name.includes('.dsh-tmp'))).toEqual([])
  })

  it('restores every written file byte for byte when a later write fails, and removes what it created', async () => {
    const root = await workspace()
    await expect(writeAtomically(root, writes, failing(nodeWriterFs, 'rename', 3))).rejects.toThrow('injected rename failure')
    expect(await listing(root)).toEqual({ 'a.md': 'alpha\n', 'b.md': 'beta\n' })
    expect(await readdir(join(root, 'nested'))).toEqual([])
  })

  it('tolerates a temporary file that was never created and reports a failed rollback', async () => {
    const root = await workspace()
    await expect(writeAtomically(root, writes, failing(nodeWriterFs, 'writeFile', 2))).rejects.toThrow('injected writeFile failure')
    expect(await listing(root)).toEqual({ 'a.md': 'alpha\n', 'b.md': 'beta\n' })
    const broken = failing(failing(nodeWriterFs, 'rename', 2), 'writeFile', 3)
    await expect(writeAtomically(root, writes, broken)).rejects.toBeInstanceOf(AggregateError)
  })

  it('rethrows read errors other than a missing file before writing anything', async () => {
    const root = await workspace()
    await expect(writeAtomically(root, writes, failing(nodeWriterFs, 'readFile', 1, 'EACCES'))).rejects.toThrow('injected readFile failure')
    expect(await listing(root)).toEqual({ 'a.md': 'alpha\n', 'b.md': 'beta\n' })
  })
})
