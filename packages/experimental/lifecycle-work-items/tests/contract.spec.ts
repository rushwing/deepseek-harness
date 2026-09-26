import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import {
  DEFAULT_ARTIFACT_CONTRACT,
  loadArtifactContract,
  parseOptionsOf,
  reqHeadingList,
  tcHeadingList,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

type Yaml = Record<string, unknown>

function edited(edit: (doc: Yaml) => void): string {
  const doc = parse(stringify(DEFAULT_ARTIFACT_CONTRACT)) as Yaml
  edit(doc)
  return stringify(doc)
}

describe('loadArtifactContract', () => {
  it('round-trips the English default contract', () => {
    const load = loadArtifactContract(stringify(DEFAULT_ARTIFACT_CONTRACT), 'artifact-contract.yml')
    expect(load.problems).toEqual([])
    expect(load.contract).toEqual(DEFAULT_ARTIFACT_CONTRACT)
    expect(reqHeadingList(DEFAULT_ARTIFACT_CONTRACT)).toEqual(['Goal', 'Behavior', 'Non-goals', 'Acceptance criteria', 'Pending decisions', 'Design references', 'Bug History'])
    expect(tcHeadingList(DEFAULT_ARTIFACT_CONTRACT)).toEqual(['Preconditions', 'Steps', 'Expected results', 'Implementation location'])
    expect(parseOptionsOf(DEFAULT_ARTIFACT_CONTRACT)).toMatchObject({ acceptanceHeading: 'Acceptance criteria', schemaKey: 'lifecycle_schema', schemaVersion: 2 })
    expect(parseOptionsOf(DEFAULT_ARTIFACT_CONTRACT).review.conclusionLabel).toBe('Conclusion:')
  })

  it.each<[string, string, RegExp]>([
    ['invalid YAML', 'version: [', /not valid YAML/],
    ['a non-mapping document', '- a\n', /top level is not a mapping/],
    ['an unsupported version', edited((doc) => { doc.version = 2 }), /^artifact-contract\.yml: version: /],
    ['an unknown key', edited((doc) => { doc.extra = 1 }), /^artifact-contract\.yml: Unrecognized key: "extra"$/],
    ['a missing section', edited((doc) => { delete doc.pl }), /^artifact-contract\.yml: pl: /],
    ['a non-positive budget', edited((doc) => { (doc.req as Yaml).bodyBudget = 0 }), /^artifact-contract\.yml: req\.bodyBudget: /],
    ['a fractional budget', edited((doc) => { (doc.tc as Yaml).bodyBudget = 1.5 }), /^artifact-contract\.yml: tc\.bodyBudget: /],
    ['two REQ sections with one heading', edited((doc) => { ((doc.req as Yaml).headings as Yaml).goal = 'Behavior'; delete ((doc.req as Yaml).sectionBudgets as Yaml).Goal }), /req\.headings: heading 'Behavior' names more than one section/],
    ['a banned heading that is also a section', edited((doc) => { ((doc.req as Yaml).bannedHeadings as string[]).push('Goal') }), /req\.bannedHeadings: 'Goal' is also a section heading/],
    ['a section budget for an unknown heading', edited((doc) => { ((doc.req as Yaml).sectionBudgets as Yaml).Epilogue = 10 }), /req\.sectionBudgets: 'Epilogue' is not a REQ section heading/],
    ['two TC sections with one heading', edited((doc) => { ((doc.tc as Yaml).headings as Yaml).steps = 'Preconditions' }), /tc\.headings: heading 'Preconditions' names more than one section/],
    ['repeated PL headings', edited((doc) => { ((doc.pl as Yaml).headings as string[]).push('Test support') }), /pl\.headings: 'Test support' appears more than once/],
    ['an evidence field outside the fixed fields', edited((doc) => { (doc.review as Yaml).evidenceField = 'Proof' }), /review\.evidenceField: 'Proof' is not one of the fixed fields/],
    ['a scope field outside the fixed fields', edited((doc) => { (doc.review as Yaml).scopeField = 'Range' }), /review\.scopeField: 'Range' is not one of the fixed fields/],
    ['repeated review fields', edited((doc) => { ((doc.review as Yaml).fields as string[]).push('Evidence') }), /review\.fields: 'Evidence' appears more than once/],
    ['a lexicon pattern that does not compile', edited((doc) => { ((doc.lexicon as Yaml).categories as Yaml)['code path'] = ['('] }), /lexicon\.categories\.code path: pattern '\(' does not compile/],
    ['a lexicon category without patterns', edited((doc) => { ((doc.lexicon as Yaml).categories as Yaml)['code path'] = [] }), /lexicon\.categories\.code path: /],
  ])('reports %s as one problem', (_case, text, expected) => {
    const load = loadArtifactContract(text, 'artifact-contract.yml')
    expect(load.contract).toBeUndefined()
    expect(load.problems).toHaveLength(1)
    expect(load.problems[0]).toMatch(expected)
  })

  it('reports every independent problem of a mapping together', () => {
    const load = loadArtifactContract(edited((doc) => { delete doc.pl; (doc.req as Yaml).bodyBudget = -1 }), 'c.yml')
    expect(load.problems).toHaveLength(2)
    expect(load.problems.every(problem => problem.startsWith('c.yml: '))).toBe(true)
  })
})
