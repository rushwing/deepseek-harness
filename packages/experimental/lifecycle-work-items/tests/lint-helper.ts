import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAgentRegistry, loadIdScheme, loadLifecycleTable, type AgentRegistry, type IdScheme, type LifecycleTable } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import {
  lint,
  loadArtifactContract,
  loadGraph,
  memorySource,
  parseOptionsOf,
  type ArtifactContract,
  type FileProbe,
  type Violation,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

const ROOT = fileURLToPath(new URL('./fixtures/workspace/', import.meta.url))
const TASKS = 'lifecycle/tasks'

/** Every text file of the fixture workspace, keyed by its POSIX path relative to the workspace root. */
export function workspaceFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/')
    files[path] = readFileSync(join(entry.parentPath, entry.name), 'utf8')
  }
  return files
}

/** A probe over an in-memory workspace: a path is a file when listed, a directory when it prefixes a listed path. */
export function memoryProbe(files: Readonly<Record<string, string>>): FileProbe {
  return {
    kind: (path) => {
      if (path in files) return 'file'
      return Object.keys(files).some(other => other.startsWith(`${path}/`)) ? 'directory' : 'missing'
    },
  }
}

/** The loaded fixture tables. */
export interface Loaded {
  readonly table: LifecycleTable
  readonly registry: AgentRegistry
  readonly idScheme: IdScheme
  readonly contract: ArtifactContract
}

function must<T>(value: T | undefined, problems: readonly string[]): T {
  if (value === undefined) throw new Error(problems.join('\n'))
  return value
}

/** Load the tables of an in-memory workspace. */
export function loadTables(files: Readonly<Record<string, string>>): Loaded {
  const tableLoad = loadLifecycleTable(String(files['lifecycle/lifecycle.yml']))
  const table = must(tableLoad.table, tableLoad.problems)
  const registryLoad = loadAgentRegistry(String(files['lifecycle/agent-registry.yml']), table)
  const idSchemeLoad = loadIdScheme(String(files['lifecycle/tasks/id-scheme.yml']))
  const contractLoad = loadArtifactContract(String(files['lifecycle/artifact-contract.yml']))
  return {
    table,
    registry: must(registryLoad.registry, registryLoad.problems),
    idScheme: must(idSchemeLoad.scheme, idSchemeLoad.problems),
    contract: must(contractLoad.contract, contractLoad.problems),
  }
}

/** The fixture workspace as workspace-relative path to file text. */
export type Files = Record<string, string>

/** Lint the fixture workspace after an optional edit of its files. */
export function lintWorkspace(
  edit?: (files: Files) => unknown,
  options: { readonly registry?: boolean; readonly idScheme?: boolean } = {},
): Violation[] {
  const files = workspaceFiles()
  edit?.(files)
  const loaded = loadTables(files)
  const tasks: Record<string, string> = {}
  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith(`${TASKS}/`) && path.endsWith('.md')) tasks[path.slice(TASKS.length + 1)] = text
  }
  const graph = loadGraph(memorySource(TASKS, tasks), parseOptionsOf(loaded.contract))
  return lint({
    graph,
    contract: loaded.contract,
    table: loaded.table,
    registry: options.registry === false ? undefined : loaded.registry,
    idScheme: options.idScheme === false ? undefined : loaded.idScheme,
    workspace: memoryProbe(files),
  })
}

function textOf(files: Files, path: string): string {
  const text = files[path]
  if (text === undefined) throw new Error(`fixture has no ${path}`)
  return text
}

/** Replace one frontmatter line of a file in place. */
export function setField(files: Files, path: string, key: string, value: string): Files {
  const text = textOf(files, path)
  const pattern = new RegExp(`^${key}:.*$`, 'm')
  if (!pattern.test(text)) throw new Error(`${path} has no field ${key}`)
  files[path] = text.replace(pattern, `${key}: ${value}`)
  return files
}

/** Remove one frontmatter line of a file. */
export function dropField(files: Files, path: string, key: string): Files {
  files[path] = textOf(files, path).replace(new RegExp(`^${key}:.*\\n`, 'm'), '')
  return files
}

/** Rewrite the Markdown body of a file, keeping its frontmatter. */
export function editBody(files: Files, path: string, edit: (body: string) => string): Files {
  const text = textOf(files, path)
  const end = text.indexOf('\n---\n', 4) + '\n---\n'.length
  files[path] = text.slice(0, end) + edit(text.slice(end))
  return files
}

/** Replace the content of one H2 section of a file. */
export function replaceSection(files: Files, path: string, heading: string, content: string): Files {
  return editBody(files, path, body => body.replace(new RegExp(`(## ${heading}\\n)[\\s\\S]*?(?=\\n## |$)`), `$1\n${content}\n`))
}

/** Append text to the end of a file. */
export function appendBody(files: Files, path: string, text: string): Files {
  files[path] = textOf(files, path) + text
  return files
}

/** Remove a file from the workspace. */
export function removeFile(files: Files, path: string): Files {
  Reflect.deleteProperty(files, path)
  return files
}

/** The `file: message` lines of one rule after an edit. */
export function messages(rule: string, edit: (files: Files) => unknown): string {
  return ofRule(lintWorkspace(edit), rule).map(violation => `${violation.file}: ${violation.message}`).join('\n')
}

export const REQ_009 = 'lifecycle/tasks/archive/done/REQ-PLAT-009.md'
export const REQ_008 = 'lifecycle/tasks/archive/done/REQ-PLAT-008.md'
export const REQ_021 = 'lifecycle/tasks/features/canonical-bom/REQ-CBOM-021.md'
export const RV_009 = 'lifecycle/tasks/reviews/platform/RV-PLAT-009.md'
export const PL_009 = 'lifecycle/tasks/plans/platform/PL-PLAT-009.md'
export const TC_009_01 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-009-01.md'
export const TC_008_12 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-008-12.md'
export const BUG_003 = 'lifecycle/tasks/bugs/platform/BUG-PLAT-003.md'
export const BUG_004 = 'lifecycle/tasks/bugs/platform/BUG-PLAT-004.md'
export const BUG_005 = 'lifecycle/tasks/bugs/platform/BUG-PLAT-005.md'
export const REQ_010 = 'lifecycle/tasks/features/platform/REQ-PLAT-010.md'
export const TC_009_09 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-009-09.md'
export const TC_009_16 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-009-16.md'

/** The violations of one rule. */
export function ofRule(violations: readonly Violation[], rule: string): Violation[] {
  return violations.filter(violation => violation.rule === rule)
}
