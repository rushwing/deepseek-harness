import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_VOCABULARY, parseRegression, parseReview, parseReviewSection } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

const V = DEFAULT_REVIEW_VOCABULARY

describe('parseReviewSection', () => {
  const raw = [
    '## req_review',
    '',
    'Conclusion: PASS (round 8, 2026-09-13, evaluator-002)',
    '',
    'Fixed items:',
    '- [x] CHK01 no implementation detail',
    '- [ ] CHK02 one sentence',
    'Review scope: `a..b` with two files',
    'continued scope line',
    'Evidence:',
    '1. Delta of 1 commit',
    '- Deferred verification: TC-PLAT-009-03; TC-PLAT-009-04',
    '  indented note with TC-PLAT-009-99',
    'Awaiting sample: TC-PLAT-009-05',
    'TC waiver reason: pure specification change',
    'Findings: None',
    'Pending human-001: None <!-- nothing -->',
    '',
  ].join('\n')

  it('reads the conclusion, fixed fields in order, checklist items, top lines, and deferred TCs', () => {
    const section = parseReviewSection('req_review', raw, V)
    expect(section.name).toBe('req_review')
    expect(section.firstItem).toBe('Conclusion: PASS (round 8, 2026-09-13, evaluator-002)')
    expect(section.conclusions).toEqual(['Conclusion: PASS (round 8, 2026-09-13, evaluator-002)'])
    expect(section.verdict).toBe('PASS')
    expect(section.round).toBe(8)
    expect(section.signedDate).toBe('2026-09-13')
    expect(section.uid).toBe('evaluator-002')
    expect(section.conclusionOk).toBe(true)
    expect(section.fieldOrder).toEqual(['Review scope', 'Evidence', 'Findings', 'Pending human-001'])
    expect(section.fields['Review scope']).toBe('`a..b` with two files\ncontinued scope line')
    expect(section.fields.Findings).toBe('None')
    expect(section.fields['Pending human-001']).toBe('None')
    expect(section.checks).toEqual([['x', 'CHK01'], [' ', 'CHK02']])
    expect(section.topLines).toContain('Fixed items:')
    expect(section.topLines).not.toContain('indented note with TC-PLAT-009-99')
    expect([...section.deferredTcs].sort()).toEqual(['TC-PLAT-009-03', 'TC-PLAT-009-04'])
    expect(section.exemptionDeclared).toBe(true)
    expect(section.exemptionReason).toBe('pure specification change')
  })

  it('leaves the signature blank for a malformed, doubled, or impossible-date conclusion', () => {
    const doubled = parseReviewSection('tc_review', '## tc_review\nConclusion: PASS (round 1, 2026-09-13, generator-001)\nConclusion: REJECT (round 2, 2026-09-13, generator-001)\n', V)
    expect(doubled.conclusions).toHaveLength(2)
    expect(doubled.verdict).toBe('')
    expect(doubled.conclusionOk).toBe(false)
    const malformed = parseReviewSection('tc_review', '## tc_review\nConclusion: PASS (round one, 2026-09-13, generator-001)\n', V)
    expect(malformed.verdict).toBe('')
    expect(malformed.round).toBeUndefined()
    const badDate = parseReviewSection('tc_review', '## tc_review\nConclusion: PASS (round 1, 2026-02-31, generator-001)\n', V)
    expect(badDate.verdict).toBe('')
    const unrounded = parseReviewSection('req_impl_review', '## req_impl_review\nConclusion: AWAITING SAMPLE (2026-09-13, evaluator-002)\n', V)
    expect(unrounded.verdict).toBe('AWAITING SAMPLE')
    expect(unrounded.round).toBeUndefined()
    expect(unrounded.conclusionOk).toBe(true)
    expect(parseReviewSection('tc_review', '## tc_review\n\n', V)).toMatchObject({ firstItem: '', conclusions: [], fieldOrder: [], topLines: [] })
    const late = parseReviewSection('tc_review', '## tc_review\nReview scope: first\nConclusion: PASS (round 1, 2026-09-13, generator-001)\n', V)
    expect(late.verdict).toBe('PASS')
    expect(late.conclusionOk).toBe(false)
    expect(late.exemptionDeclared).toBe(false)
    expect(late.exemptionReason).toBe('')
    expect(late.deferredTcs.size).toBe(0)
  })
})

describe('parseRegression', () => {
  it('splits each visible line into five segments and keeps malformed lines', () => {
    const lines = parseRegression('## regression\n2026-09-13 | evaluator-002 | sample-7 | TC-PLAT-008-12 | passed\n\nbroken line\n<!-- hidden -->\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      raw: '2026-09-13 | evaluator-002 | sample-7 | TC-PLAT-008-12 | passed',
      segments: ['2026-09-13', 'evaluator-002', 'sample-7', 'TC-PLAT-008-12', 'passed'],
      wellFormed: true,
      when: '2026-09-13',
      uid: 'evaluator-002',
      sample: 'sample-7',
      tc: 'TC-PLAT-008-12',
      result: 'passed',
    })
    expect(lines[1]).toMatchObject({ raw: 'broken line', wellFormed: false, when: 'broken line', uid: '', result: '' })
    expect(parseRegression('')).toEqual([])
  })
})

describe('parseReview', () => {
  it('parses every section except regression and exposes the req_review waiver facts', () => {
    const body = [
      '## req_review', 'Conclusion: PASS (round 1, 2026-09-13, evaluator-002)', 'TC waiver reason: docs only', '',
      '## regression', '2026-09-13 | evaluator-002 | s | TC-PLAT-009-01 | failed', '',
      '## external_review', 'Conclusion: PASS (2026-09-13, human-001)', '',
    ].join('\n')
    const review = parseReview(body, V)
    expect(Object.keys(review.sections)).toEqual(['req_review', 'external_review'])
    expect(review.regression.map(line => line.result)).toEqual(['failed'])
    expect(review.gate('req_review')?.verdict).toBe('PASS')
    expect(review.gate('tc_review')).toBeUndefined()
    expect(review.exemptionReason).toBe('docs only')
    expect(review.exemptionDeclared).toBe(true)
    const empty = parseReview('', V)
    expect(empty.exemptionReason).toBe('')
    expect(empty.exemptionDeclared).toBe(false)
  })
})
