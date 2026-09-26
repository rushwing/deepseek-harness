/**
 * The `lifecycle:policy` prompt section shown in Sessions whose workspace
 * carries the lifecycle tables.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/section
 */

/**
 * The policy text for a lifecycle directory.
 * @param dir - the lifecycle directory relative to the workspace.
 * @returns the section text.
 */
export function policyText(dir: string): string {
  return [
    `This workspace runs the lifecycle team process from \`${dir}/\`. Requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL) live under \`${dir}/tasks/\`; their standards live under \`${dir}/standards/\`.`,
    'Use `lifecycle_status` to read a REQ\'s state, owner, and legal transitions, `lifecycle_check_in` before working on a REQ as a role, and `lifecycle_lint` before handing artifacts over.',
    'Never edit `status`, `owner`, `review_round`, `pending_bugs`, or the `blocked_*` frontmatter fields by hand: lifecycle transitions move them.',
  ].join('\n')
}
