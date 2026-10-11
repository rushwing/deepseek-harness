/** Exercise browser CPU ownership through the runner's real child processes. */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const exec = promisify(execFile)
const svg = 'apps/web/tests/present-svg.e2e.ts'

async function fixture(failSvg = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-runner-'))
  const calls = join(root, 'calls.jsonl')
  const entry = join(root, 'pnpm.cjs')
  try {
    await writeFile(entry, `
      const { appendFileSync } = require('node:fs');
      const args = process.argv.slice(2);
      appendFileSync(process.env.TEST_WEB_CALLS, JSON.stringify(args) + '\\n');
      if (process.env.TEST_WEB_FAIL_SVG === 'true' && args.includes('${svg}')) process.exitCode = 7;
    `)
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    root,
    run: () => exec(process.execPath, ['--import', 'tsx', 'scripts/run-web-snapshots.ts'], {
      env: { ...process.env, npm_execpath: entry, DSH_WEB_SNAPSHOT_WORKERS: '4',
        TEST_WEB_CALLS: calls, TEST_WEB_FAIL_SVG: String(failSvg) },
    }),
    async invocations(): Promise<string[][]> {
      return (await readFile(calls, 'utf8')).trim().split('\n').map((line) => {
        const args: unknown = JSON.parse(line)
        if (!Array.isArray(args)) throw new Error('expected an argument array')
        return args.map((arg) => {
          if (typeof arg !== 'string') throw new Error('expected a string argument')
          return arg
        })
      })
    },
  }
}

it('runs the SVG burst once with exclusive CPU before the remaining browser pool', async () => {
  const owner = await fixture()
  try {
    await owner.run()
    const calls = await owner.invocations()
    const svgCalls = calls.filter(args => args.includes(svg))
    expect(svgCalls).toHaveLength(1)
    expect(svgCalls[0]).not.toContain('--fileParallelism')
    const pool = calls.findIndex(args => args.includes('--fileParallelism'))
    expect(pool).toBeGreaterThan(calls.findIndex(args => args.includes(svg)))
    expect(calls[pool]).toContain(`--exclude=${svg}`)
    expect(calls[pool]).toContain('--maxWorkers=4')
  } finally {
    await rm(owner.root, { recursive: true, force: true })
  }
})

it('propagates an SVG failure without starting the browser pool', async () => {
  const owner = await fixture(true)
  try {
    await expect(owner.run()).rejects.toMatchObject({ code: 7 })
    expect((await owner.invocations()).some(args => args.includes('--fileParallelism'))).toBe(false)
  } finally {
    await rm(owner.root, { recursive: true, force: true })
  }
})
