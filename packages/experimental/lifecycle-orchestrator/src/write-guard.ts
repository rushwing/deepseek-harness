/**
 * The write guard: while a role child runs, first-party file-write tool calls
 * made with the child's identity are refused when their target lies in the
 * artifact tree outside the step's write scope. Shell and product-native
 * writes bypass tools and are caught by the post-step diff instead.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/write-guard
 */

import { isAbsolute, join, normalize, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ArtifactGraph } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import { denialOf, type WriteScope } from './scope.ts'
import { isRecord } from './tools/transition.ts'

/** The step a child session is running. */
export interface StepCell {
  readonly cwd: string
  readonly tasksDir: string
  readonly scope: WriteScope
  readonly pre: ArtifactGraph
}

type Execution = Parameters<ToolGuard>[0]
type PathOf = (args: Readonly<Record<string, unknown>>) => unknown

const WRITING_COMMANDS: ReadonlySet<unknown> = new Set(['create', 'str_replace', 'insert'])

/** The target path argument of each first-party tool that writes a file. */
const WRITE_TOOL_PATHS: Readonly<Record<string, PathOf>> = {
  write: args => args.file_path,
  edit: args => args.file_path,
  str_replace_editor: args => (WRITING_COMMANDS.has(args.command) ? args.path : undefined),
}

function labelOf(cwd: string, target: string): string | undefined {
  const absolute = isAbsolute(target) ? normalize(target) : join(cwd, target)
  const path = relative(cwd, absolute)
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return undefined
  return path.split(sep).join('/')
}

/**
 * One guard over the tool registry, keyed by the driver Session id: while a
 * step runs, every agent whose Session names that driver Session as its
 * parent is fenced, so the fence is armed before the child exists.
 */
export class WriteGuard {
  private readonly cells = new Map<string, StepCell>()

  constructor(ctx: Context) {
    ctx.tools.guard(execution => this.reasonFor(execution))
  }

  /**
   * Fence the children of a driver Session for one step.
   * @param driverSessionId - the Session id of the agent that runs the step.
   * @param cell - the step.
   * @returns the closer that lifts the fence.
   */
  open(driverSessionId: string, cell: StepCell): () => void {
    this.cells.set(driverSessionId, cell)
    return () => {
      this.cells.delete(driverSessionId)
    }
  }

  /**
   * Judge one tool execution.
   * @param execution - the call as the registry prepared it.
   * @returns the denial reason, or `undefined` to abstain.
   */
  reasonFor(execution: Execution): string | undefined {
    const parent = execution.agent?.session.header.parentSession
    if (parent === undefined) return undefined
    const cell = this.cells.get(String(parent))
    if (cell === undefined) return undefined
    const pathOf = WRITE_TOOL_PATHS[execution.name]
    if (pathOf === undefined || !isRecord(execution.arguments)) return undefined
    const target = pathOf(execution.arguments)
    if (typeof target !== 'string') return undefined
    const label = labelOf(cell.cwd, target)
    return label === undefined ? undefined : denialOf(cell.scope, label, cell.tasksDir, cell.pre)
  }
}
