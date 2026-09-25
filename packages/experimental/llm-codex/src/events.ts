/**
 * The durable binding between a dsh Session and its Codex thread: the
 * `codex/thread` session event and the `codexThread` projection that folds it.
 *
 * @module @deepseek-ai/dsh-experimental-llm-codex/events
 */

import {
  bindingProjection,
  type ProductConversationBinding,
} from '@deepseek-ai/dsh-experimental-llm-product-backend'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The Codex app-server acknowledged the thread this Session's turns run
     * on. Log-only: appended once the thread exists, before its first turn
     * starts, so a resumed Session continues the same Codex conversation
     * instead of starting a new one. `conversationId` is the Codex thread id,
     * `cwd` the workspace the thread was created in, and `model` the model the
     * creating request named.
     */
    'codex/thread': ProductConversationBinding
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The Codex thread this Session continues, or `null` before its first bound turn. */
    codexThread: ProductConversationBinding | null
  }
}

/** The session event type recording the bound Codex thread. */
export const CODEX_THREAD_EVENT = 'codex/thread'

/** The projection key holding the bound Codex thread. */
export const CODEX_THREAD_PROJECTION_KEY = 'codexThread'

/** Folds `codex/thread` events into the Session's current binding. */
export const codexThreadProjection = bindingProjection(CODEX_THREAD_PROJECTION_KEY, CODEX_THREAD_EVENT)
