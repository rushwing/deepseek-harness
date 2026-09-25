/**
 * The durable binding between a dsh Session and its Claude Code session: the
 * `claude-code/session` session event and the `claudeCodeSession` projection
 * that folds it.
 *
 * @module @deepseek-ai/dsh-experimental-llm-claude-code/events
 */

import {
  bindingProjection,
  type ProductConversationBinding,
} from '@deepseek-ai/dsh-experimental-llm-product-backend'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The Claude Code CLI reported the session this dsh Session's turns run
     * on. Log-only: appended when the first bound turn's `system/init`
     * message names the session, so a resumed dsh Session continues the same
     * Claude Code conversation instead of starting a new one.
     * `conversationId` is the Claude Code session id, `cwd` the workspace the
     * session was created in, and `model` the model the creating request named.
     */
    'claude-code/session': ProductConversationBinding
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The Claude Code session this Session continues, or `null` before its first bound turn. */
    claudeCodeSession: ProductConversationBinding | null
  }
}

/** The session event type recording the bound Claude Code session. */
export const CLAUDE_CODE_SESSION_EVENT = 'claude-code/session'

/** The projection key holding the bound Claude Code session. */
export const CLAUDE_CODE_SESSION_PROJECTION_KEY = 'claudeCodeSession'

/** Folds `claude-code/session` events into the Session's current binding. */
export const claudeCodeSessionProjection = bindingProjection(CLAUDE_CODE_SESSION_PROJECTION_KEY, CLAUDE_CODE_SESSION_EVENT)
