import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const checker = resolve(import.meta.dirname, 'check-expected-filenames.sh')

// The filename gate runs in a POSIX Bash workflow.
it.skipIf(process.platform === 'win32').each([
  ['android-mobile/android-shell/scripts/golden/session-golden.json', 0],
  ['vendor/example/source.golden.json', 0],
  ['packages/example/source.golden.json', 1],
  ['android-mobile-tools/source.golden.json', 1],
  ['docs/android-mobile/source.golden.json', 1],
])('checks project ownership for %s', (file, status) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-expected-filenames-'))
  try {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{}\n')
    for (const args of [['init', '--quiet'], ['add', '--', file]]) {
      const git = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000 })
      expect(git.error).toBeUndefined()
      expect(git.signal).toBeNull()
      expect(git.status).toBe(0)
    }
    const result = spawnSync('bash', [checker], { cwd: root, encoding: 'utf8', timeout: 10_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(status)
    if (status === 1) expect(result.stderr).toContain(file)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
