/** The experimental bundle must carry one parseable, explicit lifecycle team layer. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'

describe('lifecycle team profile bundle', () => {
  it('declares a public parseable layer that inserts the orchestrator and the fallback and keeps Ralph off', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dependencies?: Record<string, string>
      icon?: string
      exports?: Record<string, unknown>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.icon).toBe('./icon.svg')
    expect(manifest.exports?.['./locale/*.json']).toBe('./locale/*.json')
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-experimental-lifecycle-model-fallback': 'workspace:*',
      '@deepseek-ai/dsh-experimental-lifecycle-orchestrator': 'workspace:*',
    })
    for (const locale of ['en', 'zh']) {
      const meta = JSON.parse(readFileSync(resolve(root, 'locale', `${locale}.json`), 'utf8')) as { meta?: { title?: string; description?: string } }
      expect(meta.meta?.title).toEqual(expect.any(String))
      expect(meta.meta?.description).toEqual(expect.any(String))
    }

    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      id?: string
      disabled?: boolean
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    expect(patches.find(patch => patch.id === 'tool-ralph')).toMatchObject({ disabled: true })
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted.find(entry => entry.id === 'lifecycle-orchestrator')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-lifecycle-orchestrator',
      config: { lifecycleDir: 'lifecycle', maxStepsPerRun: 8, humanDecisions: 'ask', proposalChannel: 'auto', subagentProvider: 'spawn' },
    })
    expect(inserted.find(entry => entry.id === 'lifecycle-model-fallback')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-lifecycle-model-fallback',
      config: { lifecycleDir: 'lifecycle', maxHops: 2 },
    })
  })
})
