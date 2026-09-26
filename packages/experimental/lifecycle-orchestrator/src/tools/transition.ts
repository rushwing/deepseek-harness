/**
 * The `lifecycle_transition` tool: the root agent applies a transition or a
 * lifecycle event by hand and logs the applied step.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/tools/transition
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { LifecycleError } from '../errors.ts'
import type { LifecycleTransitionEvent } from '../events.ts'
import type { LifecycleService } from '../index.ts'
import { callerOf } from '../tools.ts'
import type { TransitionResult } from '../workspace.ts'

const OTHER = 'other'
const SUBAGENT = 'subagent'
const STRING_LIST = { type: 'array', items: { type: 'string' } } as const

/**
 * Refuse a delegated caller: a role child hands back a proposal; only the
 * root agent applies steps.
 * @param agent - the calling agent.
 * @param tool - the tool name for the message.
 * @throws LifecycleError `DELEGATED_CALLER` when the agent is a subagent.
 */
export function requireRoot(agent: Agent, tool: string): void {
  if (agent.session.header.origin === SUBAGENT) {
    throw new LifecycleError('DELEGATED_CALLER', `${tool} is for the root agent; a role child ends its work with a transition proposal instead`)
  }
}

/**
 * The logged form of an applied step.
 * @param result - an applied transition result.
 * @returns the `lifecycle/transition` payload.
 */
export function transitionEvent(result: TransitionResult): LifecycleTransitionEvent {
  return {
    version: 1,
    reqId: result.reqId,
    id: result.id,
    from: result.from,
    to: result.to,
    actorUid: result.actorUid,
    ownerBefore: result.ownerBefore,
    ownerAfter: result.ownerAfter,
    reviewRound: result.reviewRound,
    files: result.files,
    ...(result.kind === 'event' ? { eventName: result.id } : {}),
  }
}

/**
 * One line for an applied step, or the violations of a rejected one.
 * @param result - the transition result.
 * @returns the text the caller reads.
 */
export function renderTransition(result: TransitionResult): string {
  if (result.applied) {
    return `Applied ${result.id} on ${result.reqId}: ${result.from} → ${result.to}, owner ${result.ownerAfter}. Commit subject: ${result.suggestedCommitSubject}`
  }
  const count = result.violations.length
  return [`Rejected ${result.id} on ${result.reqId}: ${String(count)} violation${count === 1 ? '' : 's'}`, ...result.violations.map(text => `- ${text}`)].join('\n')
}

/**
 * The `lifecycle_transition` tool.
 * @param service - the lifecycle service.
 * @returns the tool definition.
 */
export function transitionTool(service: LifecycleService): ToolDefinition {
  return defineTool({
    name: 'lifecycle_transition',
    description: 'Apply one lifecycle transition (such as T01) or lifecycle event (such as bug_fix) to a requirement (REQ) by hand: '
      + 'the guards are checked, the effects rewrite the frontmatter and statuses, and the result is linted; a red result writes nothing. '
      + 'Returns the suggested commit subject; the human commits.',
    parameters: {
      reqId: { type: 'string', required: true, description: 'The REQ to move, such as REQ-PLAT-010.' },
      transition: { type: 'string', description: 'The transition id, such as T01. Name exactly one of transition and event.' },
      event: { type: 'string', description: 'The lifecycle event name, such as bug_fix.' },
      summary: { type: 'string', required: true, description: 'One sentence for the commit subject after "lifecycle: <id> — ".' },
      decisions: {
        type: 'object',
        additionalProperties: true,
        description: 'Choices for effects that admit several values: { fields: {...}, tcStatuses: { "TC-ID": "status" }, bugStatuses: { "BUG-ID": "status" } }.',
      },
      pr: { type: 'integer', description: 'The pull-request number the step carries, when the transition records one.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['transition', 'event'] },
          applied: { type: 'boolean', required: true },
          reqId: { type: 'string', required: true },
          id: { type: 'string', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          actorUid: { type: 'string', required: true },
          ownerBefore: { type: 'string', required: true },
          ownerAfter: { type: 'string', required: true },
          reviewRound: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          files: { ...STRING_LIST, required: true },
          suggestedCommitSubject: { type: 'string', required: true },
          violations: { ...STRING_LIST, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderTransition(value) }],
    },
    execute: async (args, exec) => {
      const { agent, cwd } = callerOf(exec, 'lifecycle_transition')
      requireRoot(agent, 'lifecycle_transition')
      const decisions = args.decisions === undefined ? undefined : decisionsOf(args.decisions)
      const result = await service.transition(cwd, {
        reqId: args.reqId,
        transition: args.transition,
        event: args.event,
        summary: args.summary,
        decisions,
        pr: args.pr,
      })
      if (result.applied) agent.session.append('lifecycle/transition', transitionEvent(result))
      return result
    },
    presentCall: args => ({
      card: 'generic',
      title: `Lifecycle ${args.transition ?? args.event ?? 'step'} on ${args.reqId}`,
      kind: OTHER,
    }),
  })
}

/**
 * Read the decisions object of a call: the three optional maps, other keys ignored.
 * @param value - the model-supplied object.
 * @returns the step decisions.
 */
export function decisionsOf(value: Readonly<Record<string, unknown>>): {
  fields?: Readonly<Record<string, unknown>>
  tcStatuses?: Readonly<Record<string, string>>
  bugStatuses?: Readonly<Record<string, string>>
} {
  return {
    ...(isRecord(value.fields) ? { fields: value.fields } : {}),
    ...(isRecord(value.tcStatuses) ? { tcStatuses: stringMap(value.tcStatuses) } : {}),
    ...(isRecord(value.bugStatuses) ? { bugStatuses: stringMap(value.bugStatuses) } : {}),
  }
}

/**
 * Whether a JSON value is a plain object.
 * @param value - the value.
 * @returns `true` for a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringMap(value: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}
