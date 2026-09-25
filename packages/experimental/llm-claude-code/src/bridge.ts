/**
 * Answers Claude Code's permission, question, elicitation, and dialog
 * requests during a turn. Bridged routes forward tool permissions to
 * `ctx.approval` and `AskUserQuestion` to `ctx.userQuestions`, failing
 * closed; unattended routes deny and decline everything without asking.
 *
 * @module @deepseek-ai/dsh-experimental-llm-claude-code/bridge
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CanUseTool, Options, PermissionResult } from '@deepseek-ai/dsh-claude-agent-sdk'
import { approvalAllows, askApproval, askQuestions } from '@deepseek-ai/dsh-experimental-llm-product-backend'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionItem, UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { z } from 'zod'

/** The Claude Code tool that asks the human a question instead of acting. */
export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

/** Facts about the dsh turn a Claude Code query serves. */
export interface LiveTurn {
  /** The Agent whose turn runs; approvals and questions are asked on its behalf. */
  readonly agent: Agent
  /** Aborts pending approvals and questions when the dsh turn is cancelled. */
  readonly signal: AbortSignal
}

/** The interaction services the bridge answers through. */
export interface BridgeServices {
  /** The `ctx.approval` service. */
  readonly approval: Pick<ApprovalService, 'request'>
  /** The `ctx.userQuestions` service. */
  readonly userQuestions: Pick<UserQuestionService, 'ask'>
}

/** The SDK callbacks one query installs. */
export interface ClaudeCodeCallbacks {
  readonly canUseTool: CanUseTool
  readonly onElicitation: NonNullable<Options['onElicitation']>
  readonly onUserDialog: NonNullable<Options['onUserDialog']>
}

const askUserQuestionInput = z.object({
  questions: z.array(z.object({
    question: z.string(),
    header: z.string(),
    multiSelect: z.boolean().optional(),
    options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  })),
})

/** The input fields whose string value best describes a tool call to the approver, in preference order. */
const REASON_FIELDS = ['description', 'command', 'file_path', 'query'] as const

function reasonFor(input: Record<string, unknown>): string | undefined {
  for (const field of REASON_FIELDS) {
    const value = input[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function deny(message: string): PermissionResult {
  return { behavior: 'deny', message }
}

const declineElicitation: ClaudeCodeCallbacks['onElicitation'] = () => Promise.resolve({ action: 'decline' })
const cancelDialog: ClaudeCodeCallbacks['onUserDialog'] = () => Promise.resolve({ behavior: 'cancelled' })

/**
 * Build the callbacks for a query whose route bridges to the human.
 * @param turn - the Agent and abort signal of the running dsh turn.
 * @param services - the interaction services to ask.
 * @returns callbacks that allow only what the human allowed and answer only what the human answered.
 */
export function createBridgedCallbacks(turn: LiveTurn, services: BridgeServices): ClaudeCodeCallbacks {
  async function askUserQuestion(input: Record<string, unknown>): Promise<PermissionResult> {
    const parsed = askUserQuestionInput.safeParse(input)
    if (!parsed.success) return deny(`${ASK_USER_QUESTION_TOOL} input did not match the tool schema`)
    const questions: AskUserQuestionItem[] = parsed.data.questions.map((question, index) => ({
      id: `q${String(index)}`,
      header: question.header,
      question: question.question,
      ...question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect },
      options: question.options.map(option => ({
        label: option.label,
        ...option.description === undefined ? {} : { description: option.description },
      })),
    }))
    const answer = await askQuestions(services.userQuestions, { questions, agent: turn.agent, signal: turn.signal })
    if (answer === undefined) return deny('no one can answer questions for this Session')
    const answers: Record<string, string> = {}
    for (const item of answer.answers) {
      const question = questions.find(candidate => candidate.id === item.id)
      if (question === undefined) continue
      answers[question.question] = [...item.selected, ...item.custom === undefined ? [] : [item.custom]].join(', ')
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } }
  }

  return {
    canUseTool: async (toolName, input) => {
      if (toolName === ASK_USER_QUESTION_TOOL) return askUserQuestion(input)
      const reason = reasonFor(input)
      const outcome = await askApproval(services.approval, {
        agent: turn.agent,
        toolName: `claude-code:${toolName}`,
        ...reason === undefined ? {} : { reason },
        signal: turn.signal,
      })
      return approvalAllows(outcome)
        ? { behavior: 'allow', updatedInput: input }
        : deny(`dsh declined the ${toolName} tool call`)
    },
    onElicitation: declineElicitation,
    onUserDialog: cancelDialog,
  }
}

/**
 * Build the callbacks for a query on a native unattended route.
 * @returns callbacks that deny every permission request and decline every interaction.
 */
export function unattendedCallbacks(): ClaudeCodeCallbacks {
  return {
    canUseTool: () => Promise.resolve(deny('this unattended Claude Code route cannot request human approval')),
    onElicitation: declineElicitation,
    onUserDialog: cancelDialog,
  }
}
