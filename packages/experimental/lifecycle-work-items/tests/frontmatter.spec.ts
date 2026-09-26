import { describe, expect, it } from 'vitest'
import { asList, isIsoDate, positiveInt, scalar, splitFrontmatter } from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

describe('splitFrontmatter', () => {
  it('reads a YAML mapping between the first two --- lines and strips leading newlines from the body', () => {
    const split = splitFrontmatter('---\nreq_id: REQ-PLAT-001\nlist: [a, b]\nn: ~\n---\n\n\n# Title\nbody\n')
    expect(split).toEqual({ data: { req_id: 'REQ-PLAT-001', list: ['a', 'b'], n: null }, body: '# Title\nbody\n' })
  })

  it('keeps yes and dates as strings and refuses duplicate keys', () => {
    expect(splitFrontmatter('---\nflag: yes\nday: 2026-09-13\n---\n')).toEqual({ data: { flag: 'yes', day: '2026-09-13' }, body: '' })
    expect(splitFrontmatter('---\na: 1\na: 2\n---\n').problem).toMatch(/^frontmatter is not valid YAML \(Map keys must be unique/)
  })

  it('names a missing, malformed, or non-mapping frontmatter', () => {
    expect(splitFrontmatter('# no frontmatter\n')).toEqual({ problem: 'missing YAML frontmatter' })
    expect(splitFrontmatter('\n---\na: 1\n---\n')).toEqual({ problem: 'missing YAML frontmatter' })
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\n')).toEqual({ problem: 'missing YAML frontmatter' })
    expect(splitFrontmatter('---\n---\n')).toEqual({ problem: 'missing YAML frontmatter' })
    expect(splitFrontmatter('---\n\n---\nbody')).toEqual({ problem: 'frontmatter is not a mapping' })
    expect(splitFrontmatter('---\n- a\n---\n')).toEqual({ problem: 'frontmatter is not a mapping' })
    expect(splitFrontmatter('---\na: [\n---\n').problem).toMatch(/^frontmatter is not valid YAML \(/)
  })
})

describe('value helpers', () => {
  it('coerce YAML values the way the artifact rules expect', () => {
    expect(asList(undefined)).toEqual([])
    expect(asList(null)).toEqual([])
    expect(asList('')).toEqual([])
    expect(asList(['a', ' ', null, 3, 'b'])).toEqual(['a', '3', 'b'])
    expect(asList('single')).toEqual(['single'])
    expect(asList(7)).toEqual(['7'])
    expect(asList({ k: 1 })).toEqual(['{"k":1}'])
    expect(scalar(' text ')).toBe(' text ')
    expect(scalar('  ')).toBeUndefined()
    expect(scalar(['a'])).toBeUndefined()
    expect(scalar(3)).toBeUndefined()
    expect(isIsoDate('2026-09-13')).toBe(true)
    expect(isIsoDate('2026-02-31')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-9-13')).toBe(false)
    expect(isIsoDate('20260913')).toBe(false)
    expect(positiveInt(3)).toBe(true)
    expect(positiveInt(0)).toBe(false)
    expect(positiveInt(2.5)).toBe(false)
    expect(positiveInt('3')).toBe(false)
    expect(positiveInt(true)).toBe(false)
  })
})
