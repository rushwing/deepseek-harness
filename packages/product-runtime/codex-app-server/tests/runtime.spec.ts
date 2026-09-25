import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  codexAppServerArgv,
  threadPermissionParams,
} from '@deepseek-ai/dsh-codex-app-server'

const CODEX_VERSION = '0.153.4'
const CODEX_PLATFORM_PACKAGES = [
  '@openai/codex-darwin-arm64',
  '@openai/codex-darwin-x64',
  '@openai/codex-linux-arm64',
  '@openai/codex-linux-x64',
  '@openai/codex-win32-arm64',
  '@openai/codex-win32-x64',
] as const

describe('product runtime pin', () => {
  it('is the single package that pins the official Codex wrapper and every platform alias', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      dependencies?: Record<string, string>
    }
    expect(manifest.name).toBe('@deepseek-ai/dsh-codex-app-server')
    expect(manifest.dependencies).toHaveProperty('@openai/codex', CODEX_VERSION)

    const providerManifest = JSON.parse(readFileSync(
      resolve(root, '../../subagent/subagent-codex/package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> }
    expect(providerManifest.dependencies).not.toHaveProperty('@openai/codex')
    expect(providerManifest.dependencies).toHaveProperty('@deepseek-ai/dsh-codex-app-server', 'workspace:*')

    const codexPackageJson = fileURLToPath(import.meta.resolve('@openai/codex/package.json'))
    const codexManifest = JSON.parse(readFileSync(codexPackageJson, 'utf8')) as {
      version: string
      bin: { codex: string }
      optionalDependencies: Record<string, string>
    }
    expect(codexManifest.version).toBe(CODEX_VERSION)
    expect(codexManifest.optionalDependencies).toEqual(Object.fromEntries(
      CODEX_PLATFORM_PACKAGES.map(packageName => [
        packageName,
        `npm:@openai/codex@${CODEX_VERSION}-${packageName.slice('@openai/codex-'.length)}`,
      ]),
    ))
    expect(codexAppServerArgv()).toEqual([
      process.execPath,
      resolve(dirname(codexPackageJson), codexManifest.bin.codex),
      'app-server',
      '--stdio',
    ])

    const lockfile = readFileSync(resolve(root, '../../../pnpm-lock.yaml'), 'utf8')
    for (const packageName of CODEX_PLATFORM_PACKAGES) {
      const suffix = packageName.slice('@openai/codex-'.length)
      expect(lockfile).toContain(`  '@openai/codex@${CODEX_VERSION}-${suffix}':`)
    }
  })
})

describe('permission modes', () => {
  it('maps every native non-interactive mode to its official thread/start fields', () => {
    expect(CODEX_PERMISSION_MODES).toEqual([
      'never',
      'approve-for-me',
      'dangerously-bypass-approvals-and-sandbox',
    ])
    expect(DEFAULT_CODEX_PERMISSION_MODE).toBe('never')
    expect(threadPermissionParams('never')).toEqual({ approvalPolicy: 'never' })
    expect(threadPermissionParams('approve-for-me')).toEqual({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
    })
    expect(threadPermissionParams('dangerously-bypass-approvals-and-sandbox')).toEqual({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    })
  })

  it('returns a fresh object per call so callers cannot mutate the shared table', () => {
    const first = threadPermissionParams('never')
    const second = threadPermissionParams('never')
    expect(first).not.toBe(second)
  })
})
