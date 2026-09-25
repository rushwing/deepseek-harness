/**
 * What a product backend sends per turn. The product owns the conversation
 * history, so a request's new input is only the user messages that follow the
 * last assistant message; auxiliary requests never touch a bound conversation.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/input
 */

import { isAgentLoopRequest, type GenerateOptions, type RequestMessage } from '@deepseek-ai/dsh-llm'

/**
 * The user messages after the last assistant message, one text per message.
 * Text blocks of one message join with a newline; messages without text and
 * system, developer, and tool messages are skipped.
 * @param messages - the fully derived request history.
 * @returns the new user texts in order; empty when the last message is the assistant's.
 */
export function newUserInput(messages: readonly RequestMessage[]): string[] {
  let start = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      start = index + 1
      break
    }
  }
  const texts: string[] = []
  for (const message of messages.slice(start)) {
    if (message.role !== 'user') continue
    const text = message.content
      .flatMap(block => (block.type === 'text' ? [block.text] : []))
      .join('\n')
    if (text.length > 0) texts.push(text)
  }
  return texts
}

/**
 * Whether a request must run on an ephemeral product conversation instead of
 * the Session's bound one: auxiliary purposes (session title, compaction),
 * requests without a Session, and requests the agent loop did not build.
 * @param options - the model request.
 * @returns `true` when the request must not touch the binding.
 */
export function isEphemeralRequest(options: GenerateOptions): boolean {
  return options.purpose !== undefined
    || options.sessionId === undefined
    || !isAgentLoopRequest(options)
}
