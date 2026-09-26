/**
 * The `lifecycle_run` tool: the root agent drives one REQ through fresh role
 * children until a stop.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/tools/run
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RunResult } from '../driver.ts'
import type { LifecycleService } from '../index.ts'
import { callerOf } from '../tools.ts'
import { requireRoot } from './transition.ts'

const OTHER = 'other'
const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

/**
 * The run report as text: one header line, one line per step, the pending
 * human decision, and the violations.
 * @param result - the run result.
 * @returns the text the caller reads.
 */
export function renderRun(result: RunResult): string {
  const count = result.steps.length
  const lines = [`Lifecycle run on ${result.reqId} stopped: ${result.stopped} after ${String(count)} step${count === 1 ? '' : 's'}`]
  for (const step of result.steps) {
    const suffix = step.reason === null ? '' : ` (${step.reason})`
    lines.push(`- ${step.uid} @ ${step.state}: ${step.transition ?? 'no transition'} ${step.outcome}${suffix}`)
  }
  if (result.pendingHuman !== null) {
    lines.push(`Human decision needed at ${result.pendingHuman.state}; legal transitions ${result.pendingHuman.options.join(', ')}`)
  }
  for (const violation of result.violations) lines.push(`- ${violation}`)
  return lines.join('\n')
}

/**
 * The `lifecycle_run` tool.
 * @param service - the lifecycle service.
 * @returns the tool definition.
 */
export function runTool(service: LifecycleService): ToolDefinition {
  return defineTool({
    name: 'lifecycle_run',
    description: 'Drive one requirement (REQ) through the lifecycle: each step spawns a fresh role child seated by the agent registry, fences its edits to '
      + 'its own artifacts, judges its transition proposal against the lifecycle table, applies the effects, and lints; the human decides at the '
      + 'human-owned states. Stops when the REQ is done or blocked, a human decision is pending, a step is rejected or fails, the tree lints red, '
      + 'or the step ceiling is reached. Use it only when asked to drive a REQ.',
    parameters: {
      reqId: { type: 'string', required: true, description: 'The REQ to drive, such as REQ-PLAT-010.' },
      maxSteps: { type: 'integer', description: 'A step ceiling below the configured maximum; a higher value is capped.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reqId: { type: 'string', required: true },
          steps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                uid: { type: 'string', required: true },
                role: { type: 'string', required: true },
                state: { type: 'string', required: true },
                transition: { ...NULLABLE_STRING, required: true },
                outcome: { type: 'string', required: true, enum: ['applied', 'rejected', 'failed'] },
                reason: { ...NULLABLE_STRING, required: true },
              },
            },
          },
          stopped: { type: 'string', required: true, enum: ['done', 'blocked', 'needs-human', 'rejected', 'lint-red', 'max-steps', 'failed'] },
          pendingHuman: {
            required: true,
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  state: { type: 'string', required: true },
                  options: { type: 'array', required: true, items: { type: 'string' } },
                },
              },
              { type: 'null' },
            ],
          },
          violations: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRun(value) }],
    },
    execute: (args, exec) => {
      const { agent } = callerOf(exec, 'lifecycle_run')
      requireRoot(agent, 'lifecycle_run')
      return service.run(agent, { reqId: args.reqId, maxSteps: args.maxSteps }, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: `Lifecycle run on ${args.reqId}`, kind: OTHER }),
  })
}
