import { describe, expect, it } from 'vitest'
import {
  BUG_003,
  REQ_009,
  REQ_010,
  RV_009,
  TC_008_12,
  TC_009_01,
  appendBody,
  editBody,
  lintWorkspace,
  messages,
  ofRule,
  removeFile,
  replaceSection,
  setField,
  type Files,
} from './lint-helper.ts'

const TC_008_13 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-008-13.md'
const TC_REVIEW_CONCLUSION = 'Conclusion: PASS (round 2, 2026-09-13, generator-001)'
const REQ_REVIEW_CONCLUSION = 'Conclusion: PASS (round 8, 2026-09-13, evaluator-002)'
const REQ_IMPL_CONCLUSION = 'Conclusion: PASS (round 3, 2026-09-13, evaluator-002)'
const CHK03 = /- \[x\] CHK03 [^\n]*\n/

const rv = (files: Files, edit: (body: string) => string): Files => editBody(files, RV_009, edit)
const regression = (files: Files, ...lines: string[]): Files => appendBody(files, RV_009, `\n## regression\n\n${lines.join('\n')}\n`)
const waived = (files: Files): Files => {
  setField(files, REQ_009, 'tc_policy', 'optional')
  return rv(files, body => body.replace('Fixed items:', 'TC waiver reason: specification only\n\nFixed items:'))
}

describe('RV structure', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a missing RV for a reviewed REQ', files => removeFile(files, RV_009), /^lifecycle\/tasks\/reviews\/platform\/RV-PLAT-009\.md: REQ REQ-PLAT-009 has review rounds or has left req_review; the same-numbered RV is missing$/m],
    ['a missing RV for a REQ past req_review', (files) => {
      setField(files, REQ_010, 'status', 'tc_design')
      setField(files, REQ_010, 'owner', 'evaluator-001')
    }, /RV-PLAT-010\.md: REQ REQ-PLAT-010 has review rounds or has left req_review; the same-numbered RV is missing/],
    ['a missing RV with a review round', files => setField(files, REQ_010, 'review_round', '1'), /RV-PLAT-010\.md: REQ REQ-PLAT-010 has review rounds/],
    ['an rv_id unlike the file name', files => setField(files, RV_009, 'rv_id', 'RV-PLAT-090'), /rv_id 'RV-PLAT-090' does not match the file name/],
    ['a tool unlike the directory', files => setField(files, RV_009, 'tool', 'canonical-bom'), /tool 'canonical-bom' does not match the directory 'platform'/],
    ['a linked_req unlike the REQ', files => setField(files, RV_009, 'linked_req', 'REQ-PLAT-008'), /linked_req 'REQ-PLAT-008' is not the same-numbered REQ/],
    ['an RV outside the REQ scope', files => setField(files, REQ_009, 'tool', 'canonical-bom'), /RV sits in directory 'platform'; it must match REQ REQ-PLAT-009's scope 'canonical-bom'/],
    ['an unknown section', files => appendBody(files, RV_009, '\n## notes\n\ntext\n'), /contains H2 heading 'notes' outside the allowed review sections/],
    ['a repeated section', files => rv(files, body => body.replace('## tc_review', '## req_review')), /section 'req_review' appears more than once; a section shows only the latest round/],
    ['a section not opening with its conclusion', files => rv(files, body => body.replace(`## tc_review\n\n${TC_REVIEW_CONCLUSION}`, `## tc_review\n\nPreface\n\n${TC_REVIEW_CONCLUSION}`)), /section 'tc_review' does not open with a Conclusion: line; its first item is 'Preface'/],
    ['two conclusion lines', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, `${TC_REVIEW_CONCLUSION}\nConclusion: REJECT (round 2, 2026-09-13, generator-001)`)), /section 'tc_review' has 2 conclusion lines; exactly one/],
    ['a malformed conclusion line', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: PASS on 2026-09-13')), /section 'tc_review' conclusion line is malformed; it should be 'Conclusion: PASS \| REJECT \(round N, YYYY-MM-DD, UID\)'/],
    ['a missing fixed field', files => rv(files, body => body.replace('Findings:\n\n| # | Location', 'Notes:\n\n| # | Location')), /section 'tc_review' lacks fixed field 'Findings'/],
    ['fixed fields out of order', files => rv(files, body => body.replace('Findings: None\n\nPending human-001: None', 'Pending human-001: None\n\nFindings: None')), /section 'req_review' fixed fields are out of order; got \[Review scope, Evidence, Pending human-001, Findings\], expected \[Review scope, Evidence, Findings, Pending human-001\]/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('rv-structure', edit)).toMatch(expected)
  })
})

describe('RV signatures', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a conclusion signed by the wrong role', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: PASS (round 2, 2026-09-13, evaluator-001)')), /section 'tc_review' conclusion is signed by 'evaluator-001'; a registered generator must sign/],
    ['a conclusion signed by an unregistered uid', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: PASS (round 2, 2026-09-13, generator-009)')), /section 'tc_review' conclusion is signed by 'generator-009'; a registered generator must sign/],
    ['a req_review conclusion without a round', files => rv(files, body => body.replace(REQ_REVIEW_CONCLUSION, 'Conclusion: PASS (2026-09-13, evaluator-002)')), /section 'req_review' conclusion line must state the round/],
    ['a req_review round unlike review_round', files => setField(files, REQ_009, 'review_round', '7'), /section 'req_review' round 8 does not equal the REQ review_round 7/],
    ['a conclusion with trailing text', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, `${TC_REVIEW_CONCLUSION} ok`)), /section 'tc_review' conclusion line 'Conclusion: PASS \(round 2, 2026-09-13, generator-001\) ok' is malformed; it should be 'Conclusion: PASS \| REJECT \(round N, YYYY-MM-DD, UID\)' with no trailing text/],
    ['checklist items outside req_review', files => rv(files, body => body.replace('Review scope: `6f75e0d', '- [x] CHK01 misplaced\nReview scope: `6f75e0d')), /fixed items CHK01–CHK08 belong only in req_review; found in 'tc_review'/],
    ['a missing checklist item', files => rv(files, body => body.replace(CHK03, '')), /section 'req_review' lacks fixed items \[CHK03\]/],
    ['a repeated checklist item', files => rv(files, body => body.replace(CHK03, match => `${match}${match}`)), /section 'req_review' fixed items \[CHK03\] appear more than once/],
    ['an unexpected checklist item', files => rv(files, body => body.replace(CHK03, match => `${match}- [x] CHK09 extra\n`)), /section 'req_review' has unexpected fixed items \[CHK09\]/],
    ['an unchecked item under PASS', files => rv(files, body => body.replace('- [x] CHK03', '- [ ] CHK03')), /section 'req_review' concludes PASS but \[CHK03\] are unchecked/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('rv-signatures', edit)).toMatch(expected)
  })

  it('reports no malformed conclusion when a gate section has none at all', () => {
    const found = messages('rv-signatures', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'No verdict yet')))
    expect(found).not.toContain("section 'tc_review' conclusion line")
  })

  it('does not require checked items under a REJECT req_review', () => {
    const found = messages('rv-signatures', (files) => {
      rv(files, body => body.replace(REQ_REVIEW_CONCLUSION, 'Conclusion: REJECT (round 8, 2026-09-13, evaluator-002)').replace('- [x] CHK03', '- [ ] CHK03'))
    })
    expect(found).not.toContain('are unchecked')
  })

  it('skips signer checks without a registry and round checks without an integer review_round', () => {
    const wrongSigner = (files: Files): Files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: PASS (round 2, 2026-09-13, evaluator-001)'))
    expect(ofRule(lintWorkspace(wrongSigner, { registry: false }), 'rv-signatures')).toEqual([])
    expect(ofRule(lintWorkspace(files => setField(files, REQ_009, 'review_round', 'eight')), 'rv-signatures')).toEqual([])
  })
})

describe('RV gate pass', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a missing required section', files => rv(files, body => body.replace('## tc_review', '## tc_review_old')), /REQ-PLAT-009\.md: status 'done' requires RV section 'tc_review' to have PASSed; the section is missing/],
    ['a required section that is not PASS', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: REJECT (round 2, 2026-09-13, generator-001)')), /status 'done' requires section 'tc_review' PASS; it is REJECT/],
    ['a required section with a malformed conclusion', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: PASS on Tuesday')), /status 'done' requires section 'tc_review' PASS; it is \(no well-formed conclusion line\)/],
    ['a PASS section with an empty review scope', files => rv(files, body => body.replace(/Review scope: `6f75e0d[^\n]*/, 'Review scope:')), /section 'tc_review' concludes PASS but Review scope is empty after the colon/],
    ['a PASS section without an evidence field', files => rv(files, body => body.replace('Evidence:\n1. Item-by-item close-out: #1 (exempt', 'Proof:\n1. Item-by-item close-out: #1 (exempt')), /section 'tc_impl_review' concludes PASS but Evidence is empty after the colon/],
    ['a req_impl_review PASS evidence without a number', files => replaceSection(files, RV_009, 'req_impl_review', `${REQ_IMPL_CONCLUSION}\n\nReview scope: everything\n\nEvidence: all fine, nothing counted\n\nFindings: None\n\nPending human-001: None`), /section 'req_impl_review' PASS evidence must contain at least one entry with a number/],
    ['an optional REQ without TCs lacking the waiver line', (files) => {
      setField(files, REQ_009, 'tc_policy', 'optional')
      rv(files, body => body.replace(/\n## tc_impl_review\n[\s\S]*?(?=\n## )/, ''))
    }, /an optional REQ without TCs \(T03c\) needs a 'TC waiver reason:' line in the RV req_review section/],
    ['a waived REQ without per-criterion evidence', waived, /a REQ without TCs lacks req_impl_review Evidence entries for acceptance criteria \[AC-PLAT-009-01, AC-PLAT-009-02/],
    ['a passing manual TC without evidence', files => rv(files, body => body.replace('TC-PLAT-009-09: passed;', 'TC-PLAT-009-09: run;')), /manual TC TC-PLAT-009-09 is passing but the req_impl_review Evidence has no entry starting with its id that states the result and a key number/],
    ['a passing manual TC whose evidence says failed', files => rv(files, body => body.replace('TC-PLAT-009-09: passed;', 'TC-PLAT-009-09: failed, passed;')), /manual TC TC-PLAT-009-09 is passing but/],
    ['a passing manual TC whose evidence has no number', files => rv(files, body => body.replace(/TC-PLAT-009-09: passed;[^\n]*/, 'TC-PLAT-009-09: passed; all good on 2026-09-13.')), /manual TC TC-PLAT-009-09 is passing but/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('rv-gate-pass', edit)).toMatch(expected)
  })

  it('reads evidence from top-level lines only and asks manual evidence only of own and carried TCs', () => {
    const found = messages('rv-gate-pass', (files) => {
      rv(files, body => body.replace('TC-PLAT-009-09: passed;', '  TC-PLAT-009-09: passed;').replace('4. Manual TCs, item by item below.', '4. Manual TCs, item by item below.\n\n'))
      files[TC_008_13] = String(files[TC_008_12]).replace(/TC-PLAT-008-12/g, 'TC-PLAT-008-13').replace('automated: true', 'automated: false')
    })
    expect(found).toMatch(/manual TC TC-PLAT-009-09 is passing but/)
    expect(found).not.toContain('TC-PLAT-008-13')
  })

  it('requires per-criterion evidence only under a PASS req_impl_review', () => {
    const found = messages('rv-gate-pass', (files) => {
      waived(files)
      rv(files, body => body.replace(REQ_IMPL_CONCLUSION, 'Conclusion: REJECT (round 3, 2026-09-13, evaluator-002)'))
    })
    expect(found).not.toContain('lacks req_impl_review Evidence entries')
  })

  it('counts per-criterion evidence only when an entry starts with the whole id and says more than ids', () => {
    const found = messages('rv-gate-pass', (files) => {
      waived(files)
      replaceSection(files, REQ_009, 'Acceptance criteria', '- **AC-PLAT-009-01** one\n- **AC-PLAT-009-02** two')
      rv(files, body => body.replace('4. Manual TCs, item by item below.', 'AC-PLAT-009-01: verified by reading the diff\nAC-PLAT-009-02: AC-PLAT-009-02\nAC-PLAT-009-010: nope\n4. Manual TCs, item by item below.'))
    })
    expect(found).toMatch(/lacks req_impl_review Evidence entries for acceptance criteria \[AC-PLAT-009-02\]/)
    const complete = messages('rv-gate-pass', (files) => {
      waived(files)
      replaceSection(files, REQ_009, 'Acceptance criteria', '- **AC-PLAT-009-01** one\n- **AC-PLAT-009-02** two')
      rv(files, body => body.replace('4. Manual TCs, item by item below.', 'AC-PLAT-009-01: verified by reading the diff\nAC-PLAT-009-02: verified too\n4. Manual TCs, item by item below.'))
    })
    expect(complete).not.toContain('lacks req_impl_review Evidence entries')
  })
})

describe('RV budgets and regression lines', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['AWAITING SAMPLE outside req_impl_review', files => rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: AWAITING SAMPLE (round 2, 2026-09-13, generator-001)')), /'AWAITING SAMPLE' may conclude only req_impl_review; found in 'tc_review'/],
    ['AWAITING SAMPLE while the REQ moved on', files => rv(files, body => body.replace(REQ_IMPL_CONCLUSION, 'Conclusion: AWAITING SAMPLE (round 3, 2026-09-13, evaluator-002)')), /'AWAITING SAMPLE' requires the REQ to stay in req_impl_review; it is 'done'/],
    ['a section over budget', files => rv(files, body => body.replace('Findings: None\n\nPending human-001: None\n\n## req_impl_review', `Findings: ${'f'.repeat(6000)}\n\nPending human-001: None\n\n## req_impl_review`)), /section 'tc_impl_review' is \d+ characters, over the budget of 6000/],
    ['a regression section over budget', files => regression(files, ...Array.from({ length: 120 }, (_, index) => `2026-09-13 | evaluator-002 | sample-${String(index)} | TC-PLAT-009-01 | passed`)), /section 'regression' is \d+ characters, over the budget of 6000/],
    ['a body over budget', files => rv(files, body => body.replace('Findings: None\n\nPending human-001: None\n\n## req_impl_review', `Findings: ${'f'.repeat(30000)}\n\nPending human-001: None\n\n## req_impl_review`)), /body without the regression section is 3\d\d\d\d characters, over the budget of 30000/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('rv-budgets', edit)).toMatch(expected)
  })

  it('accepts AWAITING SAMPLE while the REQ stays in req_impl_review', () => {
    const found = messages('rv-budgets', (files) => {
      setField(files, REQ_009, 'status', 'req_impl_review')
      rv(files, body => body.replace(REQ_IMPL_CONCLUSION, 'Conclusion: AWAITING SAMPLE (round 3, 2026-09-13, evaluator-002)'))
    })
    expect(found).not.toContain('AWAITING SAMPLE')
  })

  it.each<[string, string, RegExp]>([
    ['a line without five segments', '2026-09-13 | evaluator-002 | TC-PLAT-009-01 | passed', /regression line '2026-09-13 \| evaluator-002 \| TC-PLAT-009-01 \| passed' does not have five segments \(date \| UID \| sample \| TC \| result\)/],
    ['a bad date', '2026-13-01 | evaluator-002 | s1 | TC-PLAT-009-01 | passed', /regression line date '2026-13-01' is not a valid YYYY-MM-DD/],
    ['an illegal result', '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-01 | ok', /regression line result 'ok' is illegal; only passed, failed, or passed \(BUG-… open\)/],
    ['an unregistered uid', '2026-09-13 | evaluator-009 | s1 | TC-PLAT-009-01 | passed', /regression line UID 'evaluator-009' is not registered in agent-registry\.yml/],
    ['a non-evaluator uid', '2026-09-13 | generator-001 | s1 | TC-PLAT-009-01 | passed', /regression line TC-PLAT-009-01 UID 'generator-001' is not an evaluator; only evaluators run regressions/],
    ['an empty sample', '2026-09-13 | evaluator-002 |  | TC-PLAT-009-01 | passed', /regression line '2026-09-13 \| evaluator-002 \|  \| TC-PLAT-009-01 \| passed' has an empty sample segment/],
    ['an unknown TC', '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-99 | passed', /regression line TC-PLAT-009-99 does not resolve to an existing TC/],
    ['a result contradicting the TC status', '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-01 | failed', /regression line records failed, but TC-PLAT-009-01's status is 'passing' \(expected failing\)/],
    ['an open-bug result naming a missing BUG', '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-01 | passed (BUG-PLAT-404 open)', /regression line TC-PLAT-009-01 cites BUG-PLAT-404, which does not resolve to an existing BUG/],
    ['an open-bug result contradicted by the BUG', '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-01 | passed (BUG-PLAT-003 open)', /regression line TC-PLAT-009-01 records 'passed \(BUG-PLAT-003 open\)', but BUG-PLAT-003 is closed; has found_in 'req_impl_review', not regression; has a test_case_ref without TC-PLAT-009-01; leaves TC-PLAT-009-01 still passing/],
  ])('names %s', (_case, line, expected) => {
    expect(messages('rv-regression', files => regression(files, line))).toMatch(expected)
  })

  it('names a TC listed twice and accepts consistent lines', () => {
    const line = '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-01 | passed'
    expect(messages('rv-regression', files => regression(files, line, line))).toMatch(/TC-PLAT-009-01 appears 2 times in the regression section; keep only the latest run per TC/)
    expect(ofRule(lintWorkspace(files => regression(files, line)), 'rv-regression')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      regression(files, '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-01 | passed (BUG-PLAT-003 open)')
      setField(files, BUG_003, 'status', 'open')
      setField(files, BUG_003, 'found_in', 'regression')
      setField(files, BUG_003, 'test_case_ref', '[TC-PLAT-009-16, TC-PLAT-009-01]')
      setField(files, TC_009_01, 'status', 'failing')
    }), 'rv-regression')).toEqual([])
  })

  it('skips the uid role check without a registry and the TC checks in a tree without TCs', () => {
    expect(ofRule(lintWorkspace(files => regression(files, '2026-09-13 | generator-001 | s1 | TC-PLAT-009-01 | passed'), { registry: false }), 'rv-regression')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      regression(files, '2026-09-13 | evaluator-002 | s1 | TC-PLAT-009-99 | passed')
      for (const path of Object.keys(files)) if (/\/TC-[A-Z]+-\d{3}-\d{2}\.md$/.test(path)) removeFile(files, path)
    }), 'rv-regression')).toEqual([])
  })

  it('does not judge the RV of a superseded REQ', () => {
    const violations = lintWorkspace((files) => {
      files['lifecycle/tasks/archive/superseded/REQ-PLAT-009.md'] = String(files[REQ_009]).replace('pr_number: 26', 'pr_number: 26\nsuperseded_by: REQ-PLAT-010')
      removeFile(files, REQ_009)
      rv(files, body => body.replace(TC_REVIEW_CONCLUSION, 'Conclusion: AWAITING SAMPLE (round 2, 2026-09-13, generator-001)'))
    })
    expect(ofRule(violations, 'rv-budgets')).toEqual([])
  })
})

describe('external review', () => {
  const HEADER = '| # | Location | Finding | severity | confidence | Disposition |\n|---|---|---|---|---|---|'
  const external = (files: Files, signer: string, table: string): Files => appendBody(files, RV_009, `\n## external_review\n\nConclusion: PASS (2026-09-13, ${signer})\n\nReview scope: all\n\nEvidence: read\n\nFindings:\n\n${table}\n\nPending human-001: None\n`)

  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a findings table without rows', files => external(files, 'human-001', HEADER), /section 'external_review' declares a findings table but no finding row parses/],
    ['a row with the wrong column count', files => external(files, 'human-001', `${HEADER}\n| 1 | here | thing | nit | high |`), /section 'external_review' row 2 has 5 columns; the findings table has exactly 6/],
    ['a row without a disposition', files => external(files, 'human-001', `${HEADER}\n| 1 | here | thing | nit | high | \`\` |`), /section 'external_review' row 2 has an empty Disposition/],
    ['a conclusion signed by a generator', files => external(files, 'generator-001', `${HEADER}\n| 1 | here | thing | nit | high | fixed |`), /section 'external_review' conclusion is signed by 'generator-001'; only \[evaluator, human\] roles may sign/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('rv-external-review', edit)).toMatch(expected)
  })

  it('skips the signer check under a malformed conclusion and names an unregistered signer', () => {
    const table = `${HEADER}\n| 1 | here | thing | nit | high | fixed |`
    expect(ofRule(lintWorkspace(files => external(files, 'nobody', table)), 'rv-external-review')).toEqual([])
    expect(messages('rv-external-review', files => external(files, 'ghost-001', table))).toMatch(/conclusion is signed by 'ghost-001'/)
  })

  it('accepts a complete table signed by a human or an evaluator, and reads the role from the uid without a registry', () => {
    const table = `${HEADER}\n| 1 | here | thing | nit | high | fixed |`
    expect(ofRule(lintWorkspace(files => external(files, 'human-001', table)), 'rv-external-review')).toEqual([])
    expect(ofRule(lintWorkspace(files => external(files, 'evaluator-002', 'Findings: None')), 'rv-external-review')).toEqual([])
    expect(messages('rv-external-review', files => external(files, 'generator-001', table)).length > 0).toBe(true)
    expect(ofRule(lintWorkspace(files => external(files, 'generator-001', table), { registry: false }), 'rv-external-review').map(violation => violation.message))
      .toEqual(["section 'external_review' conclusion is signed by 'generator-001'; only [evaluator, human] roles may sign"])
  })
})
