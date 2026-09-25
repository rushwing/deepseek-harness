/**
 * The failures a product backend reports through the LLM seam beyond the
 * shared codes: a bound product conversation that no longer exists, and a
 * product with no signed-in account.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/errors
 */

import { LlmError } from '@deepseek-ai/dsh-llm'

/** The Session's bound product conversation cannot be resumed; no replacement is created. */
export const PRODUCT_CONVERSATION_MISSING_CODE = 'PRODUCT_CONVERSATION_MISSING'

/** The product has no signed-in account; the same code the credential seam uses for an absent credential. */
export const MISSING_CREDENTIAL_CODE = 'MISSING_CREDENTIAL'

/**
 * The failure for a Session whose product conversation is gone.
 * @param product - product name shown to the user, for example `Codex`.
 * @param conversationId - the bound conversation the product no longer has.
 * @returns an `LlmError` with code {@link PRODUCT_CONVERSATION_MISSING_CODE}.
 */
export function conversationMissing(product: string, conversationId: string): LlmError {
  return new LlmError(
    `${product} no longer has the conversation ${JSON.stringify(conversationId)} this Session is bound to; start a new Session to begin a new ${product} conversation`,
    PRODUCT_CONVERSATION_MISSING_CODE,
  )
}

/**
 * The failure for a product without a signed-in account.
 * @param product - product name shown to the user.
 * @param loginCommand - the native command that signs in, for example `codex login`.
 * @returns an `LlmError` with code {@link MISSING_CREDENTIAL_CODE}.
 */
export function productNotSignedIn(product: string, loginCommand: string): LlmError {
  return new LlmError(
    `${product} is not signed in; run \`${loginCommand}\` and retry`,
    MISSING_CREDENTIAL_CODE,
  )
}
