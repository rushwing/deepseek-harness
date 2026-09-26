/**
 * Where artifact files come from: a directory on disk or an in-memory map,
 * both addressed by POSIX paths relative to the tasks root.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/source
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The files of one tasks tree. */
export interface WorkItemSource {
  /** The tasks root relative to the workspace, the prefix of every label. */
  readonly tasksDir: string
  /** Every Markdown file as a POSIX path relative to the tasks root, sorted. */
  files(): readonly string[]
  /** Read one file's text; throws when the file cannot be read. */
  read(path: string): string
}

/**
 * A source over a directory tree.
 * @param root - the absolute path of the tasks directory.
 * @param tasksDir - the tasks root relative to the workspace.
 * @returns the source; a missing directory has no files.
 */
export function directorySource(root: string, tasksDir: string): WorkItemSource {
  return {
    tasksDir,
    files: () => {
      let entries: readonly { readonly name: string; readonly parentPath: string; isFile(): boolean }[]
      try {
        entries = readdirSync(root, { recursive: true, withFileTypes: true })
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
        throw error
      }
      return entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .sort()
    },
    read: path => readFileSync(join(root, ...path.split('/')), 'utf8'),
  }
}

/**
 * A source over an in-memory file map.
 * @param tasksDir - the tasks root relative to the workspace.
 * @param files - relative POSIX path to file text.
 * @returns the source.
 */
export function memorySource(tasksDir: string, files: Readonly<Record<string, string>>): WorkItemSource {
  return {
    tasksDir,
    files: () => Object.keys(files).sort(),
    read: (path) => {
      const content = files[path]
      if (content === undefined) throw new Error(`no such file: ${path}`)
      return content
    },
  }
}
