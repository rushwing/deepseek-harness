import { describe, expect, it } from 'vitest'
import { renderRun } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'

describe('renderRun', () => {
  it('renders the header, the steps with their reasons, the pending decision, and the violations', () => {
    expect(renderRun({
      reqId: 'REQ-PLAT-010',
      steps: [
        { uid: 'human-001', role: 'human', state: 'draft', transition: 'T01', outcome: 'applied', reason: null },
        { uid: 'planner-001', role: 'planner', state: 'req_review', transition: null, outcome: 'rejected', reason: 'no proposal' },
      ],
      stopped: 'needs-human',
      pendingHuman: { state: 'req_review', options: ['T18', 'T19'] },
      violations: ['a problem'],
    })).toBe([
      'Lifecycle run on REQ-PLAT-010 stopped: needs-human after 2 steps',
      '- human-001 @ draft: T01 applied',
      '- planner-001 @ req_review: no transition rejected (no proposal)',
      'Human decision needed at req_review; legal transitions T18, T19',
      '- a problem',
    ].join('\n'))
    expect(renderRun({ reqId: 'REQ-PLAT-009', steps: [], stopped: 'done', pendingHuman: null, violations: [] })).toBe('Lifecycle run on REQ-PLAT-009 stopped: done after 0 steps')
  })
})

describe('renderRun singular', () => {
  it('counts one step in the singular', () => {
    expect(renderRun({
      reqId: 'REQ-PLAT-010',
      steps: [{ uid: 'human-001', role: 'human', state: 'draft', transition: 'T01', outcome: 'applied', reason: null }],
      stopped: 'max-steps',
      pendingHuman: null,
      violations: [],
    })).toBe('Lifecycle run on REQ-PLAT-010 stopped: max-steps after 1 step\n- human-001 @ draft: T01 applied')
  })
})
