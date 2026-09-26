import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, ToolCallId, type GenerateOptions, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LifecycleService, { LIFECYCLE_TABLE, handlesOf } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { agentAt, cleanup, emptyDirectory } from './workspace-helper.ts'

const signal = new AbortController().signal
let calls = 0

afterEach(cleanup)

class CatalogAdapter extends LlmAdapter {
  constructor(private readonly models: Readonly<Record<string, readonly string[]>>) {
    super()
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const ids = this.models[provider]
    return Promise.resolve(ids === undefined ? [] : ids.map(id => ({ provider, id, name: id })))
  }

  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('lifecycle_init must not invoke a model')
  }
}

interface Mounted {
  readonly ctx: Context
  readonly agent: Agent
  readonly root: string
}

interface MountOptions {
  readonly products?: Readonly<Record<string, readonly string[]>>
  readonly defaultModel?: { readonly provider: string; readonly model: string }
}

async function mount(options: MountOptions = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime, {})
  if (options.products !== undefined) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(Object.keys(options.products), new CatalogAdapter(options.products))
  }
  if (options.defaultModel !== undefined) {
    const selection = options.defaultModel
    ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
  }
  await ctx.plugin(LifecycleService, { lifecycleDir: 'lifecycle' })
  const root = await emptyDirectory()
  return { ctx, agent: agentAt(ctx, root, `init-${++calls}`), root }
}

function init(mounted: Mounted, args: unknown) {
  return mounted.ctx.tools.execute({ signal, callId: ToolCallId(`init-${++calls}`), name: 'lifecycle_init', arguments: args, agent: mounted.agent })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const MINIMAL = ['lifecycle/lifecycle.yml', 'lifecycle/agent-registry.yml', 'lifecycle/artifact-contract.yml', 'lifecycle/tasks/id-scheme.yml']
const FULL = [
  ...MINIMAL,
  'lifecycle/GUIDE.md',
  'lifecycle/standards/agent-standard.md',
  'lifecycle/standards/briefs.md',
  'lifecycle/standards/bug-standard.md',
  'lifecycle/standards/requirement-standard.md',
  'lifecycle/standards/review-standard.md',
  'lifecycle/standards/testcase-standard.md',
]

describe('lifecycle_init', () => {
  it('scaffolds a cross-vendor registry when Claude Code and Codex routes exist, and the tables then load clean', async () => {
    const mounted = await mount({ products: { 'claude-code': ['opus', 'sonnet'], codex: ['gpt-5.6-sol', 'gpt-5.6-mini'] } })
    const result = await init(mounted, {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('init failed')
    expect(result.value).toEqual({
      created: MINIMAL,
      skipped: [],
      registry: {
        source: 'cross-vendor',
        activeSet: 'mixed',
        routes: [
          { uid: 'planner-001', provider: 'claude-code', model: 'opus' },
          { uid: 'generator-001', provider: 'claude-code', model: 'opus' },
          { uid: 'evaluator-001', provider: 'claude-code', model: 'opus' },
          { uid: 'planner-002', provider: 'codex', model: 'gpt-5.6-sol' },
          { uid: 'generator-002', provider: 'codex', model: 'gpt-5.6-sol' },
          { uid: 'evaluator-002', provider: 'codex', model: 'gpt-5.6-sol' },
        ],
      },
    })
    expect(text(result)).toBe('Lifecycle scaffolded under lifecycle/: 4 files created; registry from cross-vendor routes (active set mixed).')
    const load = mounted.ctx.lifecycle.load(mounted.root)
    expect(load.problems).toEqual([])
    expect(load.tables?.registry.activeSet).toBe('mixed')
    expect(load.tables?.registry.providerSets.mixed).toEqual({ kind: 'cross_vendor', planner: 'planner-001', generator: 'generator-001', evaluator: 'evaluator-002' })
    expect(load.tables?.idScheme.scopes).toEqual({ core: 'CORE' })
    expect(mounted.ctx.lifecycle.lint(mounted.root)).toEqual({ violations: [], counts: {} })
    expect(mounted.ctx.lifecycle.status(mounted.root)).toEqual({ activeSet: 'mixed', reqs: [] })
    const registry = await readFile(join(mounted.root, 'lifecycle', 'agent-registry.yml'), 'utf8')
    expect(registry).toContain('vendor: anthropic')
    expect(registry).toContain('vendor: openai')
    expect(registry).toContain('effort: high')
    expect(registry).toContain('handles: [ req_review ]')
    expect(registry).toMatch(/fallbacks:\n\s+- provider: codex\n\s+model: gpt-5.6-sol\n\s+vendor: openai/)
  })

  it('falls back to the default model as a same-vendor set, skips existing files, and writes the standards on a full scaffold', async () => {
    const mounted = await mount({ defaultModel: { provider: 'deepseek', model: 'deepseek-v4' } })
    const first = await init(mounted, { scaffold: 'full', scopes: { platform: 'PLAT', 'canonical-bom': 'CBOM' } })
    if (first.isError) throw new Error('init failed')
    expect(first.value).toMatchObject({
      registry: {
        source: 'default-model',
        activeSet: 'default',
        routes: [
          { uid: 'planner-001', provider: 'deepseek', model: 'deepseek-v4' },
          { uid: 'generator-001', provider: 'deepseek', model: 'deepseek-v4' },
          { uid: 'evaluator-001', provider: 'deepseek', model: 'deepseek-v4' },
        ],
      },
    })
    expect(first.value).toMatchObject({ created: FULL })
    expect((await readdir(join(mounted.root, 'lifecycle', 'standards'))).sort()).toEqual([
      'agent-standard.md', 'briefs.md', 'bug-standard.md', 'requirement-standard.md', 'review-standard.md', 'testcase-standard.md',
    ])
    const load = mounted.ctx.lifecycle.load(mounted.root)
    expect(load.problems).toEqual([])
    expect(load.tables?.idScheme.scopes).toEqual({ platform: 'PLAT', 'canonical-bom': 'CBOM' })
    expect(load.tables?.registry.agents.map(agent => String(agent.uid))).toEqual(['planner-001', 'generator-001', 'evaluator-001', 'human-001'])
    expect(await readFile(join(mounted.root, 'lifecycle', 'agent-registry.yml'), 'utf8')).not.toContain('effort:')
    expect(mounted.ctx.lifecycle.briefs(mounted.root).problems).toEqual([])
    const again = await init(mounted, { scaffold: 'full' })
    if (again.isError) throw new Error('init failed')
    expect(again.value).toMatchObject({ created: [], skipped: FULL })
    expect(text(again)).toBe('Lifecycle already scaffolded under lifecycle/: 0 files created, 11 kept; registry from the default model (active set default).')
  })

  it('prefers the product routes over the default model and fails loud without any route', async () => {
    const both = await mount({ products: { 'claude-code': ['opus'], codex: ['gpt-5.6-sol'] }, defaultModel: { provider: 'deepseek', model: 'deepseek-v4' } })
    const result = await init(both, {})
    if (result.isError) throw new Error('init failed')
    expect(result.value).toMatchObject({ registry: { source: 'cross-vendor' } })
    const oneProduct = await mount({ products: { codex: ['gpt-5.6-sol'] }, defaultModel: { provider: 'deepseek', model: 'deepseek-v4' } })
    const partial = await init(oneProduct, {})
    if (partial.isError) throw new Error('init failed')
    expect(partial.value).toMatchObject({ registry: { source: 'default-model' } })
    expect(JSON.stringify(partial.value)).toContain('{"uid":"planner-001","provider":"deepseek","model":"deepseek-v4"}')
    const noModels = await mount({ products: { 'claude-code': [], codex: ['gpt-5.6-sol'] } })
    const empty = await init(noModels, {})
    if (!empty.isError) throw new Error('expected failure')
    expect(empty.error).toMatchObject({ info: { code: 'NO_ROUTE' } })
    expect(text(empty)).toContain("route 'claude-code' advertises no models")
    const nothing = await mount()
    const none = await init(nothing, {})
    if (!none.isError) throw new Error('expected failure')
    expect(none.error).toMatchObject({ info: { code: 'NO_ROUTE' } })
    expect(text(none)).toContain('no LLM route to seat the roles')
    expect(await readdir(nothing.root)).toEqual([])
  })

  it('derives the registry handles from the table and refuses a table that does not load', () => {
    const handles = handlesOf(LIFECYCLE_TABLE)
    expect(handles.roles.map(([role]) => role)).toEqual(['planner', 'generator', 'evaluator'])
    expect([...handles.human].sort()).toEqual(['blocked', 'done', 'draft', 'pr_draft', 'req_review'])
    expect(() => handlesOf('version: 1\n')).toThrow('the lifecycle table does not load')
  })

  it('rejects a bad scope map and presents the call', async () => {
    const mounted = await mount({ defaultModel: { provider: 'deepseek', model: 'deepseek-v4' } })
    const bad = await init(mounted, { scopes: { platform: 'plat' } })
    if (!bad.isError) throw new Error('expected failure')
    expect(text(bad)).toContain("scope 'platform' prefix 'plat' must be 1 to 6 uppercase letters")
    expect(await readdir(mounted.root)).toEqual([])
    expect(mounted.ctx.tools.get('lifecycle_init')?.presentCall?.({ scaffold: 'full' })).toEqual({ card: 'generic', title: 'Scaffold the lifecycle directory (full)', kind: 'other' })
    expect(mounted.ctx.tools.get('lifecycle_init')?.presentCall?.({})).toEqual({ card: 'generic', title: 'Scaffold the lifecycle directory (minimal)', kind: 'other' })
  })
})
