/**
 * The transition proposal a role child hands back: its JSON schema for
 * structured output, and the parser that reads it from structured output or
 * from the last fenced ```json block of the child's final text.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/proposal
 */

import type { StepDecisions } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { decisionsOf, isRecord } from './tools/transition.ts'

/** What a role child proposes at the end of its step. */
export interface Proposal {
  /** Exactly one of `transition` and `event` is set. */
  readonly transition: string | undefined
  readonly event: string | undefined
  readonly summary: string
  readonly decisions: StepDecisions
  readonly pr: number | undefined
}

/** A parsed proposal, or the reason the hand-over is unusable. */
export type ParsedProposal = { readonly ok: true; readonly proposal: Proposal } | { readonly ok: false; readonly problem: string }

const NULLABLE_STRING: JsonSchemaNode = { oneOf: [{ type: 'string' }, { type: 'null' }] }
const NULLABLE_INTEGER: JsonSchemaNode = { oneOf: [{ type: 'integer' }, { type: 'null' }] }

/** The structured-output schema of a proposal. */
export const PROPOSAL_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transition: { ...NULLABLE_STRING, description: 'The transition id to hand back, such as T03; null when handing back a lifecycle event.' },
    event: { ...NULLABLE_STRING, description: 'The lifecycle event name, such as bug_fix; null when handing back a transition.' },
    summary: { type: 'string', description: 'One sentence for the commit subject after "lifecycle: <id> — ".' },
    decisions: {
      type: 'object',
      additionalProperties: true,
      description: 'Choices for effects that admit several values: { fields, tcStatuses, bugStatuses }.',
    },
    pr: { ...NULLABLE_INTEGER, description: 'The pull-request number the step records, when the transition takes one.' },
  },
  required: ['summary'],
}

const FENCE = /```json\s*\n([\s\S]*?)\n\s*```/g

type Raw = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly problem: string }

function outputText(result: SubagentResult): string {
  return result.output.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')
}

function fenced(text: string): Raw {
  const last = [...text.matchAll(FENCE)].at(-1)
  if (last === undefined) return { ok: false, problem: 'the child handed over without a fenced ```json proposal block' }
  try {
    return { ok: true, value: JSON.parse(String(last[1])) }
  } catch (error: unknown) {
    return { ok: false, problem: `the proposal block is not valid JSON: ${String(error)}` }
  }
}

type Name = { readonly ok: true; readonly value: string | undefined } | { readonly ok: false; readonly problem: string }

function nameOf(value: unknown, field: string): Name {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value === 'string' && value.trim() !== '') return { ok: true, value: value.trim() }
  return { ok: false, problem: `${field} must be a non-empty string or null` }
}

/**
 * Read the proposal of a completed child.
 * @param result - the child's result; structured output wins over the text.
 * @returns the proposal, or the first problem with the hand-over.
 */
export function parseProposal(result: SubagentResult): ParsedProposal {
  const raw: Raw = result.structured === undefined ? fenced(outputText(result)) : { ok: true, value: result.structured }
  if (!raw.ok) return raw
  const { value } = raw
  if (!isRecord(value)) return { ok: false, problem: 'the proposal is not a JSON object' }
  const transition = nameOf(value.transition, 'transition')
  if (!transition.ok) return transition
  const event = nameOf(value.event, 'event')
  if (!event.ok) return event
  if ((transition.value === undefined) === (event.value === undefined)) {
    return { ok: false, problem: transition.value === undefined ? 'the proposal names neither a transition nor an event' : 'the proposal names both a transition and an event' }
  }
  if (typeof value.summary !== 'string' || value.summary.trim() === '') return { ok: false, problem: 'summary must be one non-empty sentence' }
  if (value.decisions !== undefined && !isRecord(value.decisions)) return { ok: false, problem: 'decisions must be an object' }
  if (value.pr !== undefined && value.pr !== null && !Number.isInteger(value.pr)) return { ok: false, problem: 'pr must be an integer or null' }
  return {
    ok: true,
    proposal: {
      transition: transition.value,
      event: event.value,
      summary: value.summary.trim(),
      decisions: value.decisions === undefined ? {} : decisionsOf(value.decisions),
      pr: typeof value.pr === 'number' ? value.pr : undefined,
    },
  }
}
