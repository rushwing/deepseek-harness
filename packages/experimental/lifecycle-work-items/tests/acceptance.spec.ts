import { describe, expect, it } from 'vitest'
import { parseAcceptance } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

const HEADING = 'Acceptance criteria'

describe('parseAcceptance', () => {
  it('collects top-level bullets with their continuation lines from the visible acceptance section', () => {
    const body = [
      '## Goal', 'x',
      `## ${HEADING}`,
      '- **AC-PLAT-009-01** first criterion',
      '  continues here',
      '',
      '  after a blank',
      '- **AC-PLAT-009-02** second <!-- hidden -->',
      'free text closes the item',
      '- **AC-PLAT-009-03** third',
      '```',
      '- **AC-PLAT-009-99** example inside a fence',
      '```',
      '## Pending decisions', 'None',
    ].join('\n')
    const items = parseAcceptance(body, HEADING)
    expect(items.map(item => item.number)).toEqual(['AC-PLAT-009-01', 'AC-PLAT-009-02', 'AC-PLAT-009-03'])
    expect(items[0]).toEqual({
      number: 'AC-PLAT-009-01',
      text: '- **AC-PLAT-009-01** first criterion\n  continues here\n\n  after a blank',
      prefix: 'PLAT',
      order: 1,
      bold: true,
      head: '**AC-PLAT-009-01** first criteri',
      wellFormed: true,
      label: 'AC-PLAT-009-01',
    })
    expect(items[1]?.text).toBe('- **AC-PLAT-009-02** second ')
    expect(items[2]?.text).toBe('- **AC-PLAT-009-03** third')
  })

  it('keeps malformed bullets so the rules can name them', () => {
    const body = [
      `## ${HEADING}`,
      '- **AC-PLAT-009-01**no space after the bold',
      '* AC-PLAT-009-02 not bold',
      '+ **Criterion** bold but not an AC',
      '-',
      '- plain bullet',
    ].join('\n')
    const items = parseAcceptance(body, HEADING)
    expect(items.map(item => [item.number, item.bold, item.wellFormed, item.label])).toEqual([
      ['AC-PLAT-009-01', false, false, 'AC-PLAT-009-01'],
      ['AC-PLAT-009-02', false, false, 'AC-PLAT-009-02'],
      ['Criterion', false, false, 'Criterion'],
      ['', false, false, '(empty bullet)'],
      ['', false, false, 'plain bullet'],
    ])
    expect(items[0]?.prefix).toBe('PLAT')
    expect(items[2]?.prefix).toBe('')
    expect(items[2]?.order).toBe(0)
  })

  it('returns nothing without the section', () => {
    expect(parseAcceptance('## Goal\nx', HEADING)).toEqual([])
    expect(parseAcceptance(`## ${HEADING}\n`, HEADING)).toEqual([])
  })
})
