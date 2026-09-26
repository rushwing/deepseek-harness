/**
 * Snapshots of the artifact tree around one step: what a role child changed,
 * and the restoration of every file to its pre-step bytes when the step is
 * rejected or fails.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/tree
 */

import { readdir, readFile, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { writeAtomically, type FileWrite } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

/** Workspace-relative path to file text. */
export type Tree = ReadonlyMap<string, string>

/** The labels a step changed, sorted. */
export interface TreeDiff {
  readonly changed: string[]
  readonly added: string[]
  readonly deleted: string[]
}

/**
 * Read every file under the artifact tree.
 * @param cwd - the absolute workspace directory.
 * @param tasksDir - the tree relative to the workspace, POSIX separators.
 * @returns label to text.
 */
export async function snapshotTree(cwd: string, tasksDir: string): Promise<Map<string, string>> {
  const root = join(cwd, ...tasksDir.split('/'))
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const paths = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort()
  const tree = new Map<string, string>()
  for (const path of paths) tree.set(`${tasksDir}/${relative(root, path).split(sep).join('/')}`, await readFile(path, 'utf8'))
  return tree
}

/**
 * Compare two snapshots.
 * @param before - the tree before the step.
 * @param after - the tree after the step.
 * @returns the changed, added, and deleted labels.
 */
export function diffTree(before: Tree, after: Tree): TreeDiff {
  const changed: string[] = []
  const added: string[] = []
  for (const [label, text] of after) {
    const previous = before.get(label)
    if (previous === undefined) added.push(label)
    else if (previous !== text) changed.push(label)
  }
  const deleted = [...before.keys()].filter(label => !after.has(label))
  return { changed: changed.sort(), added: added.sort(), deleted: deleted.sort() }
}

/**
 * Restore the tree to `before`: changed and deleted files get their previous
 * bytes back atomically, added files are removed.
 * @param cwd - the absolute workspace directory.
 * @param before - the tree before the step.
 * @param after - the tree as the step left it.
 * @returns the diff that was undone.
 */
export async function restoreTree(cwd: string, before: Tree, after: Tree): Promise<TreeDiff> {
  const diff = diffTree(before, after)
  const undone = new Set([...diff.changed, ...diff.deleted])
  const writes: FileWrite[] = [...before].filter(([label]) => undone.has(label)).map(([path, text]) => ({ path, text }))
  await writeAtomically(cwd, writes)
  await Promise.all(diff.added.map(label => rm(join(cwd, ...label.split('/')), { force: true })))
  return diff
}
