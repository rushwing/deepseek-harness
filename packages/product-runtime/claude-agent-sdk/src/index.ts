/**
 * Shared Claude Code product runtime: the pinned official Agent SDK, the
 * native permission-mode vocabulary, and the projection that places the
 * SDK's real CLI under the harness subprocess seam. The one-shot subagent
 * provider and the conversation backend both build on it.
 *
 * @module @deepseek-ai/dsh-claude-agent-sdk
 */

export {
  CLAUDE_CODE_PERMISSION_MODES,
  DEFAULT_CLAUDE_CODE_PERMISSION_MODE,
  SUPPORTED_UNATTENDED_DIALOG_KINDS,
  type ClaudeCodePermissionMode,
} from './permission.ts'
export {
  ManagedClaudeCodeProcess,
  claudeSpawnSpec,
  sdkEnvironmentOverlay,
} from './process.ts'
export {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type SpawnOptions,
  type SpawnedProcess,
} from './sdk.ts'
