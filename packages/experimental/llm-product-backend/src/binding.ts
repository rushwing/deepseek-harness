/**
 * The durable binding between a dsh Session and one product conversation.
 * Each backend declares its own session event and projection key; this module
 * supplies the shared state shape and the projection that folds it.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/binding
 */

import { z, type ZodType } from 'zod'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'

/** Which product conversation a Session continues, recorded when the product acknowledged it. */
export interface ProductConversationBinding {
  /** The product's conversation identity (a Codex thread id, a Claude session id). */
  readonly conversationId: string
  /** The workspace the conversation was created in. */
  readonly cwd: string
  /** The model fixed for the conversation, when the request named one. */
  readonly model?: string | undefined
}

/** Validates a persisted binding state; `null` means the Session is not bound yet. */
export const productConversationBindingSchema: ZodType<ProductConversationBinding | null> = z.union([
  z.object({
    conversationId: z.string().min(1),
    cwd: z.string().min(1),
    model: z.string().min(1).optional(),
  }),
  z.null(),
])

/** The projection fields every binding projection shares. */
export interface BindingProjectionDefinition<K extends string> {
  readonly key: K
  readonly stateSchema: ZodType<ProductConversationBinding | null>
  readonly stateVersion: 1
  /**
   * The empty log is unbound.
   * @param header - immutable Session metadata (unused).
   * @param inheritedEventCount - fork-inherited prefix length (unused).
   * @returns `null`.
   */
  init(header: SessionHeader, inheritedEventCount: SessionLogOffset): ProductConversationBinding | null
  /**
   * Fold one committed event: the backend's binding event replaces the state; anything else keeps it.
   * @param state - the binding before this event.
   * @param event - the next committed event.
   * @returns the next binding, or the same reference when the event is not the backend's.
   */
  apply(state: ProductConversationBinding | null, event: SessionEvent): ProductConversationBinding | null
}

/**
 * Build the projection that folds one backend's binding events.
 * @param key - the backend's `SessionProjectionStateMap` key, for example `codexThread`.
 * @param eventType - the backend's binding event type, for example `codex/thread`.
 * @returns a projection definition to register on `ctx.sessionProjections`.
 */
export function bindingProjection<K extends string>(key: K, eventType: string): BindingProjectionDefinition<K> {
  return {
    key,
    stateSchema: productConversationBindingSchema,
    stateVersion: 1,
    init: () => null,
    apply: (state, event) => (event.type === eventType
      ? productConversationBindingSchema.parse(event.data)
      : state),
  }
}
