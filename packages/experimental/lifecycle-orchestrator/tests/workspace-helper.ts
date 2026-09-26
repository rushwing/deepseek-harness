import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LifecycleService from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'

const FIXTURE = fileURLToPath(new URL('./fixtures/workspace/', import.meta.url))
const roots: string[] = []

export const REQ_010 = 'lifecycle/tasks/features/platform/REQ-PLAT-010.md'
export const REQ_009 = 'lifecycle/tasks/archive/done/REQ-PLAT-009.md'
export const TC_009_01 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-009-01.md'

/** A fresh copy of the fixture workspace in a temporary directory. */
export async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-orchestrator-'))
  roots.push(root)
  await cp(FIXTURE, root, { recursive: true })
  return root
}

/** An empty temporary directory. */
export async function emptyDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-orchestrator-empty-'))
  roots.push(root)
  return root
}

/** Remove every directory created by `workspace` and `emptyDirectory`. */
export async function cleanup(): Promise<void> {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
}

/** Replace one frontmatter line of a workspace file. */
export async function setField(root: string, relative: string, key: string, value: string): Promise<void> {
  const path = join(root, relative)
  const text = await readFile(path, 'utf8')
  const pattern = new RegExp(`^${key}:.*$`, 'm')
  if (!pattern.test(text)) throw new Error(`${relative} has no field ${key}`)
  await writeFile(path, text.replace(pattern, `${key}: ${value}`), 'utf8')
}

/** Remove the provider sets, active set, and seats from the fixture registry. */
export async function withoutProviderSets(root: string): Promise<void> {
  const path = join(root, 'lifecycle', 'agent-registry.yml')
  const text = await readFile(path, 'utf8')
  const start = text.indexOf('provider_sets:')
  const end = text.indexOf('agents:')
  if (start < 0 || end < start) throw new Error('fixture registry has no provider_sets block before agents')
  await writeFile(path, text.slice(0, start) + text.slice(end), 'utf8')
}

/** Overwrite a workspace file. */
export async function writeText(root: string, relative: string, text: string): Promise<void> {
  await writeFile(join(root, relative), text, 'utf8')
}

/** A context with the real prompt, tool, and lifecycle services mounted. */
export async function setup(lifecycleDir = 'lifecycle'): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime, {})
  await ctx.plugin(LifecycleService, { lifecycleDir })
  return ctx
}

/** A complete Agent whose Session was created in `cwd`, or without a working directory. */
/** Session header facts a test agent may carry beyond its working directory. */
export interface AgentHeader {
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly parentSession?: SessionId
}

export function agentAt(ctx: Context, cwd: string | undefined, id = 'lifecycle-agent', header: AgentHeader = {}): Agent {
  const scope = ctx.plugin(() => {})
  const sessionId = SessionId(id)
  const session = cwd === undefined
    ? Session.create(sessionId)
    : Session.create(sessionId, undefined, {
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, cwd, isSeeded: false, ...header,
    })
  return {
    id: sessionId,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}
