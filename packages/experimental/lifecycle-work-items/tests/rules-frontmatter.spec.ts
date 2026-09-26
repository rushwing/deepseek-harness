import { describe, expect, it } from 'vitest'
import { BUG_003, REQ_009, REQ_021, TC_009_01, dropField, lintWorkspace, ofRule, removeFile, setField, type Files } from './lint-helper.ts'

describe('the fixture workspace', () => {
  it('lints clean', () => {
    expect(lintWorkspace()).toEqual([])
  })

  it('reports files that cannot become nodes as graph violations', () => {
    const violations = lintWorkspace((files) => { files['lifecycle/tasks/features/platform/REQ-PLAT-011.md'] = 'no frontmatter here\n' })
    expect(ofRule(violations, 'graph')).toEqual([
      { file: 'lifecycle/tasks/features/platform/REQ-PLAT-011.md', rule: 'graph', message: 'missing YAML frontmatter' },
    ])
  })
})

describe('frontmatter field rules', () => {
  it.each<[string, (files: Files) => unknown, string, RegExp]>([
    ['a missing REQ field', files => dropField(files, REQ_021, 'priority'), 'req-fields', /REQ-CBOM-021\.md: missing frontmatter field 'priority'$/m],
    ['a REQ id unlike its file name', files => setField(files, REQ_021, 'req_id', 'REQ-CBOM-022'), 'req-fields', /req_id 'REQ-CBOM-022' does not match the file name/],
    ['a REQ tool unlike its directory', files => setField(files, REQ_021, 'tool', 'platform'), 'req-fields', /tool 'platform' does not match the directory 'canonical-bom'/],
    ['an unregistered REQ status', files => setField(files, REQ_021, 'status', 'shipped'), 'req-fields', /status 'shipped' is not a registered REQ status/],
    ['an unknown priority', files => setField(files, REQ_021, 'priority', 'P9'), 'req-fields', /priority 'P9' is not one of \[P0, P1, P2, P3\]/],
    ['an unknown scope', files => setField(files, REQ_021, 'scope', 'kitchen'), 'req-fields', /scope 'kitchen' is not one of \[design, backend/],
    ['an unknown tc_policy', files => setField(files, REQ_021, 'tc_policy', 'maybe'), 'req-fields', /tc_policy 'maybe' is not one of \[required, optional, exempt\]/],
    ['an exempt REQ without a reason', (files) => { setField(files, REQ_021, 'tc_policy', 'exempt'); setField(files, REQ_021, 'exempt_reason', '""') }, 'req-fields', /tc_policy exempt requires exempt_reason/],
    ['an unregistered REQ owner', files => setField(files, REQ_021, 'owner', 'ghost-001'), 'req-fields', /owner 'ghost-001' is not registered in agent-registry\.yml/],
    ['a blank acceptance', files => setField(files, REQ_021, 'acceptance', '"  "'), 'req-fields', /acceptance must not be empty; a requirement must be verifiable/],
    ['a blocked REQ without a reason', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]'); setField(files, REQ_021, 'blocked_from_status', 'req_review'); setField(files, REQ_021, 'blocked_from_owner', 'planner') }, 'req-fields', /status blocked requires blocked_reason/],
    ['a missing TC field', files => dropField(files, TC_009_01, 'level'), 'tc-fields', /TC-PLAT-009-01\.md: missing frontmatter field 'level'$/m],
    ['a TC id unlike its file name', files => setField(files, TC_009_01, 'tc_id', 'TC-PLAT-009-99'), 'tc-fields', /tc_id 'TC-PLAT-009-99' does not match the file name/],
    ['a TC tool unlike its directory', files => setField(files, TC_009_01, 'tool', 'canonical-bom'), 'tc-fields', /tool 'canonical-bom' does not match the directory 'platform'/],
    ['an unregistered TC status', files => setField(files, TC_009_01, 'status', 'green'), 'tc-fields', /status 'green' is not a registered TC status/],
    ['an unregistered TC owner', files => setField(files, TC_009_01, 'owner', 'ghost-001'), 'tc-fields', /owner 'ghost-001' is not registered in agent-registry\.yml/],
    ['a missing BUG field', files => dropField(files, BUG_003, 'severity'), 'bug-fields', /BUG-PLAT-003\.md: missing frontmatter field 'severity'$/m],
    ['a BUG id unlike its file name', files => setField(files, BUG_003, 'bug_id', 'BUG-PLAT-033'), 'bug-fields', /bug_id 'BUG-PLAT-033' does not match the file name/],
    ['a BUG tool unlike its directory', files => setField(files, BUG_003, 'tool', 'canonical-bom'), 'bug-fields', /tool 'canonical-bom' does not match the directory 'platform'/],
    ['an unregistered BUG status', files => setField(files, BUG_003, 'status', 'fixed'), 'bug-fields', /status 'fixed' is not a registered BUG status/],
    ['an unregistered BUG owner', files => setField(files, BUG_003, 'owner', 'ghost-001'), 'bug-fields', /owner 'ghost-001' is not registered in agent-registry\.yml/],
  ])('names %s', (_case, edit, rule, expected) => {
    const violations = ofRule(lintWorkspace(edit), rule)
    expect(violations.map(violation => `${violation.file}: ${violation.message}`).join('\n')).toMatch(expected)
  })

  it('checks scope directories and file names against the id scheme', () => {
    const moved = lintWorkspace((files) => {
      files['lifecycle/tasks/features/misc/REQ-MISC-001.md'] = String(files[REQ_021]).replace('REQ-CBOM-021', 'REQ-MISC-001').replace('tool: canonical-bom', 'tool: misc')
      files['lifecycle/tasks/test-cases/platform/TC-CBOM-009-01.md'] = String(files[TC_009_01]).replace(/TC-PLAT-009-01/g, 'TC-CBOM-009-01')
      files['lifecycle/tasks/features/platform/REQ-CBOM-001.md'] = String(files[REQ_021]).replace('REQ-CBOM-021', 'REQ-CBOM-001').replace('tool: canonical-bom', 'tool: platform')
      files['lifecycle/tasks/bugs/platform/BUG-CBOM-003.md'] = String(files[BUG_003]).replace('BUG-PLAT-003', 'BUG-CBOM-003')
    })
    expect(ofRule(moved, 'placement').map(violation => `${violation.file}: ${violation.message}`)).toEqual([
      'lifecycle/tasks/bugs/platform/BUG-CBOM-003.md: file name should look like BUG-PLAT-NNN.md',
      "lifecycle/tasks/features/misc/REQ-MISC-001.md: directory 'misc' is not registered in id-scheme.yml scopes",
      'lifecycle/tasks/features/platform/REQ-CBOM-001.md: file name should look like REQ-PLAT-NNN.md',
      'lifecycle/tasks/test-cases/platform/TC-CBOM-009-01.md: file name should look like TC-PLAT-NNN-SS.md',
    ])
    expect(ofRule(lintWorkspace(undefined, { idScheme: false }), 'placement')).toEqual([])
  })

  it('skips registry checks when no registry is loaded', () => {
    expect(ofRule(lintWorkspace(files => setField(files, REQ_021, 'owner', 'ghost-001'), { registry: false }), 'req-fields')).toEqual([])
  })
})

describe('REQ frontmatter, blocked fields, pr_number, archive, uniqueness', () => {
  it.each<[string, (files: Files) => unknown, string, RegExp]>([
    ['a v2 REQ without intent', files => dropField(files, REQ_009, 'intent'), 'req-frontmatter', /v2 REQ lacks scalar frontmatter field 'intent'/],
    ['a non-integer review_round', files => setField(files, REQ_009, 'review_round', 'eight'), 'req-frontmatter', /review_round 'eight' is not an integer/],
    ['a live legacy REQ past req_review', files => setField(files, REQ_021, 'status', 'tc_design'), 'req-frontmatter', /status 'tc_design' has left draft and req_review; frontmatter must declare lifecycle_schema: 2/],
    ['a status outside the owner\'s handles', files => setField(files, REQ_021, 'owner', 'planner-001'), 'req-frontmatter', /status 'draft' is not within owner 'planner-001''s handles \[req_review\]/],
    ['pending bugs without blocked', files => setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]'), 'blocked-fields', /pending_bugs is not empty but status is not blocked/],
    ['blocked without pending bugs', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'blocked_reason', 'waiting'); setField(files, REQ_021, 'blocked_from_status', 'req_review'); setField(files, REQ_021, 'blocked_from_owner', 'planner') }, 'blocked-fields', /status is blocked but pending_bugs is empty/],
    ['blocking fields left on an unblocked REQ', files => setField(files, REQ_021, 'blocked_reason', 'stale'), 'blocked-fields', /status is not blocked; blocking fields \[blocked_reason\] must be cleared/],
    ['a blocked REQ without a reason', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]'); setField(files, REQ_021, 'blocked_from_status', 'req_review'); setField(files, REQ_021, 'blocked_from_owner', 'planner') }, 'blocked-fields', /blocked_reason must not be empty while blocked/],
    ['a restore state that is not a restore target', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]'); setField(files, REQ_021, 'blocked_reason', 'waiting'); setField(files, REQ_021, 'blocked_from_status', 'pr_draft'); setField(files, REQ_021, 'blocked_from_owner', 'planner') }, 'blocked-fields', /blocked_from_status 'pr_draft' is not a restore target; legal values \[req_impl, req_review, tc_design, tc_impl\]/],
    ['a restore owner that is not a role', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]'); setField(files, REQ_021, 'blocked_reason', 'waiting'); setField(files, REQ_021, 'blocked_from_status', 'req_review'); setField(files, REQ_021, 'blocked_from_owner', 'planner-001') }, 'blocked-fields', /blocked_from_owner 'planner-001' is not a registered role/],
    ['a restore owner of the wrong role', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]'); setField(files, REQ_021, 'blocked_reason', 'waiting'); setField(files, REQ_021, 'blocked_from_status', 'req_review'); setField(files, REQ_021, 'blocked_from_owner', 'generator') }, 'blocked-fields', /restore target 'req_review' is taken over by planner; blocked_from_owner 'generator' is another role/],
    ['a pending bug that does not exist', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-404]'); setField(files, REQ_021, 'blocked_reason', 'waiting'); setField(files, REQ_021, 'blocked_from_status', 'req_review'); setField(files, REQ_021, 'blocked_from_owner', 'planner') }, 'blocked-fields', /BUG-PLAT-404 in pending_bugs does not exist/],
    ['a pending bug that does not block the REQ', (files) => { setField(files, REQ_021, 'status', 'blocked'); setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]'); setField(files, REQ_021, 'blocked_reason', 'waiting'); setField(files, REQ_021, 'blocked_from_status', 'req_review'); setField(files, REQ_021, 'blocked_from_owner', 'planner') }, 'blocked-fields', /BUG-PLAT-003 in pending_bugs does not list this REQ in blocks_req/],
    ['a non-integer pr_number', files => setField(files, REQ_009, 'pr_number', '"26"'), 'pr-number', /pr_number '26' is illegal; only null or a positive integer/],
    ['a zero pr_number', files => setField(files, REQ_009, 'pr_number', '0'), 'pr-number', /pr_number 0 is illegal/],
    ['an archived REQ that is not done', files => setField(files, REQ_009, 'status', 'pr_draft'), 'archive-consistency', /in archive\/done the status must be done; got 'pr_draft'/],
    ['a live REQ that is done', files => setField(files, REQ_021, 'status', 'done'), 'archive-consistency', /a done REQ must move to archive\/done, not stay in a live directory/],
    ['a superseded REQ without superseded_by', (files) => { files['lifecycle/tasks/archive/superseded/REQ-CBOM-021.md'] = String(files[REQ_021]).replace('status: draft', 'status: req_review'); removeFile(files, REQ_021) }, 'archive-consistency', /in archive\/superseded superseded_by must be set/],
  ])('names %s', (_case, edit, rule, expected) => {
    const violations = ofRule(lintWorkspace(edit), rule)
    expect(violations.map(violation => `${violation.file}: ${violation.message}`).join('\n')).toMatch(expected)
  })

  it('accepts a blocked REQ whose restore pair and pending bugs agree', () => {
    const violations = lintWorkspace((files) => {
      setField(files, REQ_021, 'status', 'blocked')
      setField(files, REQ_021, 'pending_bugs', '[BUG-PLAT-003]')
      setField(files, REQ_021, 'blocked_reason', 'waiting')
      setField(files, REQ_021, 'blocked_from_status', 'req_review')
      setField(files, REQ_021, 'blocked_from_owner', 'planner')
      setField(files, BUG_003, 'blocks_req', '[REQ-CBOM-021]')
    })
    expect(ofRule(violations, 'blocked-fields')).toEqual([])
    expect(ofRule(violations, 'req-fields')).toEqual([])
  })

  it('names every copy of a duplicated id after the first in path order', () => {
    const violations = lintWorkspace((files) => {
      files['lifecycle/tasks/features/platform/REQ-PLAT-009.md'] = String(files[REQ_009]).replace('status: done', 'status: draft')
    })
    expect(ofRule(violations, 'artifact-uniqueness').map(violation => `${violation.file}: ${violation.message}`)).toEqual([
      'lifecycle/tasks/features/platform/REQ-PLAT-009.md: REQ id REQ-PLAT-009 duplicates lifecycle/tasks/archive/done/REQ-PLAT-009.md; ids are unique across the tasks tree',
    ])
  })
})
