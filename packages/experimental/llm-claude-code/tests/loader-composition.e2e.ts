import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const PRODUCTION_PROFILE_PROCESS_TIMEOUT_MS = 60_000
const PRODUCTION_PROFILE_TEST_TIMEOUT_MS = PRODUCTION_PROFILE_PROCESS_TIMEOUT_MS + 15_000

const fixtureDir = fileURLToPath(new URL('./fixtures/loader/', import.meta.url))
const driver = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'llm-claude-code.patch.yml')
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dsh?: { bundle?: { patch?: string } }
}
const bundlePatch = manifest.dsh?.bundle?.patch
if (bundlePatch === undefined) throw new Error('Claude Code backend package must declare a Bundle patch')
const bundlePatchPath = join(packageDir, bundlePatch)
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('Claude Code backend public Loader composition', () => {
  it('registers the configured routes in the headless profile without starting the product', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'llm-claude-code Loader composition',
      tempDirPrefix: 'dsh-llm-claude-code-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      binArgs: [configPath, bundlePatchPath],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: PRODUCTION_PROFILE_PROCESS_TIMEOUT_MS,
      env: {
        // Loading the optional package must not probe or start the product.
        PATH: '',
      },
    })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      providers: [
        { id: 'claude-code', name: 'Claude Code' },
        { id: 'claude-code-unattended', name: 'Claude Code (claude-code-unattended)' },
      ],
      presetRegistry: 'absent',
    })
  }, PRODUCTION_PROFILE_TEST_TIMEOUT_MS)
})
