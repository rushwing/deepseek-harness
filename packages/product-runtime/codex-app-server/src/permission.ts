/**
 * Native non-interactive Codex permission modes and their official
 * `thread/start` and `thread/resume` field mapping.
 *
 * @module @deepseek-ai/dsh-codex-app-server/permission
 */

/** Native non-interactive Codex permission mode selectable by a deployment. */
export type CodexPermissionMode =
  | 'never'
  | 'approve-for-me'
  | 'dangerously-bypass-approvals-and-sandbox'

/** Native non-interactive Codex modes mapped to official thread fields. */
export const CODEX_PERMISSION_MODES = [
  'never',
  'approve-for-me',
  'dangerously-bypass-approvals-and-sandbox',
] as const satisfies readonly CodexPermissionMode[]

/** Safe default for unattended Codex runs. */
export const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = 'never'

/** Official thread fields selected by one permission mode. */
export type CodexThreadPermissionParams = Readonly<Record<string, string>>

const THREAD_PERMISSION_PARAMS: Readonly<Record<CodexPermissionMode, CodexThreadPermissionParams>> = {
  never: { approvalPolicy: 'never' },
  'approve-for-me': {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  },
  'dangerously-bypass-approvals-and-sandbox': {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
}

/**
 * The thread fields for a client that answers Codex approval requests itself:
 * Codex asks before commands and file changes and runs under the
 * workspace-write sandbox.
 */
export const INTERACTIVE_THREAD_PERMISSION_PARAMS: CodexThreadPermissionParams = {
  approvalPolicy: 'on-request',
  sandbox: 'workspace-write',
}

/**
 * The official thread fields one native mode selects.
 * @param mode - a native non-interactive permission mode.
 * @returns a fresh object holding the `approvalPolicy`, `approvalsReviewer`, and `sandbox` fields the mode sets.
 */
export function threadPermissionParams(mode: CodexPermissionMode): Record<string, string> {
  return { ...THREAD_PERMISSION_PARAMS[mode] }
}
