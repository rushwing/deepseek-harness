/** The Claude Code backend bundle must carry one parseable layer: the adapter row plus a Web-only preset row. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { Config } from '@deepseek-ai/dsh-experimental-llm-claude-code'

describe('Claude Code backend bundle', () => {
  it('declares a public parseable layer with the adapter row and a profile-gated preset row', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-agent-preset': 'workspace:*',
      '@deepseek-ai/dsh-persona': 'workspace:*',
    })

    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), { schema: entryListSchema })
    const patches = parsed as { insert?: { id?: string; name?: string; disabled?: unknown; config?: Record<string, unknown> }[] }[]
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted.map(entry => entry.id)).toEqual(['llm-claude-code', 'preset-claude-code'])
    const adapter = inserted[0]!
    expect(adapter.name).toBe('@deepseek-ai/dsh-experimental-llm-claude-code')
    expect(adapter.disabled).toBeUndefined()
    expect(Object.keys(new Config(adapter.config ?? {}).routes ?? {})).toEqual(['claude-code'])

    const preset = inserted[1]!
    expect(preset.name).toBe('@deepseek-ai/dsh-agent-preset')
    expect(preset.disabled).toBeDefined()
    expect(preset.config).toMatchObject({
      id: 'claude-code',
      name: 'Claude Code',
      order: 51,
      plugins: [{
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: { complete: true, includeRuntimeContext: false },
      }],
    })
  })
})
