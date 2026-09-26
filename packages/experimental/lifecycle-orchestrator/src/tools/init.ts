/**
 * The `lifecycle_init` tool: scaffold the lifecycle directory of the calling
 * Session's workspace from the English defaults, seating the roles on the
 * model routes the deployment has.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/tools/init
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: declares the optional `ctx.agentDefaultModel` service read at init.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { loadLifecycleTable, roleStates } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import { writeAtomically, type FileWrite } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { BRIEFS } from '../defaults/briefs.ts'
import { GUIDE, STANDARDS } from '../defaults/standards.ts'
import { ARTIFACT_CONTRACT, LIFECYCLE_TABLE } from '../defaults/tables.ts'
import { LifecycleError } from '../errors.ts'
import type { LifecycleService } from '../index.ts'
import { callerOf } from '../tools.ts'

/** One seated agent of the scaffolded registry. */
export interface SeatedRoute {
  readonly uid: string
  readonly provider: string
  readonly model: string
}

/** How the scaffolded registry was seated. */
export interface RegistryPlan {
  /** `cross-vendor` from Claude Code and Codex routes, or `default-model` from the agent default model. */
  readonly source: 'cross-vendor' | 'default-model'
  readonly activeSet: string
  readonly routes: SeatedRoute[]
  /** The rendered `agent-registry.yml`. */
  readonly text: string
}

const MINIMAL = 'minimal'
const FULL = 'full'
const DEFAULT_SCOPES: Readonly<Record<string, string>> = { core: 'CORE' }
const PREFIX = /^[A-Z]{1,6}$/
const CLAUDE_CODE = 'claude-code'
const CODEX = 'codex'
const VENDOR_ANTHROPIC = 'anthropic'
const VENDOR_OPENAI = 'openai'
const EFFORT = 'high'
const ROLES: readonly string[] = ['planner', 'generator', 'evaluator']
const ROLE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  planner: 'Expand a requirement into scope, technical direction, and task decomposition without implementation detail',
  generator: 'Implement iteratively against the specification (test code, product code, documents) and self-check before delivery',
  evaluator: 'Independent quality gate: write the test-case text that fixes acceptance, review every stage, and run the gates',
  human: 'Human orchestrator: scope approval, final merge, unblocking, and model selection',
}
const HUMAN_UID = 'human-001'
const HUMAN_ROLE = 'human'

function flow(items: readonly string[]): string {
  return `[ ${items.join(', ')} ]`
}

interface Route {
  readonly provider: string
  readonly model: string
  readonly vendor: string
}

function agentYaml(
  uid: string, role: string, route: Route, fallbacks: readonly Route[], handles: readonly string[], effort?: string,
): string {
  const lines = [
    `  - uid: ${uid}`,
    `    role: ${role}`,
    `    vendor: ${route.vendor}`,
    `    route: { provider: ${route.provider}, model: ${route.model} }`,
    ...(effort === undefined ? [] : [`    effort: ${effort}`]),
  ]
  if (fallbacks.length === 0) lines.push('    fallbacks: []')
  else {
    lines.push('    fallbacks:')
    for (const fallback of fallbacks) {
      lines.push(`      - provider: ${fallback.provider}`, `        model: ${fallback.model}`, `        vendor: ${fallback.vendor}`)
    }
  }
  lines.push(`    handles: ${flow(handles)}`)
  return lines.join('\n')
}

function registryYaml(
  sets: readonly string[],
  activeSet: string,
  seats: readonly string[],
  agents: readonly string[],
  humanHandles: readonly string[],
): string {
  return [
    '---',
    '# Agent registry scaffolded by lifecycle_init: the single truth of role <-> route.',
    '# Each agent\'s `handles` equals the states lifecycle.yml derives for its role.',
    '',
    'version: 1',
    '',
    'roles:',
    ...Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => `  ${role}: "${description}"`),
    '',
    'provider_sets:',
    ...sets,
    '',
    `active_set: ${activeSet}`,
    '',
    ...(seats.length === 0 ? [] : ['seats:', ...seats, '']),
    'agents:',
    ...agents,
    '',
    `  - uid: ${HUMAN_UID}`,
    '    role: human',
    `    description: "${ROLE_DESCRIPTIONS.human}"`,
    `    handles: ${flow(humanHandles)}`,
    '',
  ].join('\n')
}

/** The states each role works in, with the human's states apart. */
export interface Handles {
  readonly roles: readonly (readonly [role: string, states: readonly string[]])[]
  readonly human: readonly string[]
}

/**
 * The role states of a lifecycle table text, split into the seated roles and the human.
 * @param tableText - a `lifecycle.yml` text; the scaffold passes the default table.
 * @returns the handles.
 * @throws when the text does not load as a lifecycle table.
 */
export function handlesOf(tableText: string): Handles {
  const load = loadLifecycleTable(tableText)
  if (load.table === undefined) throw new Error(`the lifecycle table does not load: ${load.problems.join('; ')}`)
  const entries = Object.entries(roleStates(load.table))
  return {
    roles: entries.filter(([role]) => ROLES.includes(role)),
    human: entries.filter(([role]) => role === HUMAN_ROLE).flatMap(([, states]) => states),
  }
}

function crossVendorPlan(claude: Route, codex: Route): RegistryPlan {
  const handles = handlesOf(LIFECYCLE_TABLE)
  const seat = (ordinal: string, route: Route, fallback: Route): { uid: string; yaml: string }[] => handles.roles.map(([role, states]) => {
    const uid = `${role}-${ordinal}`
    return { uid, yaml: agentYaml(uid, role, route, [fallback], states, EFFORT) }
  })
  const anthropic = seat('001', claude, codex)
  const openai = seat('002', codex, claude)
  const sets = [
    '  anthropic:', '    kind: same_vendor', '    planner: planner-001', '    generator: generator-001', '    evaluator: evaluator-001',
    '  openai:', '    kind: same_vendor', '    planner: planner-002', '    generator: generator-002', '    evaluator: evaluator-002',
    '  mixed:', '    kind: cross_vendor', '    planner: planner-001', '    generator: generator-001', '    evaluator: evaluator-002',
  ]
  const agents = [...anthropic, ...openai]
  return {
    source: 'cross-vendor',
    activeSet: 'mixed',
    routes: [
      ...anthropic.map(agent => ({ uid: agent.uid, provider: claude.provider, model: claude.model })),
      ...openai.map(agent => ({ uid: agent.uid, provider: codex.provider, model: codex.model })),
    ],
    text: registryYaml(sets, 'mixed', ['  tc_impl_review: evaluator-001'], agents.map(agent => agent.yaml), handles.human),
  }
}

function defaultModelPlan(route: Route): RegistryPlan {
  const handles = handlesOf(LIFECYCLE_TABLE)
  const agents = handles.roles.map(([role, states]) => ({ uid: `${role}-001`, yaml: agentYaml(`${role}-001`, role, route, [], states) }))
  const sets = ['  default:', '    kind: same_vendor', '    planner: planner-001', '    generator: generator-001', '    evaluator: evaluator-001']
  return {
    source: 'default-model',
    activeSet: 'default',
    routes: agents.map(agent => ({ uid: agent.uid, provider: route.provider, model: route.model })),
    text: registryYaml(sets, 'default', [], agents.map(agent => agent.yaml), handles.human),
  }
}

async function modelRoute(llm: LlmRuntime, id: string, vendor: string): Promise<Route> {
  const first = (await llm.listModels(id))[0]
  if (first === undefined) throw new LifecycleError('NO_ROUTE', `route '${id}' advertises no models; lifecycle_init never invents model names`)
  return { provider: id, model: first.id, vendor }
}

/**
 * Seat the roles on the deployment's routes: a cross-vendor set when Claude
 * Code and Codex routes both advertise models, else a same-vendor set on the
 * agent default model. Model names are never invented.
 * @param ctx - the context whose optional `llm` and `agentDefaultModel` services are read.
 * @returns the plan.
 * @throws `NO_ROUTE` when a product route advertises no models or no route exists at all.
 */
export async function planRegistry(ctx: Context): Promise<RegistryPlan> {
  const llm = ctx.get('llm')
  if (llm !== undefined) {
    const ids = llm.listProviders().map(provider => provider.id)
    const pick = (prefix: string): string | undefined => ids.find(id => id === prefix) ?? ids.find(id => id.startsWith(prefix))
    const claude = pick(CLAUDE_CODE)
    const codex = pick(CODEX)
    if (claude !== undefined && codex !== undefined) {
      const [claudeRoute, codexRoute] = await Promise.all([
        modelRoute(llm, claude, VENDOR_ANTHROPIC),
        modelRoute(llm, codex, VENDOR_OPENAI),
      ])
      return crossVendorPlan(claudeRoute, codexRoute)
    }
  }
  const defaults = ctx.get('agentDefaultModel')
  if (defaults === undefined) {
    throw new LifecycleError('NO_ROUTE', 'no LLM route to seat the roles: register Claude Code and Codex routes or set an agent default model')
  }
  const selection = defaults.currentSelection()
  return defaultModelPlan({ provider: selection.provider, model: selection.model, vendor: selection.provider })
}

function idSchemeYaml(scopes: Readonly<Record<string, string>>): string {
  return [
    '---',
    '# Work-item id scheme: the single truth of scope directory <-> id prefix.',
    '#   <lifecycleDir>/tasks/features/<scope>/REQ-<PREFIX>-NNN.md',
    '#   <lifecycleDir>/tasks/test-cases/<scope>/TC-<PREFIX>-NNN-SS.md',
    '#   <lifecycleDir>/tasks/bugs/<scope>/BUG-<PREFIX>-NNN.md',
    '#   <lifecycleDir>/tasks/reviews/<scope>/RV-<PREFIX>-NNN.md',
    '#   <lifecycleDir>/tasks/plans/<scope>/PL-<PREFIX>-NNN.md',
    '',
    'scopes:',
    ...Object.entries(scopes).map(([directory, prefix]) => `  ${directory}: ${prefix}`),
    '',
  ].join('\n')
}

function scopesOf(raw: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, string>> {
  if (raw === undefined) return DEFAULT_SCOPES
  const scopes: Record<string, string> = {}
  for (const [directory, prefix] of Object.entries(raw)) {
    if (typeof prefix !== 'string' || !PREFIX.test(prefix)) {
      throw new LifecycleError('INVALID_SCOPE', `scope '${directory}' prefix '${String(prefix)}' must be 1 to 6 uppercase letters`)
    }
    scopes[directory] = prefix
  }
  return scopes
}

/**
 * The `lifecycle_init` tool.
 * @param service - the lifecycle service, for the directory name.
 * @param ctx - the plugin context whose optional model services seat the roles.
 * @returns the tool definition.
 */
export function initTool(service: LifecycleService, ctx: Context): ToolDefinition {
  return defineTool({
    name: 'lifecycle_init',
    description: 'Scaffold the lifecycle directory in the workspace: the lifecycle table, an agent registry seated on the available model routes, the artifact '
      + 'contract, and the id scheme; a full scaffold also writes the handbook, the standards, and the role briefs. Existing files are kept.',
    parameters: {
      scaffold: {
        type: 'string',
        enum: [MINIMAL, FULL],
        description: 'minimal writes the four tables; full also writes GUIDE.md, standards/, and briefs. Default minimal.',
      },
      scopes: {
        type: 'object',
        additionalProperties: true,
        description: 'Scope directory to id prefix (1 to 6 uppercase letters), such as { "platform": "PLAT" }. Default { "core": "CORE" }.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          created: { type: 'array', required: true, items: { type: 'string' } },
          skipped: { type: 'array', required: true, items: { type: 'string' } },
          registry: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              source: { type: 'string', required: true, enum: ['cross-vendor', 'default-model'] },
              activeSet: { type: 'string', required: true },
              routes: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { uid: { type: 'string', required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const verb = value.created.length === 0 ? 'already scaffolded' : 'scaffolded'
        const kept = value.skipped.length === 0 ? '' : `, ${value.skipped.length} kept`
        const source = value.registry.source === 'cross-vendor' ? 'cross-vendor routes' : 'the default model'
        return [{
          type: 'text',
          text: `Lifecycle ${verb} under ${service.dir}/: ${value.created.length} files created${kept}; registry from ${source} (active set ${value.registry.activeSet}).`,
        }]
      },
    },
    execute: async (args, exec) => {
      const { cwd } = callerOf(exec, 'lifecycle_init')
      const scopes = scopesOf(args.scopes)
      const plan = await planRegistry(ctx)
      const dir = service.dir
      const files: FileWrite[] = [
        { path: `${dir}/lifecycle.yml`, text: LIFECYCLE_TABLE },
        { path: `${dir}/agent-registry.yml`, text: plan.text },
        { path: `${dir}/artifact-contract.yml`, text: ARTIFACT_CONTRACT },
        { path: `${dir}/tasks/id-scheme.yml`, text: idSchemeYaml(scopes) },
      ]
      if (args.scaffold === FULL) {
        files.push({ path: `${dir}/GUIDE.md`, text: GUIDE })
        const standards = Object.entries({ ...STANDARDS, 'briefs.md': BRIEFS }).sort(([left], [right]) => left.localeCompare(right))
        for (const [name, text] of standards) files.push({ path: `${dir}/standards/${name}`, text })
      }
      const created = files.filter(file => !existsSync(join(cwd, ...file.path.split('/'))))
      const skipped = files.filter(file => !created.includes(file)).map(file => file.path)
      await writeAtomically(cwd, created)
      return {
        created: created.map(file => file.path),
        skipped,
        registry: { source: plan.source, activeSet: plan.activeSet, routes: plan.routes },
      }
    },
    presentCall: args => ({ card: 'generic', title: `Scaffold the lifecycle directory (${args.scaffold === FULL ? FULL : MINIMAL})`, kind: 'other' }),
  })
}
