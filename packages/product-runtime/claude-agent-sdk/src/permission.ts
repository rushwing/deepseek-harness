/**
 * Native Claude Code permission modes that never wait for a human, and the
 * dialog kinds an unattended query declares it can answer.
 *
 * @module @deepseek-ai/dsh-claude-agent-sdk/permission
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk'

/** Claude Code permission modes that cannot wait for a human response. */
export const CLAUDE_CODE_PERMISSION_MODES = [
  'dontAsk',
  'acceptEdits',
  'auto',
  'plan',
  'bypassPermissions',
] as const satisfies readonly NonNullable<Options['permissionMode']>[]

/** Deployment-selectable non-interactive Claude Code permission mode. */
export type ClaudeCodePermissionMode = typeof CLAUDE_CODE_PERMISSION_MODES[number]

/** Safe default for unattended Claude Code runs. */
export const DEFAULT_CLAUDE_CODE_PERMISSION_MODE: ClaudeCodePermissionMode = 'dontAsk'

/** The blocking dialog kinds an unattended query answers by cancelling. */
export const SUPPORTED_UNATTENDED_DIALOG_KINDS = [
  'refusal_fallback_prompt',
] satisfies NonNullable<Options['supportedDialogKinds']>
