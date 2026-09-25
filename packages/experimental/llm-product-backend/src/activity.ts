/**
 * One-line descriptions of what an external agent product did during a turn,
 * streamed as reasoning text so the durable assistant message carries the
 * activity without a new presentation surface.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/activity
 */

/** Lifecycle of one product action. */
export type ProductActivityStatus = 'started' | 'completed' | 'failed' | 'declined'

/** A product action reduced to what a reader needs. */
export type ProductActivity =
  | {
    readonly kind: 'command'
    /** The shell command as the product ran it. */
    readonly command: string
    readonly status: ProductActivityStatus
    /** Exit code when the command settled with one. */
    readonly exitCode?: number | undefined
  }
  | {
    readonly kind: 'file-change'
    /** Workspace-relative or absolute paths the change touched. */
    readonly paths: readonly string[]
    readonly status: ProductActivityStatus
  }
  | {
    readonly kind: 'tool'
    /** The product's tool name. */
    readonly name: string
    readonly status: ProductActivityStatus
  }

const MAX_COMMAND_CHARS = 200

function boundedCommand(command: string): string {
  const collapsed = command.replaceAll(/\s+/g, ' ').trim()
  return collapsed.length <= MAX_COMMAND_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_COMMAND_CHARS - 1)}…`
}

function exitSuffix(exitCode: number | undefined): string {
  return exitCode === undefined ? '' : ` (exit ${exitCode})`
}

function commandLine(activity: Extract<ProductActivity, { kind: 'command' }>): string {
  const command = `\`${boundedCommand(activity.command)}\``
  switch (activity.status) {
    case 'started':
      return `running ${command}`
    case 'completed':
      return `ran ${command}${exitSuffix(activity.exitCode)}`
    case 'failed':
      return `command ${command} failed${exitSuffix(activity.exitCode)}`
    case 'declined':
      return `declined command ${command}`
  }
}

function fileChangeLine(activity: Extract<ProductActivity, { kind: 'file-change' }>): string {
  const target = activity.paths.length === 0 ? 'files' : activity.paths.join(', ')
  switch (activity.status) {
    case 'started':
      return `editing ${target}`
    case 'completed':
      return `edited ${target}`
    case 'failed':
      return `failed to edit ${target}`
    case 'declined':
      return `declined edits to ${target}`
  }
}

function toolLine(activity: Extract<ProductActivity, { kind: 'tool' }>): string {
  switch (activity.status) {
    case 'started':
      return `using tool ${activity.name}`
    case 'completed':
      return `used tool ${activity.name}`
    case 'failed':
      return `tool ${activity.name} failed`
    case 'declined':
      return `declined tool ${activity.name}`
  }
}

/**
 * Describe one product action on a single line without a trailing newline.
 * @param activity - the reduced product action.
 * @returns a short present- or past-tense line naming the action and its outcome.
 */
export function activityLine(activity: ProductActivity): string {
  switch (activity.kind) {
    case 'command':
      return commandLine(activity)
    case 'file-change':
      return fileChangeLine(activity)
    case 'tool':
      return toolLine(activity)
  }
}
