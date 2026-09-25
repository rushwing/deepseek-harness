#!/usr/bin/env node
/** Inspect the public Claude Code backend composition without invoking the product. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-llm'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
const bundlePatchPath = process.argv[3]
if (configPath === undefined || bundlePatchPath === undefined) {
  throw new Error('llm-claude-code Loader composition driver requires config and Bundle patch paths')
}

const ctx = await bootProductionProfile({
  binName: 'llm-claude-code-loader-composition',
  profile: 'headless',
  overlayPaths: [
    resolveConfigPath(bundlePatchPath, undefined),
    resolveConfigPath(configPath, undefined),
  ],
})

try {
  const providers = ctx.llm.listProviders()
    .filter(provider => provider.id.startsWith('claude-code'))
    .sort((a, b) => a.id.localeCompare(b.id))
  process.stdout.write(`${JSON.stringify({
    providers,
    presetRegistry: ctx.get('agentPresets') === undefined ? 'absent' : 'present',
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
