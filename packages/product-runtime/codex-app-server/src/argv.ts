/**
 * The package-local Codex wrapper command. This package is the only place the
 * `@openai/codex` runtime is pinned; every consumer starts the wrapper through
 * this argv and never resolves a host `codex` executable.
 *
 * @module @deepseek-ai/dsh-codex-app-server/argv
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

interface CodexPackageManifest {
  readonly bin: {
    readonly codex: string
  }
}

const codexPackageJsonPath = createRequire(import.meta.url).resolve('@openai/codex/package.json')
const codexPackageManifest = JSON.parse(
  readFileSync(codexPackageJsonPath, 'utf8'),
) as CodexPackageManifest

/** Absolute package-local JavaScript wrapper selected by the package manifest. */
const CODEX_PACKAGE_BIN = resolve(
  dirname(codexPackageJsonPath),
  codexPackageManifest.bin.codex,
)

/**
 * Fixed package-local app-server command, independent of the host `PATH`.
 * @returns Node, the official wrapper, and the fixed app-server arguments.
 */
export function codexAppServerArgv(): string[] {
  return [process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']
}
