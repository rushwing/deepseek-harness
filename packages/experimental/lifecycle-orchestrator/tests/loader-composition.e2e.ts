import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const PRODUCTION_PROFILE_PROCESS_TIMEOUT_MS = 90_000
const PRODUCTION_PROFILE_TEST_TIMEOUT_MS = PRODUCTION_PROFILE_PROCESS_TIMEOUT_MS + 15_000

const fixtureDir = fileURLToPath(new URL('./fixtures/loader/', import.meta.url))
const driver = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'lifecycle.patch.yml')
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('lifecycle orchestrator public Loader composition', () => {
  it('scaffolds, lints, and reports a lifecycle directory in the headless profile, and HMR disposal removes every registration', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'lifecycle-orchestrator Loader composition',
      tempDirPrefix: 'dsh-lifecycle-orchestrator-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: PRODUCTION_PROFILE_PROCESS_TIMEOUT_MS,
      env: {
        // The scaffold seats the roles on the headless default model; no product route may be probed.
        PATH: '',
      },
    })

    expect(stderr).toBe('')
    const report = JSON.parse(stdout) as {
      init: { created?: string[]; skipped?: string[]; registry?: { source: string; activeSet: string }; error?: string }
      lint: { violations?: unknown[]; error?: string }
      status: { reqs?: unknown[]; activeSet?: string; error?: string }
      lintEvents: { version: number; scope: string; violationCount: number }[]
      before: { tools: string[]; section: string; commands: string[]; service: string }
      after: { tools: string[]; commands: string[]; service: string }
    }
    expect(report.init.error).toBeUndefined()
    expect(report.init.created).toHaveLength(11)
    expect(report.init.skipped).toEqual([])
    expect(report.init.registry).toMatchObject({ source: 'default-model', activeSet: 'default' })
    expect(report.lint).toEqual({ violations: [], counts: {} })
    expect(report.status).toEqual({ activeSet: 'default', reqs: [] })
    expect(report.lintEvents).toEqual([{ version: 1, scope: 'all', violationCount: 0, ruleCounts: {} }])
    expect(report.before).toEqual({ tools: ['lifecycle_check_in', 'lifecycle_init', 'lifecycle_lint', 'lifecycle_status'], section: 'present', commands: ['lifecycle'], service: 'present' })
    expect(report.after).toEqual({ tools: [], commands: [], service: 'absent' })
  }, PRODUCTION_PROFILE_TEST_TIMEOUT_MS)
})
