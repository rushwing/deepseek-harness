/**
 * Shared helpers for conversation backends: adapters that run a dsh Agent's
 * conversation on an external agent product (Codex, Claude Code) instead of a
 * bare model. Each backend owns its product protocol and process; this
 * library owns what they share.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend
 */

export { activityLine, type ProductActivity, type ProductActivityStatus } from './activity.ts'
export {
  ABORTED_CODE,
  TEXT_ONLY_MODALITIES,
  finishForFailure,
  providerDisplayInfo,
  readBinding,
  requireNewUserInput,
  resolveProductTarget,
  routeOf,
  streamProductTurn,
  thrown,
  unlistedModelInfo,
  type BackendIdentity,
  type ProductTarget,
} from './backend.ts'
export {
  bindingProjection,
  productConversationBindingSchema,
  type ProductConversationBinding,
} from './binding.ts'
export {
  MISSING_CREDENTIAL_CODE,
  PRODUCT_CONVERSATION_MISSING_CODE,
  conversationMissing,
  productNotSignedIn,
} from './errors.ts'
export { isEphemeralRequest, newUserInput } from './input.ts'
export { approvalAllows, askApproval, askQuestions } from './interaction.ts'
export {
  assertDuration,
  resolveBackendSpec,
  resolveRoutes,
  type BackendConfig,
  type BackendSpec,
  type ResolvedRoute,
} from './routes.ts'
export { ProductTurnStream } from './stream.ts'
