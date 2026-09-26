/**
 * Atomic multi-file writes: each file is replaced through a temporary name
 * and rename, and a failure restores every file already replaced to its
 * original bytes.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/writer
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FileWrite } from './apply.ts'

/** The file operations the writer performs, injectable for failure tests. */
export interface WriterFs {
  readFile(path: string): Promise<string>
  writeFile(path: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  /** Create a directory and its missing parents. */
  mkdir(path: string): Promise<void>
}

const TEMP_SUFFIX = '.dsh-tmp'

/** The writer over `node:fs/promises` with UTF-8 text. */
export const nodeWriterFs: WriterFs = {
  readFile: path => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  rename,
  unlink,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function removeQuietly(fs: WriterFs, path: string): Promise<void> {
  try {
    await fs.unlink(path)
  } catch (_error: unknown) {
    // A temporary file that was never written has nothing to remove.
  }
}

async function replace(fs: WriterFs, target: string, text: string): Promise<void> {
  const temp = `${target}${TEMP_SUFFIX}`
  try {
    await fs.mkdir(dirname(target))
    await fs.writeFile(temp, text)
    await fs.rename(temp, target)
  } catch (error: unknown) {
    await removeQuietly(fs, temp)
    throw error
  }
}

/**
 * Write every file, or none: each write goes through a temporary file and a
 * rename; when one fails, the files already replaced are restored to their
 * original bytes (a file that did not exist is removed) and the error is
 * rethrown. A rollback that itself fails throws an `AggregateError` holding
 * the original error and every rollback error.
 * @param root - the absolute workspace root the write paths are relative to.
 * @param writes - the files to replace.
 * @param fs - the file operations; defaults to `node:fs/promises`.
 */
export async function writeAtomically(root: string, writes: readonly FileWrite[], fs: WriterFs = nodeWriterFs): Promise<void> {
  const absolute = (path: string): string => join(root, ...path.split('/'))
  const originals = new Map<string, string | undefined>()
  for (const write of writes) {
    try {
      originals.set(write.path, await fs.readFile(absolute(write.path)))
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      originals.set(write.path, undefined)
    }
  }
  const done: FileWrite[] = []
  try {
    for (const write of writes) {
      await replace(fs, absolute(write.path), write.text)
      done.push(write)
    }
  } catch (error: unknown) {
    const failures: unknown[] = []
    for (const write of done.reverse()) {
      const original = originals.get(write.path)
      try {
        if (original === undefined) await fs.unlink(absolute(write.path))
        else await replace(fs, absolute(write.path), original)
      } catch (rollback: unknown) {
        failures.push(rollback)
      }
    }
    if (failures.length > 0) throw new AggregateError([error, ...failures], 'atomic write failed and the rollback was incomplete')
    throw error
  }
}
