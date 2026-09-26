/**
 * The read-only lifecycle tools: `lifecycle_status`, `lifecycle_check_in`,
 * and `lifecycle_lint`, each working on the calling Session's workspace.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/tools
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { LifecycleError } from './errors.ts'
import type {} from './events.ts'
import { renderCheckIn, renderLint, renderStatus } from './render.ts'
import type { LifecycleService } from './index.ts'

const ALL = 'all'
const OTHER = 'other'

interface Caller {
  readonly agent: Agent
  readonly cwd: string
}

/**
 * The calling agent and its Session's working directory.
 * @param exec - the tool run.
 * @param tool - the tool name, for the failure message.
 * @returns the caller.
 * @throws `NO_WORKSPACE` when there is no agent or its Session has no working directory.
 */
export function callerOf(exec: ToolRunContext, tool: string): Caller {
  const cwd = exec.agent === undefined ? undefined : exec.agent.session.header.cwd
  if (exec.agent === undefined || cwd === undefined) {
    throw new LifecycleError('NO_WORKSPACE', `${tool} needs a Session with a working directory; the lifecycle directory is read from it`)
  }
  return { agent: exec.agent, cwd }
}

const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const
const NULLABLE_INTEGER = { oneOf: [{ type: 'integer' }, { type: 'null' }] } as const
const TRANSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    actor: { type: 'string', required: true },
    to: { type: 'string', required: true },
    ownerAfter: { type: 'string', required: true },
    human: { type: 'boolean', required: true },
  },
} as const

/**
 * The `lifecycle_status` tool.
 * @param service - the lifecycle service.
 * @returns the tool definition.
 */
export function statusTool(service: LifecycleService): ToolDefinition {
  return defineTool({
    name: 'lifecycle_status',
    description: 'Read the lifecycle position of one requirement (REQ) or of every REQ in the workspace: status, owner and owner role, review round, '
      + 'TC policy, blocked fields, the seat that acts next, and the transitions the current owner may take.',
    parameters: {
      reqId: { type: 'string', description: 'A REQ id such as REQ-PLAT-010; omit to report every REQ.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          activeSet: { ...NULLABLE_STRING, required: true },
          reqs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                status: { type: 'string', required: true },
                owner: { type: 'string', required: true },
                ownerRole: { type: 'string', required: true },
                reviewRound: { ...NULLABLE_INTEGER, required: true },
                tcPolicy: { type: 'string', required: true },
                blocked: {
                  required: true,
                  oneOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        reason: { type: 'string', required: true },
                        pendingBugs: { type: 'array', required: true, items: { type: 'string' } },
                        restoreState: { type: 'string', required: true },
                        restoreOwner: { type: 'string', required: true },
                      },
                    },
                    { type: 'null' },
                  ],
                },
                seat: { ...NULLABLE_STRING, required: true },
                legalTransitions: { type: 'array', required: true, items: TRANSITION_SCHEMA },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    execute: (args, exec) => {
      const { cwd } = callerOf(exec, 'lifecycle_status')
      return Promise.resolve(service.status(cwd, args.reqId))
    },
    presentCall: args => ({
      card: 'generic',
      title: args.reqId === undefined ? 'Lifecycle status of every REQ' : `Lifecycle status of ${args.reqId}`,
      kind: OTHER,
    }),
  })
}

/**
 * The `lifecycle_check_in` tool.
 * @param service - the lifecycle service.
 * @returns the tool definition.
 */
export function checkInTool(service: LifecycleService): ToolDefinition {
  return defineTool({
    name: 'lifecycle_check_in',
    description: 'Run the hard-stop checks before working on a REQ as a role: the REQ file exists, the caller uid is its owner, and the REQ is in the '
      + 'state the caller intends to work in. Name the intended transition to learn whether it is exempt from the owner and state checks.',
    parameters: {
      reqId: { type: 'string', required: true, description: 'The REQ to work on.' },
      uid: { type: 'string', required: true, description: 'The registered uid of the caller, such as evaluator-002.' },
      state: { type: 'string', required: true, description: 'The REQ state the caller intends to work in.' },
      transition: { type: 'string', description: 'The transition the caller intends to take, such as T03.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          exempt: { type: 'boolean', required: true },
          checks: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              c1: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: { ok: { type: 'boolean', required: true }, file: { ...NULLABLE_STRING, required: true } },
              },
              c2: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: { ok: { type: 'boolean', required: true }, expected: { ...NULLABLE_STRING, required: true }, actual: { type: 'string', required: true } },
              },
              c3: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  ok: { type: 'boolean', required: true },
                  status: { ...NULLABLE_STRING, required: true },
                  state: { type: 'string', required: true },
                  handles: { type: 'array', required: true, items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderCheckIn(args, value) }],
    },
    execute: (args, exec) => {
      const { cwd } = callerOf(exec, 'lifecycle_check_in')
      return Promise.resolve(service.checkIn(cwd, args))
    },
    presentCall: args => ({ card: 'generic', title: `Check in ${args.uid} on ${args.reqId}`, kind: OTHER, rawInput: args }),
  })
}

/**
 * The `lifecycle_lint` tool; every run appends a `lifecycle/lint` event to the calling Session.
 * @param service - the lifecycle service.
 * @returns the tool definition.
 */
export function lintTool(service: LifecycleService): ToolDefinition {
  return defineTool({
    name: 'lifecycle_lint',
    description: 'Lint the lifecycle artifacts (REQ, TC, BUG, RV, PL) of the workspace against the lifecycle table, the agent registry, and the '
      + 'artifact contract, and list every violation with its file and rule. Scope to one REQ to check only that REQ and the artifacts bound to it.',
    parameters: {
      reqId: { type: 'string', description: 'Limit the report to this REQ and its TCs, RV, PL, and BUGs; omit to lint the whole tree.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          violations: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { file: { type: 'string', required: true }, rule: { type: 'string', required: true }, message: { type: 'string', required: true } },
            },
          },
          counts: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderLint(value, args.reqId === undefined ? ALL : args.reqId) }],
    },
    execute: (args, exec) => {
      const { agent, cwd } = callerOf(exec, 'lifecycle_lint')
      const report = service.lint(cwd, args.reqId)
      const counts = { ...report.counts }
      agent.session.append('lifecycle/lint', {
        version: 1,
        scope: args.reqId === undefined ? ALL : args.reqId,
        violationCount: report.violations.length,
        ruleCounts: counts,
      })
      return Promise.resolve({ violations: report.violations.map(violation => ({ ...violation })), counts })
    },
    presentCall: args => ({ card: 'generic', title: args.reqId === undefined ? 'Lint the lifecycle artifacts' : `Lint ${args.reqId}`, kind: OTHER }),
  })
}
