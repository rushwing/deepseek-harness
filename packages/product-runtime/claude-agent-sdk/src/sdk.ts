/**
 * The official Agent SDK entry point and the wire types consumers need,
 * re-exported so every consumer speaks the one pinned SDK version.
 *
 * @module @deepseek-ai/dsh-claude-agent-sdk/sdk
 */

export { query } from '@anthropic-ai/claude-agent-sdk'
export type {
  CanUseTool,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'
