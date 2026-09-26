/**
 * Answers the app-server's requests during a turn. Threads on a `bridge`
 * route forward approvals to `ctx.approval` and questions to
 * `ctx.userQuestions`, failing closed; threads on a native mode, threads this
 * process does not know, and MCP elicitations get the unattended answer.
 *
 * @module @deepseek-ai/dsh-experimental-llm-codex/bridge
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  expectObject,
  expectString,
  type CodexServerRequest,
  type CodexServerRequestHandler,
  type JsonObject,
} from '@deepseek-ai/dsh-codex-app-server'
import { askApproval, askQuestions } from '@deepseek-ai/dsh-experimental-llm-product-backend'
import type { ApprovalOutcome, ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionItem, AskUserQuestionOption, UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import type { CodexRoutePermissionMode } from './config.ts'

const SOURCE = 'llm-codex'

/** Facts about a thread that is currently running a turn for a dsh Agent. */
export interface LiveThread {
  /** The Agent whose turn the thread serves; approvals and questions are asked on its behalf. */
  readonly agent: Agent
  /** The route's permission mode; only `bridge` reaches the human. */
  readonly mode: CodexRoutePermissionMode
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

/** Threads with an active turn, keyed by app-server thread id. */
export class ThreadRegistry {
  private readonly threads = new Map<string, LiveThread>()

  /**
   * Look up the live facts of a thread.
   * @param threadId - the id a server request names; `undefined` matches nothing.
   * @returns the thread's facts while it runs a turn.
   */
  get(threadId: string | undefined): LiveThread | undefined {
    return threadId === undefined ? undefined : this.threads.get(threadId)
  }

  /**
   * Record a thread as running a turn.
   * @param threadId - the app-server thread id.
   * @param thread - the Agent, mode, and abort signal of the running turn.
   */
  set(threadId: string, thread: LiveThread): void {
    this.threads.set(threadId, thread)
  }

  /**
   * Forget a thread once its turn settles.
   * @param threadId - the app-server thread id.
   */
  delete(threadId: string): void {
    this.threads.delete(threadId)
  }
}

const ELICITATION_DECLINED = { action: 'decline', content: null, _meta: null }

/**
 * Map the human's answer to Codex's fixed decision vocabulary: an allowance
 * accepts, an explicit cancellation of the prompt cancels the turn (Codex's
 * own escape hatch), and a rejection or an unanswerable request declines the
 * action so Codex reports the refusal to the model and continues. Codex's
 * `availableDecisions` hint is a display suggestion, not a constraint, so the
 * bridge does not consult it.
 */
function decisionFor(outcome: ApprovalOutcome): 'accept' | 'cancel' | 'decline' {
  switch (outcome) {
    case 'allowed-once':
      return 'accept'
    case 'cancelled':
      return 'cancel'
    case 'rejected':
    case 'unavailable':
      return 'decline'
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function questionItem(value: unknown, index: number): AskUserQuestionItem {
  const question = expectObject(value, `questions[${index}]`, SOURCE)
  const options = question.options ?? undefined
  return {
    id: expectString(question.id, `questions[${index}].id`, SOURCE),
    header: expectString(question.header, `questions[${index}].header`, SOURCE),
    question: expectString(question.question, `questions[${index}].question`, SOURCE),
    ...options === undefined ? {} : { options: questionOptions(options, index) },
  }
}

function questionOptions(value: unknown, index: number): AskUserQuestionOption[] {
  if (!Array.isArray(value)) throw new Error(`${SOURCE}: app-server sent a non-array questions[${index}].options`)
  return value.map((entry, optionIndex) => {
    const option = expectObject(entry, `questions[${index}].options[${optionIndex}]`, SOURCE)
    const description = optionalString(option.description)
    return {
      label: expectString(option.label, `questions[${index}].options[${optionIndex}].label`, SOURCE),
      ...description === undefined ? {} : { description },
    }
  })
}

function questionItems(params: JsonObject): AskUserQuestionItem[] {
  const questions = params.questions
  if (!Array.isArray(questions)) throw new Error(`${SOURCE}: app-server sent a non-array questions list`)
  return questions.map(questionItem)
}

/**
 * Build the server-request handler for one app-server process.
 * @param threads - the threads currently running a turn.
 * @param services - the interaction services bridged threads answer through.
 * @returns the handler to give the app-server connection.
 */
export function createServerRequestHandler(
  threads: Pick<ThreadRegistry, 'get'>,
  services: BridgeServices,
): CodexServerRequestHandler {
  async function ask(request: CodexServerRequest, toolName: string, reason: string | undefined): Promise<ApprovalOutcome> {
    const thread = threads.get(request.threadId)
    if (thread?.mode !== 'bridge') return 'unavailable'
    return askApproval(services.approval, {
      agent: thread.agent,
      toolName,
      ...reason === undefined ? {} : { reason },
      signal: thread.signal,
    })
  }

  async function decide(request: CodexServerRequest, toolName: string, reason: string | undefined): Promise<JsonObject> {
    return { decision: decisionFor(await ask(request, toolName, reason)) }
  }

  async function permissions(request: CodexServerRequest): Promise<JsonObject> {
    const allowed = await ask(request, 'codex:permissions', optionalString(request.params.reason)) === 'allowed-once'
    return { permissions: allowed ? expectObject(request.params.permissions, 'permissions', SOURCE) : {}, scope: 'turn' }
  }

  async function userInput(request: CodexServerRequest): Promise<JsonObject> {
    const thread = threads.get(request.threadId)
    if (thread?.mode !== 'bridge') return { answers: {} }
    const answer = await askQuestions(services.userQuestions, {
      questions: questionItems(request.params),
      agent: thread.agent,
      signal: thread.signal,
    })
    const answers: Record<string, { answers: string[] }> = {}
    for (const item of answer?.answers ?? []) {
      answers[item.id] = { answers: item.custom === undefined ? [...item.selected] : [...item.selected, item.custom] }
    }
    return { answers }
  }

  return async (request) => {
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
        return decide(request, 'codex:command', optionalString(request.params.command) ?? optionalString(request.params.reason))
      case 'item/fileChange/requestApproval':
        return decide(request, 'codex:file-change', optionalString(request.params.reason))
      case 'item/permissions/requestApproval':
        return permissions(request)
      case 'item/tool/requestUserInput':
        return userInput(request)
      case 'mcpServer/elicitation/request':
        return ELICITATION_DECLINED
      default:
        throw new Error(`${SOURCE}: unsupported app-server request "${request.method}"`)
    }
  }
}
