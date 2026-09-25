import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { query as officialQuery, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import {
  CLAUDE_CODE_PERMISSION_MODES,
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  ManagedClaudeCodeProcess,
  SUPPORTED_UNATTENDED_DIALOG_KINDS,
  claudeSpawnSpec,
  query,
  sdkEnvironmentOverlay,
} from '@deepseek-ai/dsh-claude-agent-sdk'

const CLAUDE_AGENT_SDK_VERSION = '0.3.263'
const CLAUDE_CODE_VERSION = '2.1.263'
const CLAUDE_PLATFORM_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-darwin-x64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
  '@anthropic-ai/claude-agent-sdk-linux-x64',
  '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  '@anthropic-ai/claude-agent-sdk-win32-arm64',
  '@anthropic-ai/claude-agent-sdk-win32-x64',
] as const

describe('product runtime pin', () => {
  it('is the single package that pins the official Agent SDK and its platform payloads', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      dependencies?: Record<string, string>
    }
    expect(manifest.name).toBe('@deepseek-ai/dsh-claude-agent-sdk')
    expect(manifest.dependencies).toHaveProperty('@anthropic-ai/claude-agent-sdk', CLAUDE_AGENT_SDK_VERSION)
    expect(manifest.dependencies).toHaveProperty('@anthropic-ai/sdk', '0.93.0')
    expect(manifest.dependencies).toHaveProperty('@modelcontextprotocol/sdk', '^1.29.0')
    expect(manifest.dependencies).toHaveProperty('zod', '^4.4.3')

    const providerManifest = JSON.parse(readFileSync(
      resolve(root, '../../subagent/subagent-claude-code/package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> }
    expect(providerManifest.dependencies).not.toHaveProperty('@anthropic-ai/claude-agent-sdk')
    expect(providerManifest.dependencies).toHaveProperty('@deepseek-ai/dsh-claude-agent-sdk', 'workspace:*')

    const sdkRoot = dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')))
    const sdkManifest = JSON.parse(readFileSync(resolve(sdkRoot, 'package.json'), 'utf8')) as {
      version: string
      claudeCodeVersion: string
      optionalDependencies: Record<string, string>
    }
    expect(sdkManifest.version).toBe(CLAUDE_AGENT_SDK_VERSION)
    expect(sdkManifest.claudeCodeVersion).toBe(CLAUDE_CODE_VERSION)
    expect(sdkManifest.optionalDependencies).toEqual(Object.fromEntries(
      CLAUDE_PLATFORM_PACKAGES.map(packageName => [packageName, CLAUDE_AGENT_SDK_VERSION]),
    ))
    const lockfile = readFileSync(resolve(root, '../../../pnpm-lock.yaml'), 'utf8')
    for (const packageName of CLAUDE_PLATFORM_PACKAGES) {
      expect(lockfile).toContain(`  '${packageName}@${CLAUDE_AGENT_SDK_VERSION}':`)
    }
  })

  it('re-exports the official query entry point unchanged', () => {
    expect(query).toBe(officialQuery)
  })
})

describe('permission modes', () => {
  it('lists the native non-interactive modes with dontAsk as the safe default', () => {
    expect(CLAUDE_CODE_PERMISSION_MODES).toEqual(['dontAsk', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'])
    expect(DEFAULT_CLAUDE_CODE_PERMISSION_MODE).toBe('dontAsk')
    expect(SUPPORTED_UNATTENDED_DIALOG_KINDS).toEqual(['refusal_fallback_prompt'])
  })
})

function sdkSpawnOptions(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    command: '/bin/claude',
    args: ['--print'],
    cwd: '/work',
    env: { PATH: '/usr/bin', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' },
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('spawn projection', () => {
  it('translates an SDK spawn request into a fully explicit subprocess spec', () => {
    const signal = new AbortController().signal
    const spec = claudeSpawnSpec(sdkSpawnOptions({ signal }), 2_500)
    expect(spec.argv).toEqual(['/bin/claude', '--print'])
    expect(spec.cwd).toBe('/work')
    expect(spec.stdio).toEqual({ stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
    expect(spec.graceMs).toBe(2_500)
    expect(spec.signal).toBe(signal)
    expect(spec.env?.PATH).toBe('/usr/bin')
    expect(spec.env?.CLAUDE_CODE_ENTRYPOINT).toBe('sdk-ts')
  })

  it('refuses an SDK spawn request without a workspace', () => {
    const missingCwd = sdkSpawnOptions()
    delete (missingCwd as { cwd?: string }).cwd
    expect(() => claudeSpawnSpec(missingCwd, 1_000))
      .toThrow('claude-agent-sdk: SDK spawn request omitted its workspace')
    expect(() => claudeSpawnSpec(sdkSpawnOptions({ cwd: '' }), 1_000))
      .toThrow('claude-agent-sdk: SDK spawn request omitted its workspace')
  })

  it('tombstones surviving ambient names the SDK removed from its environment', () => {
    const overlay = sdkEnvironmentOverlay({ KEEP: 'yes' })
    expect(overlay.KEEP).toBe('yes')
    const ambient = Object.keys(process.env).find(name => !(name in overlay) || overlay[name] === undefined)
    if (ambient !== undefined) {
      expect(ambient in overlay).toBe(true)
      expect(overlay[ambient]).toBeUndefined()
    }
  })

  it('projects a managed handle as an SDK process with exit and kill facts', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let settle!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => { settle = resolve })
    let terminated = 0
    const handle: SubprocessHandle = {
      control: undefined,
      stdin,
      stdout,
      stderr: undefined,
      collected: {},
      done,
      terminate: () => { terminated += 1 },
      waitForExit: async () => true,
    }
    const managed = new ManagedClaudeCodeProcess(handle)
    expect(managed.stdin).toBe(stdin)
    expect(managed.stdout).toBe(stdout)
    expect(managed.killed).toBe(false)
    expect(managed.exitCode).toBeNull()
    expect(managed.signalCode).toBeNull()
    expect(managed.kill('SIGTERM')).toBe(true)
    expect(managed.kill('SIGTERM')).toBe(false)
    expect(terminated).toBe(1)
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      managed.once('exit', (code, signal) => { resolve([code, signal]) })
    })
    settle({ exitCode: 0, signal: null })
    expect(await exited).toEqual([0, null])
    expect(managed.exitCode).toBe(0)
    expect(managed.outcome).toEqual({ exitCode: 0, signal: null })
    expect(managed.kill('SIGTERM')).toBe(false)
  })
})
