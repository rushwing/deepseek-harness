import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(new URL('./fixtures/workspace/lifecycle/tasks/features/platform/REQ-PLAT-010.md', import.meta.url))

/** The REQ the scaffolded-workspace tests and the keyed e2e drive. */
export const SEED_REQ_ID = 'REQ-CORE-001'
/** Its path relative to the workspace. */
export const SEED_REQ_LABEL = 'lifecycle/tasks/features/core/REQ-CORE-001.md'

/**
 * Write REQ-CORE-001 into a workspace scaffolded by `lifecycle_init`: the
 * fixture REQ re-keyed to the default `core` scope, at `req_review` and owned
 * by the scaffolded Planner, with no design plan to link.
 * @param root - the workspace directory holding `lifecycle/`.
 * @param owner - the uid that owns the REQ; the scaffold seats `planner-001`.
 * @returns the REQ text written.
 */
export async function writeSeedReq(root: string, owner = 'planner-001'): Promise<string> {
  const text = (await readFile(TEMPLATE, 'utf8'))
    .replaceAll('REQ-PLAT-010', SEED_REQ_ID)
    .replaceAll('AC-PLAT-010-', 'AC-CORE-001-')
    .replace('tool: platform', 'tool: core')
    .replace('status: draft', 'status: req_review')
    .replace('owner: human-001', `owner: ${owner}`)
    .replace('depends_on: [REQ-PLAT-009]', 'depends_on: []')
    .replace(/## Design references\n\n[^\n]+\n/, '## Design references\n\nNone\n')
  const path = join(root, ...SEED_REQ_LABEL.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, 'utf8')
  return text
}
