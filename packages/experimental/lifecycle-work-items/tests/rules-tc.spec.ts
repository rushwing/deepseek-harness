import { describe, expect, it } from 'vitest'
import {
  BUG_003,
  REQ_009,
  RV_009,
  TC_008_12,
  TC_009_01,
  TC_009_09,
  appendBody,
  editBody,
  lintWorkspace,
  messages,
  ofRule,
  replaceSection,
  setField,
  type Files,
} from './lint-helper.ts'

const TC_008_13 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-008-13.md'
const EXPECTED = '- AC-PLAT-009-01: fine\n- AC-PLAT-009-02: fine'

function blockReq009(files: Files, restoreState: string, restoreOwner: string): Files {
  setField(files, REQ_009, 'status', 'blocked')
  setField(files, REQ_009, 'pending_bugs', '[BUG-PLAT-003]')
  setField(files, REQ_009, 'blocked_reason', 'waiting')
  setField(files, REQ_009, 'blocked_from_status', restoreState)
  return setField(files, REQ_009, 'blocked_from_owner', restoreOwner)
}

describe('TC frontmatter rules', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a non-boolean automated', files => setField(files, TC_009_01, 'automated', '"yes"'), /automated must be a boolean; got 'yes'/],
    ['an unknown level', files => setField(files, TC_009_01, 'level', 'smoke'), /level 'smoke' is not one of \[e2e, integration, unit\]/],
    ['an empty linked_req', files => setField(files, TC_009_01, 'linked_req', '""'), /linked_req '' is empty/],
    ['a list linked_req', files => setField(files, TC_009_01, 'linked_req', '[REQ-PLAT-009]'), /linked_req '\["REQ-PLAT-009"\]' is not a scalar REQ id/],
    ['a malformed linked_req', files => setField(files, TC_009_01, 'linked_req', 'REQ-PLAT-9'), /linked_req 'REQ-PLAT-9' is not in the REQ id format/],
    ['an unresolvable linked_req', files => setField(files, TC_009_01, 'linked_req', 'REQ-PLAT-404'), /linked_req 'REQ-PLAT-404' is not an existing REQ/],
    ['a linked_req with another number', files => setField(files, TC_009_01, 'linked_req', 'REQ-PLAT-008'), /tc_id and linked_req REQ-PLAT-008 carry different numbers; they must agree/],
    ['a verifies id that does not exist', files => setField(files, TC_009_01, 'verifies', '[AC-PLAT-009-01, AC-PLAT-009-99]'), /verifies AC-PLAT-009-99 does not resolve to an existing acceptance criterion/],
    ['an empty verifies', files => setField(files, TC_009_01, 'verifies', '[]'), /verifies is empty; every TC verifies at least one acceptance criterion/],
    ['a verifies id without an expected-results entry', files => setField(files, TC_009_01, 'verifies', '[AC-PLAT-009-01, AC-PLAT-009-02, AC-PLAT-009-03]'), /verifies AC-PLAT-009-03 has no matching entry in Expected results/],
    ['an owner that is not an evaluator', files => setField(files, TC_009_01, 'owner', 'generator-001'), /owner 'generator-001' is not a registered evaluator/],
    ['an unregistered owner', files => setField(files, TC_009_01, 'owner', 'ghost-001'), /owner 'ghost-001' is not a registered evaluator/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('tc-frontmatter', edit)).toMatch(expected)
  })

  it('resolves verifies for every TC but applies the rest only to TCs of current-schema REQs', () => {
    const violations = lintWorkspace((files) => {
      setField(files, TC_008_12, 'owner', 'generator-001')
      setField(files, TC_008_12, 'verifies', '[AC-PLAT-008-16, AC-PLAT-008-99]')
    })
    expect(ofRule(violations, 'tc-frontmatter').map(violation => violation.message)).toEqual([
      'verifies AC-PLAT-008-99 does not resolve to an existing acceptance criterion',
    ])
  })

  it('skips the owner check without a registry', () => {
    expect(ofRule(lintWorkspace(files => setField(files, TC_009_01, 'owner', 'generator-001'), { registry: false }), 'tc-frontmatter')).toEqual([])
  })
})

describe('acceptance coverage', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['an uncovered acceptance criterion', files => setField(files, TC_009_01, 'verifies', '[AC-PLAT-009-02]'), /REQ-PLAT-009\.md: acceptance criterion AC-PLAT-009-01 is not referenced by any TC's verifies/],
    ['a malformed own TC', files => setField(files, TC_009_01, 'automated', '"yes"'), /acceptance criterion AC-PLAT-009-01 is not referenced by any TC's verifies/],
    ['an orphan TC', files => setField(files, TC_009_01, 'linked_req', 'REQ-PLAT-404'), /acceptance criterion AC-PLAT-009-01 is not referenced by any TC's verifies/],
    ['a carried origin TC citing an id without an assertion', files => setField(files, TC_008_12, 'verifies', '[AC-PLAT-008-16, AC-PLAT-009-25, AC-PLAT-009-01]'), /carried BUG's origin TC TC-PLAT-008-12 lists AC-PLAT-009-01 in verifies but Expected results has no matching entry; it does not count as coverage/],
    ['a malformed carried origin TC citing this REQ', files => setField(files, TC_008_12, 'automated', '"yes"'), /TC-PLAT-008-12 has linked_req REQ-PLAT-008 and cites \[AC-PLAT-009-25\]; it is not eligible to cover them/],
    ['a foreign TC citing this REQ', (files) => {
      files[TC_008_13] = String(files[TC_008_12]).replace(/TC-PLAT-008-12/g, 'TC-PLAT-008-13').replace('verifies: [AC-PLAT-008-16, AC-PLAT-009-25]', 'verifies: [AC-PLAT-008-16, AC-PLAT-009-01]')
    }, /TC-PLAT-008-13 has linked_req REQ-PLAT-008 and cites \[AC-PLAT-009-01\]; it is not eligible to cover them/],
    ['a missing test_case_ref entry', (files) => { files[REQ_009] = String(files[REQ_009]).replace('TC-PLAT-009-01, ', '') }, /test_case_ref lacks TC-PLAT-009-01, whose linked_req names this REQ/],
    ['an extra test_case_ref entry', (files) => { files[REQ_009] = String(files[REQ_009]).replace('TC-PLAT-009-21]', 'TC-PLAT-009-21, TC-PLAT-009-99]') }, /test_case_ref lists TC-PLAT-009-99, which is neither an own TC nor a carried BUG's origin TC/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('ac-coverage', edit)).toMatch(expected)
  })

  it('ignores foreign TCs that cite nothing of the REQ', () => {
    expect(ofRule(lintWorkspace((files) => {
      files[TC_008_13] = String(files[TC_008_12]).replace(/TC-PLAT-008-12/g, 'TC-PLAT-008-13').replace('verifies: [AC-PLAT-008-16, AC-PLAT-009-25]', 'verifies: [AC-PLAT-008-16]')
    }), 'ac-coverage')).toEqual([])
  })

  it('requires no coverage before tc_design is left, for exempt REQs, or for waived optional REQs', () => {
    const uncovered = (files: Files): Files => setField(files, TC_009_01, 'verifies', '[AC-PLAT-009-02]')
    expect(ofRule(lintWorkspace((files) => {
      uncovered(files)
      setField(files, REQ_009, 'status', 'tc_design')
    }), 'ac-coverage')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      uncovered(files)
      setField(files, REQ_009, 'tc_policy', 'exempt')
      setField(files, REQ_009, 'exempt_reason', '"docs only"')
    }), 'ac-coverage')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      uncovered(files)
      setField(files, REQ_009, 'tc_policy', 'optional')
      editBody(files, RV_009, body => body.replace('Fixed items:', 'TC waiver reason: specification only\n\nFixed items:'))
    }), 'ac-coverage')).toEqual([])
  })
})

describe('TC body rules', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['headings out of order', files => editBody(files, TC_009_01, body => body.replace('## Steps', '## Steps!')), /H2 headings are not the four sections in order; expected \[Preconditions, Steps, Expected results, Implementation location\], got \[Preconditions, Steps!, Expected results, Implementation location\]/],
    ['a repeated heading', files => editBody(files, TC_009_01, body => body.replace('## Implementation location', '## Steps')), /H2 heading 'Steps' appears more than once/],
    ['an empty section', files => replaceSection(files, TC_009_01, 'Steps', '<!-- todo -->'), /Steps has a heading but no content; it must not be empty/],
    ['preconditions over budget', files => replaceSection(files, TC_009_01, 'Preconditions', 'p'.repeat(4100)), /Preconditions is 41\d\d characters, over the budget of 4000/],
    ['a body over budget', files => appendBody(files, TC_009_01, 'q'.repeat(10000)), /body is 1\d\d\d\d characters, over the budget of 10000/],
    ['an indented expected line before any entry', files => replaceSection(files, TC_009_01, 'Expected results', `  stray\n${EXPECTED}`), /indented line 'stray' in Expected results has no preceding top-level entry/],
    ['an expected line that is not an entry', files => replaceSection(files, TC_009_01, 'Expected results', `Text\n${EXPECTED}`), /'Text' in Expected results is not an entry starting with an id/],
    ['an expected entry outside verifies', files => replaceSection(files, TC_009_01, 'Expected results', `${EXPECTED}\n- AC-PLAT-009-03: extra`), /Expected results entry 'AC-PLAT-009-03' does not start with an id from verifies/],
    ['an expected entry without content', files => replaceSection(files, TC_009_01, 'Expected results', '- AC-PLAT-009-01:\n- AC-PLAT-009-02: fine'), /Expected results entry AC-PLAT-009-01 has nothing after its id/],
    ['an expected entry without a colon', files => replaceSection(files, TC_009_01, 'Expected results', '- AC-PLAT-009-01 no colon\n\n- AC-PLAT-009-02: fine'), /Expected results entry 'AC-PLAT-009-01 no colon' does not start with an id from verifies/],
    ['no expected entries', files => replaceSection(files, TC_009_01, 'Expected results', '  only indented'), /Expected results has no top-level entry/],
    ['a manual TC without the manual marker', files => replaceSection(files, TC_009_09, 'Implementation location', 'Runs by hand'), /automated is false; Implementation location must state 'Manual'/],
    ['a manual TC that is implemented', files => setField(files, TC_009_09, 'status', 'implemented'), /a manual TC's status cannot be implemented; it stops at reviewed/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('tc-body', edit)).toMatch(expected)
  })

  it('judges TCs of current-schema REQs and orphan TCs, not TCs of legacy REQs', () => {
    expect(ofRule(lintWorkspace(files => editBody(files, TC_008_12, body => body.replace('## Steps', '## Steps!'))), 'tc-body')).toEqual([])
    expect(messages('tc-body', (files) => {
      setField(files, TC_009_01, 'linked_req', 'REQ-PLAT-404')
      editBody(files, TC_009_01, body => body.replace('## Steps', '## Steps!'))
    })).toMatch(/H2 headings are not the four sections in order/)
  })
})

describe('TC status path', () => {
  it('names an own TC whose status the REQ state does not allow', () => {
    const found = messages('tc-status', files => setField(files, TC_009_01, 'status', 'reviewed'))
    expect(found).toMatch(/TC-PLAT-009-01\.md: status 'reviewed' is not in the set \[failing, implemented, passing\] allowed while/)
    expect(found).toMatch(/ allowed while REQ REQ-PLAT-009 is in 'done'$/m)
  })

  it('judges a blocked REQ by its restore target and says so', () => {
    expect(messages('tc-status', (files) => {
      blockReq009(files, 'req_impl', 'generator')
      setField(files, TC_009_01, 'status', 'draft')
    })).toMatch(/set \[failing, implemented, passing, reviewed\] allowed while REQ REQ-PLAT-009 is in 'req_impl' \(status blocked/)
  })

  it('skips malformed TCs and REQ states without a TC status set', () => {
    expect(ofRule(lintWorkspace((files) => {
      setField(files, TC_009_01, 'status', 'reviewed')
      setField(files, TC_009_01, 'automated', '"yes"')
    }), 'tc-status')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      setField(files, TC_009_01, 'status', 'reviewed')
      setField(files, REQ_009, 'status', 'shipped')
    }), 'tc-status')).toEqual([])
  })
})

describe('deferred verification', () => {
  const deferred = (files: Files, tcId: string): Files => editBody(files, RV_009, body => body.replace('4. Manual TCs, item by item below.', `Deferred verification: ${tcId}\n4. Manual TCs, item by item below.`))

  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['an implemented TC that is not integration', files => setField(files, TC_009_01, 'status', 'implemented'), /REQ REQ-PLAT-009 is in done; a TC with status implemented must be integration/],
    ['an implemented TC missing from the deferred list', (files) => {
      setField(files, TC_009_01, 'status', 'implemented')
      setField(files, TC_009_01, 'level', 'integration')
    }, /TC-PLAT-009-01\.md: is not listed in the RV req_impl_review Evidence deferred-verification entry$/m],
    ['a failing TC under a pr_draft REQ', (files) => {
      setField(files, REQ_009, 'status', 'pr_draft')
      setField(files, TC_009_01, 'status', 'failing')
    }, /a pr_draft REQ may not have a failing TC/],
    ['a failing TC without an open regression BUG', files => setField(files, TC_009_01, 'status', 'failing'), /a failing TC of a done REQ must be listed in the test_case_ref of an open regression BUG/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('deferred-verification', edit)).toMatch(expected)
  })

  it('accepts a listed deferred TC and a failing TC held by an open regression BUG, and judges nothing before pr_draft', () => {
    expect(ofRule(lintWorkspace((files) => {
      setField(files, TC_009_01, 'status', 'implemented')
      setField(files, TC_009_01, 'level', 'integration')
      deferred(files, 'TC-PLAT-009-01')
    }), 'deferred-verification')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      setField(files, TC_009_01, 'status', 'failing')
      setField(files, BUG_003, 'status', 'open')
      setField(files, BUG_003, 'found_in', 'regression')
      setField(files, BUG_003, 'test_case_ref', '[TC-PLAT-009-16, TC-PLAT-009-01]')
    }), 'deferred-verification')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      setField(files, REQ_009, 'status', 'req_impl')
      setField(files, TC_009_01, 'status', 'failing')
    }), 'deferred-verification')).toEqual([])
  })
})
