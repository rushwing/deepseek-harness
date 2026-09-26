import { describe, expect, it } from 'vitest'
import {
  BUG_003,
  BUG_004,
  BUG_005,
  REQ_009,
  REQ_010,
  RV_009,
  TC_009_16,
  dropField,
  editBody,
  lintWorkspace,
  messages,
  ofRule,
  removeFile,
  setField,
  type Files,
} from './lint-helper.ts'

const RV_010 = 'lifecycle/tasks/reviews/platform/RV-PLAT-010.md'

const exempt = (files: Files): Files => {
  setField(files, REQ_009, 'tc_policy', 'exempt')
  return setField(files, REQ_009, 'exempt_reason', '"docs only"')
}
const waived = (files: Files, reason = ' specification only'): Files => {
  setField(files, REQ_009, 'tc_policy', 'optional')
  return editBody(files, RV_009, body => body.replace('Fixed items:', `TC waiver reason:${reason}\n\nFixed items:`))
}
const exemptTarget = (files: Files): Files => {
  setField(files, REQ_010, 'tc_policy', 'exempt')
  return setField(files, REQ_010, 'exempt_reason', '"docs only"')
}

describe('tc_policy exits', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['an exempt REQ off its reachable states', (files) => {
      exempt(files)
      setField(files, REQ_009, 'status', 'tc_design')
    }, /an exempt REQ may only stop in \[[^\]]*req_review[^\]]*\]; it is in 'tc_design'/],
    ['an exempt REQ without pr_number from pr_draft', (files) => {
      exempt(files)
      setField(files, REQ_009, 'pr_number', 'null')
    }, /an exempt REQ needs pr_number from pr_draft on/],
    ['an exempt REQ carrying BUGs', exempt, /an exempt REQ carries no BUG; BUG-PLAT-003's linked_req names it/],
    ['an exempt REQ with own TCs', exempt, /an exempt REQ has no TC; \[TC-PLAT-009-01, TC-PLAT-009-02/],
    ['an exempt REQ with test_case_ref', exempt, /an exempt REQ's test_case_ref must be empty; it is \[TC-PLAT-009-01,/],
    ['a REQ past req_impl_review without pr_number', files => setField(files, REQ_009, 'pr_number', 'null'), /pr_number must be set from req_impl_review on/],
    ['a waiver line without a reason', files => waived(files, ''), /the RV 'TC waiver reason:' line has nothing after the colon; the reason must have substance/],
    ['a waived REQ off its reachable states', (files) => {
      waived(files)
      setField(files, REQ_009, 'status', 'tc_design')
    }, /an optional REQ without TCs may only stop in \[[^\]]*req_impl[^\]]*\]; it is in 'tc_design'/],
    ['a waived REQ carrying BUGs', waived, /an optional REQ carrying BUG-PLAT-003 must take T03; the RV may not carry a 'TC waiver reason:' line/],
    ['a waived REQ with own TCs', waived, /the RV declares 'TC waiver reason:' yet TCs \[TC-PLAT-009-01,/],
    ['a waived REQ with test_case_ref', waived, /the RV declares 'TC waiver reason:' yet test_case_ref is \[TC-PLAT-009-01,/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('tc-policy', edit)).toMatch(expected)
  })

  it('accepts an unwaived optional REQ and a waived REQ without BUGs or TCs', () => {
    expect(ofRule(lintWorkspace(files => setField(files, REQ_009, 'tc_policy', 'optional')), 'tc-policy')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      setField(files, REQ_010, 'tc_policy', 'optional')
      files[RV_010] = [
        '---', 'rv_id: RV-PLAT-010', 'tool: platform', 'linked_req: REQ-PLAT-010', '---', '', '## req_review', '',
        'Conclusion: PASS (round 1, 2026-09-13, evaluator-002)', '', 'TC waiver reason: documentation only', '',
        'Review scope: all', '', 'Evidence: 1 file', '', 'Findings: None', '', 'Pending human-001: None', '',
      ].join('\n')
    }), 'tc-policy')).toEqual([])
  })
})

describe('BUG binding', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['an open blocking BUG missing from pending_bugs', (files) => {
      setField(files, BUG_003, 'status', 'open')
      setField(files, BUG_003, 'blocks_req', '[REQ-PLAT-009]')
    }, /BUG-PLAT-003 blocks this REQ with status 'open' but is not listed in pending_bugs/],
    ['a carried BUG closed while the REQ is in req_review', (files) => {
      setField(files, REQ_009, 'status', 'req_review')
      setField(files, REQ_009, 'owner', 'planner-001')
    }, /REQ is in req_review; carried BUG-PLAT-003 may not be closed \(verification happens at T13\)/],
    ['a carried BUG still open in req_impl_review', (files) => {
      setField(files, REQ_009, 'status', 'req_impl_review')
      setField(files, BUG_003, 'status', 'open')
    }, /REQ is in req_impl_review; carried BUG-PLAT-003 should be resolved or closed, it is 'open'/],
    ['a carried BUG not closed at pr_draft', (files) => {
      setField(files, REQ_009, 'status', 'pr_draft')
      setField(files, BUG_003, 'status', 'resolved')
    }, /REQ is in pr_draft; carried BUG-PLAT-003 must be closed, it is 'resolved'/],
    ['a carried BUG no acceptance criterion names', files => editBody(files, REQ_009, body => body.replace('- **AC-PLAT-009-24** BUG-PLAT-003:', '- **AC-PLAT-009-24** The synthetic tree:')), /REQ has left req_review, yet no acceptance criterion names carried BUG-PLAT-003/],
    ['a carried BUG without test_case_ref after tc_design', files => setField(files, BUG_003, 'test_case_ref', '[]'), /REQ has left tc_design, yet carried BUG-PLAT-003 has an empty test_case_ref/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('bug-binding', edit)).toMatch(expected)
  })

  it('tolerates a self-carried resolved BUG outside pending_bugs while restoring to req_review', () => {
    const found = messages('bug-binding', (files) => {
      setField(files, REQ_009, 'status', 'blocked')
      setField(files, REQ_009, 'pending_bugs', '[BUG-PLAT-004]')
      setField(files, REQ_009, 'blocked_reason', 'waiting')
      setField(files, REQ_009, 'blocked_from_status', 'req_review')
      setField(files, REQ_009, 'blocked_from_owner', 'planner')
      setField(files, BUG_004, 'status', 'open')
      setField(files, BUG_004, 'blocks_req', '[REQ-PLAT-009]')
      setField(files, BUG_003, 'status', 'resolved')
      setField(files, BUG_003, 'blocks_req', '[REQ-PLAT-009]')
    })
    expect(found).not.toContain('BUG-PLAT-003 blocks this REQ')
    expect(found).toMatch(/carried BUG-PLAT-005 may not be closed/)
  })
})

describe('BUG frontmatter', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a missing reference field', files => dropField(files, BUG_003, 'found_in'), /missing frontmatter field 'found_in'/],
    ['a list linked_req', files => setField(files, BUG_003, 'linked_req', '[REQ-PLAT-009]'), /linked_req must be a scalar REQ id; it is \["REQ-PLAT-009"\]/],
    ['an illegal severity', files => setField(files, BUG_003, 'severity', 'blocker'), /severity 'blocker' is illegal; legal values \[critical, high, low, medium\]/],
    ['an illegal bug_type', files => setField(files, BUG_003, 'bug_type', 'doc_bug'), /bug_type 'doc_bug' is illegal; legal values \[impl_bug, req_bug, tc_bug\]/],
    ['an illegal found_in', files => setField(files, BUG_003, 'found_in', 'nowhere'), /found_in 'nowhere' is illegal; legal values \[[^\]]*regression[^\]]*\]/],
    ['a malformed reference', files => setField(files, BUG_003, 'blocks_req', '[REQ-9]'), /blocks_req item REQ-9 does not match the REQ id format/],
    ['an unresolvable TC reference', files => setField(files, BUG_003, 'test_case_ref', '[TC-PLAT-009-99]'), /test_case_ref item TC-PLAT-009-99 does not resolve to an existing artifact/],
    ['an unresolvable origin_req', files => setField(files, BUG_003, 'origin_req', 'REQ-PLAT-404'), /origin_req item REQ-PLAT-404 does not resolve to an existing artifact/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('bug-frontmatter', edit)).toMatch(expected)
  })

  it('judges BUGs bound to current-schema or unresolvable REQs, not BUGs bound only to legacy REQs', () => {
    expect(ofRule(lintWorkspace((files) => {
      setField(files, BUG_003, 'linked_req', 'REQ-PLAT-008')
      dropField(files, BUG_003, 'found_in')
    }), 'bug-frontmatter')).toEqual([])
    expect(messages('bug-frontmatter', (files) => {
      setField(files, BUG_003, 'linked_req', 'REQ-PLAT-404')
      dropField(files, BUG_003, 'found_in')
    })).toMatch(/missing frontmatter field 'found_in'/)
  })
})

describe('BUG closure', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a req_bug of a done legacy REQ still open', (files) => {
      setField(files, BUG_003, 'linked_req', 'REQ-PLAT-008')
      setField(files, BUG_003, 'status', 'open')
    }, /linked_req names the done legacy REQ REQ-PLAT-008; a req_bug's status must be resolved or closed, it is 'open'/],
    ['a high BUG resolved without TCs', (files) => {
      setField(files, BUG_003, 'severity', 'high')
      setField(files, BUG_003, 'status', 'resolved')
      setField(files, BUG_003, 'test_case_ref', '[]')
    }, /a 'high' BUG in resolved needs a non-empty test_case_ref \(sole exception: a req_bug blocking only exempt REQs/],
    ['a critical tc_bug closed without TCs', (files) => {
      setField(files, BUG_004, 'severity', 'critical')
      setField(files, BUG_004, 'test_case_ref', '[]')
    }, /BUG-PLAT-004\.md: a 'critical' BUG in closed needs a non-empty test_case_ref/],
    ['a high req_bug blocking a required REQ without TCs', (files) => {
      setField(files, BUG_003, 'severity', 'high')
      setField(files, BUG_003, 'test_case_ref', '[]')
      setField(files, BUG_003, 'linked_req', '""')
      setField(files, BUG_003, 'blocks_req', '[REQ-PLAT-010]')
    }, /a 'high' BUG in closed needs a non-empty test_case_ref/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('bug-closure', edit)).toMatch(expected)
  })

  it('allows the exempt-REQ exception and keeps a BUG with TCs out of it', () => {
    expect(ofRule(lintWorkspace((files) => {
      exemptTarget(files)
      setField(files, BUG_003, 'severity', 'high')
      setField(files, BUG_003, 'test_case_ref', '[]')
      setField(files, BUG_003, 'linked_req', '""')
      setField(files, BUG_003, 'blocks_req', '[REQ-PLAT-010]')
    }), 'bug-closure')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      setField(files, BUG_003, 'severity', 'high')
    }), 'bug-closure')).toEqual([])
  })
})

describe('closed BUG consistency', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a closed BUG whose TC is not passing', files => setField(files, TC_009_16, 'status', 'failing'), /BUG-PLAT-003\.md: is closed, but listed TC-PLAT-009-16 has status 'failing' \(expected passing\)/],
    ['a closed BUG whose TCs verify no criterion naming it', files => setField(files, TC_009_16, 'verifies', '[AC-PLAT-009-23]'), /is closed, but no listed TC's verifies contains an acceptance criterion naming it \[AC-PLAT-009-24\]/],
    ['a closed BUG no criterion names', files => editBody(files, REQ_009, body => body.replace('- **AC-PLAT-009-24** BUG-PLAT-003:', '- **AC-PLAT-009-24** The synthetic tree:')), /is closed, but no acceptance criterion names it; the loop is not closed/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('bug-closed', edit)).toMatch(expected)
  })

  it('excuses a TC held failing by an open regression BUG and skips unknown TCs', () => {
    const found = messages('bug-closed', (files) => {
      setField(files, TC_009_16, 'status', 'failing')
      setField(files, BUG_005, 'status', 'open')
      setField(files, BUG_005, 'found_in', 'regression')
      setField(files, BUG_005, 'test_case_ref', '[TC-PLAT-009-17, TC-PLAT-009-16]')
      setField(files, BUG_004, 'test_case_ref', '[TC-PLAT-008-12, TC-PLAT-009-99]')
    })
    expect(found).not.toContain('TC-PLAT-009-16 has status')
    expect(found).not.toContain('TC-PLAT-009-99')
  })

  it('skips the loop check for legacy-only BUGs, the exempt exception, and a tree without REQs', () => {
    expect(ofRule(lintWorkspace((files) => {
      setField(files, BUG_003, 'linked_req', 'REQ-PLAT-008')
      setField(files, BUG_003, 'test_case_ref', '[]')
    }), 'bug-closed')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      exemptTarget(files)
      setField(files, BUG_003, 'test_case_ref', '[]')
      setField(files, BUG_003, 'linked_req', '""')
      setField(files, BUG_003, 'blocks_req', '[REQ-PLAT-010]')
    }), 'bug-closed')).toEqual([])
    expect(ofRule(lintWorkspace((files) => {
      for (const path of Object.keys(files)) if (/\/REQ-[A-Z]+-\d{3}\.md$/.test(path)) removeFile(files, path)
    }), 'bug-closed')).toEqual([])
  })
})
