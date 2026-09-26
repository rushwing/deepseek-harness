import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARSE_OPTIONS,
  type Artifact,
  directorySource,
  loadGraph,
  memorySource,
  parseArtifact,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

const FIXTURES = fileURLToPath(new URL('./fixtures/workspace/lifecycle/tasks/', import.meta.url))
const TASKS = 'lifecycle/tasks'

const node = (value: Artifact | string): Artifact => {
  if (typeof value === 'string') throw new Error(value)
  return value
}

const REQ = (id: string, extra = ''): string => `---\nreq_id: ${id}\nstatus: draft\nowner: human-001\ntc_policy: required\n${extra}---\n\n## Goal\ng\n## Acceptance criteria\n- **AC-${id.slice(4)}-01** one\n`

describe('parseArtifact', () => {
  it('builds the kind-specific node with its placement facts', () => {
    const req = parseArtifact('features/platform/REQ-PLAT-001.md', REQ('REQ-PLAT-001', 'lifecycle_schema: 2\n'), TASKS, DEFAULT_PARSE_OPTIONS)
    expect(req).toMatchObject({
      kind: 'REQ',
      id: 'REQ-PLAT-001',
      label: 'lifecycle/tasks/features/platform/REQ-PLAT-001.md',
      scopeDir: 'platform',
      prefix: 'PLAT',
      location: 'live',
      live: true,
      archived: false,
      status: 'draft',
      tool: 'platform',
      v2: true,
      effectiveStatus: 'draft',
      tcPolicy: 'required',
      acIds: ['AC-PLAT-001-01'],
    })
    const blocked = parseArtifact('archive/done/REQ-PLAT-002.md', REQ('REQ-PLAT-002', 'tool: platform\nblocked_from_status: tc_impl\n').replace('status: draft', 'status: blocked'), TASKS, DEFAULT_PARSE_OPTIONS)
    expect(blocked).toMatchObject({ kind: 'REQ', location: 'archive/done', live: false, archived: true, scopeDir: 'done', tool: 'platform', effectiveStatus: 'tc_impl', v2: false })
    const tc = parseArtifact('test-cases/platform/TC-PLAT-001-01.md', '---\ntc_id: TC-PLAT-001-01\nlinked_req: REQ-PLAT-001\nverifies: [AC-PLAT-001-01]\nlevel: unit\nautomated: true\nstatus: draft\n---\nbody\n', TASKS, DEFAULT_PARSE_OPTIONS)
    expect(tc).toMatchObject({ kind: 'TC', verifies: ['AC-PLAT-001-01'], automatedOk: true, levelOk: true, derivedReq: 'REQ-PLAT-001', numberMatches: true, wellFormed: true })
    const badTc = parseArtifact('test-cases/platform/TC-PLAT-001-02.md', '---\ntc_id: TC-PLAT-001-02\nlinked_req: REQ-PLAT-009\nlevel: smoke\nautomated: "yes"\n---\n', TASKS, DEFAULT_PARSE_OPTIONS)
    expect(badTc).toMatchObject({ kind: 'TC', automatedOk: false, levelOk: false, numberMatches: false, wellFormed: false, verifies: [] })
    const listTc = parseArtifact('test-cases/platform/TC-PLAT-001-03.md', '---\ntc_id: TC-PLAT-001-03\nlinked_req: [REQ-PLAT-001]\nlevel: unit\nautomated: false\n---\n', TASKS, DEFAULT_PARSE_OPTIONS)
    expect(listTc).toMatchObject({ kind: 'TC', numberMatches: false })
    expect(parseArtifact('bugs/platform/BUG-PLAT-001.md', '---\nbug_id: BUG-PLAT-001\nstatus: open\n---\n', TASKS, DEFAULT_PARSE_OPTIONS)).toMatchObject({ kind: 'BUG', status: 'open' })
    expect(parseArtifact('plans/platform/PL-PLAT-001.md', '---\npl_id: PL-PLAT-001\n---\n', TASKS, DEFAULT_PARSE_OPTIONS)).toMatchObject({ kind: 'PL', status: '' })
    const rv = node(parseArtifact('reviews/platform/RV-PLAT-001.md', '---\nrv_id: RV-PLAT-001\n---\n## req_review\nConclusion: PASS (round 1, 2026-09-13, evaluator-002)\n## regression\n2026-09-13 | evaluator-002 | s | TC-PLAT-001-01 | passed\n', TASKS, DEFAULT_PARSE_OPTIONS))
    expect(rv).toMatchObject({ kind: 'RV', regression: [{ tc: 'TC-PLAT-001-01' }] })
    expect(rv.kind === 'RV' ? Object.keys(rv.sections) : []).toEqual(['req_review'])
  })

  it('returns one problem for a file that is not an artifact node', () => {
    const parse = (path: string, text: string) => parseArtifact(path, text, TASKS, DEFAULT_PARSE_OPTIONS)
    expect(parse('features/platform/README.md', '')).toBe('lifecycle/tasks/features/platform/README.md: file name is not any of the artifact kinds REQ / TC / BUG / RV / PL')
    expect(parse('features/platform/REQ-PLAT-7.md', '')).toBe("lifecycle/tasks/features/platform/REQ-PLAT-7.md: file name 'REQ-PLAT-7' does not match the REQ id shape")
    expect(parse('features/REQ-PLAT-007.md', '')).toBe("lifecycle/tasks/features/REQ-PLAT-007.md: REQ is in the wrong directory 'features', allowed only in [features/<scope>, archive/done, archive/superseded]; a misplaced file is not an artifact node")
    expect(parse('archive/done/TC-PLAT-007-01.md', '')).toBe("lifecycle/tasks/archive/done/TC-PLAT-007-01.md: TC is in the wrong directory 'archive/done', allowed only in [test-cases/<scope>]; a misplaced file is not an artifact node")
    expect(parse('features/platform/REQ-PLAT-007.md', 'no frontmatter')).toBe('lifecycle/tasks/features/platform/REQ-PLAT-007.md: missing YAML frontmatter')
    expect(parse('features/platform/REQ-PLAT-007.md', '---\n- a\n---\n')).toBe('lifecycle/tasks/features/platform/REQ-PLAT-007.md: frontmatter is not a mapping')
  })
})

describe('loadGraph', () => {
  it('loads the translated factory-tools fixtures into a linked graph', () => {
    const graph = loadGraph(directorySource(FIXTURES, TASKS), DEFAULT_PARSE_OPTIONS)
    expect(graph.problems).toEqual([])
    expect([...graph.reqs.keys()]).toEqual(['REQ-PLAT-008', 'REQ-PLAT-009', 'REQ-CBOM-021', 'REQ-PLAT-010'])
    expect(graph.tcs.size).toBe(22)
    expect([...graph.bugs.keys()]).toEqual(['BUG-PLAT-003', 'BUG-PLAT-004', 'BUG-PLAT-005', 'BUG-PLAT-006'])
    expect(graph.rvOf.get('REQ-PLAT-009')?.id).toBe('RV-PLAT-009')
    expect(graph.plOf.get('REQ-PLAT-009')?.id).toBe('PL-PLAT-009')
    expect(graph.ownTcs.get('REQ-PLAT-009')).toHaveLength(21)
    expect(graph.ownTcs.get('REQ-PLAT-009')?.[0]).toBe('TC-PLAT-009-01')
    expect(graph.carriedBugs.get('REQ-PLAT-009')).toEqual(['BUG-PLAT-003', 'BUG-PLAT-004', 'BUG-PLAT-005', 'BUG-PLAT-006'])
    expect(graph.blockingBugs.get('REQ-PLAT-009')).toBeUndefined()
    expect(graph.acs.get('AC-PLAT-009-25')).toBe('REQ-PLAT-009')
    expect(graph.acs.size).toBe(36)
    expect(graph.reqs.get('REQ-PLAT-009')?.acceptance).toHaveLength(33)
    expect(graph.reqs.get('REQ-CBOM-021')?.v2).toBe(false)
    expect(graph.resolve('REQ-PLAT-009', 'REQ')).toEqual({ raw: 'REQ-PLAT-009', kind: 'REQ', resolved: 'REQ-PLAT-009', reason: '', empty: false })
    expect(graph.resolve('REQ-PLAT-007', 'REQ')).toMatchObject({ resolved: undefined, reason: 'not an existing REQ' })
    expect(graph.resolveReq('REQ-PLAT-009')).toBe(graph.reqs.get('REQ-PLAT-009'))
    expect(graph.resolveReq('REQ-PLAT-007')).toBeUndefined()
    expect(graph.resolve(' ', 'REQ')).toMatchObject({ reason: 'empty', empty: true })
    expect(graph.resolve(['REQ-PLAT-009'], 'REQ')).toMatchObject({ reason: 'not a scalar REQ id' })
    expect(graph.resolve('BUG-PLAT-003', 'REQ')).toMatchObject({ reason: 'not in the REQ id format' })
    expect(graph.nodeFor('lifecycle/tasks/plans/platform/PL-PLAT-009.md')?.kind).toBe('PL')
    expect(graph.nodeFor('lifecycle/tasks/plans/platform/PL-PLAT-999.md')).toBeUndefined()
    expect(graph.artifacts.map(node => node.kind).filter(kind => kind === 'RV')).toEqual(['RV'])
  })

  it('records broken files, duplicates, and unreadable files without stopping', () => {
    const files: Record<string, string> = {
      'features/platform/REQ-PLAT-001.md': REQ('REQ-PLAT-001'),
      'archive/done/REQ-PLAT-001.md': REQ('REQ-PLAT-001'),
      'features/platform/REQ-PLAT-002.md': 'no frontmatter',
      'features/platform/notes.md': 'ignored',
      'bugs/platform/BUG-PLAT-001.md': '---\nbug_id: BUG-PLAT-001\nlinked_req: REQ-PLAT-001\nblocks_req: [REQ-PLAT-001, REQ-PLAT-404]\n---\n',
      'test-cases/platform/TC-PLAT-001-01.md': '---\ntc_id: TC-PLAT-001-01\nlinked_req: REQ-PLAT-001\nlevel: unit\nautomated: true\n---\n',
    }
    const source = memorySource(TASKS, files)
    const failing = {
      ...source,
      read: (path: string) => {
        if (path.endsWith('BUG-PLAT-001.md')) throw new Error('EACCES')
        if (path.endsWith('TC-PLAT-001-01.md')) throw 'disk on fire'
        return source.read(path)
      },
    }
    const graph = loadGraph(failing, DEFAULT_PARSE_OPTIONS)
    expect(graph.problems).toEqual([
      'lifecycle/tasks/bugs/platform/BUG-PLAT-001.md: cannot read content (EACCES)',
      'lifecycle/tasks/features/platform/REQ-PLAT-002.md: missing YAML frontmatter',
      'lifecycle/tasks/test-cases/platform/TC-PLAT-001-01.md: cannot read content (disk on fire)',
    ])
    expect([...graph.broken.entries()]).toEqual([
      ['lifecycle/tasks/bugs/platform/BUG-PLAT-001.md', 'unreadable'],
      ['lifecycle/tasks/features/platform/REQ-PLAT-002.md', 'lifecycle/tasks/features/platform/REQ-PLAT-002.md: missing YAML frontmatter'],
      ['lifecycle/tasks/test-cases/platform/TC-PLAT-001-01.md', 'unreadable'],
    ])
    expect(graph.duplicates.get('REQ-PLAT-001')).toEqual(['lifecycle/tasks/archive/done/REQ-PLAT-001.md', 'lifecycle/tasks/features/platform/REQ-PLAT-001.md'])
    expect(graph.reqs.get('REQ-PLAT-001')?.label).toBe('lifecycle/tasks/archive/done/REQ-PLAT-001.md')
    expect(graph.nodeFor('lifecycle/tasks/features/platform/REQ-PLAT-001.md')).toBeUndefined()
    expect(graph.ownTcs.get('REQ-PLAT-001')).toBeUndefined()
    expect(graph.bugs.size).toBe(0)

    const linked = loadGraph(memorySource(TASKS, {
      ...files,
      'features/platform/REQ-PLAT-002.md': REQ('REQ-PLAT-002').replace('AC-PLAT-002-01', 'AC-PLAT-001-01'),
      'bugs/platform/BUG-PLAT-002.md': '---\nbug_id: BUG-PLAT-002\nlinked_req: REQ-PLAT-404\n---\n',
    }), DEFAULT_PARSE_OPTIONS)
    expect(linked.ownTcs.get('REQ-PLAT-001')).toEqual(['TC-PLAT-001-01'])
    expect(linked.acs.get('AC-PLAT-001-01')).toBe('REQ-PLAT-001')
    expect(linked.carriedBugs.get('REQ-PLAT-001')).toEqual(['BUG-PLAT-001'])
    expect(linked.carriedBugs.get('REQ-PLAT-404')).toBeUndefined()
    expect(linked.blockingBugs.get('REQ-PLAT-001')).toEqual(['BUG-PLAT-001'])
    expect(linked.blockingBugs.get('REQ-PLAT-404')).toBeUndefined()
  })

  it('reads a directory source recursively and only for Markdown files', () => {
    const source = directorySource(FIXTURES, TASKS)
    expect(source.tasksDir).toBe(TASKS)
    expect(source.files()[0]).toBe('archive/done/REQ-PLAT-008.md')
    expect(source.files()).toHaveLength(32)
    expect(source.read('plans/platform/PL-PLAT-009.md')).toMatch(/^---\npl_id: PL-PLAT-009/)
    expect(directorySource(`${FIXTURES}missing/`, TASKS).files()).toEqual([])
    expect(() => directorySource(`${FIXTURES}plans/platform/PL-PLAT-009.md`, TASKS).files()).toThrow(/ENOTDIR/)
    expect(() => memorySource(TASKS, {}).read('missing.md')).toThrow('no such file: missing.md')
  })
})
