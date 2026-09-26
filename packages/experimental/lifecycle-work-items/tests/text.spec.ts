import { describe, expect, it } from 'vitest'
import {
  codePointLength,
  duplicateHeadings,
  maskedLines,
  sectionContent,
  sectionHeadings,
  sectionSlices,
  splitLines,
  visibleLines,
  visibleSectionContent,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

describe('splitLines', () => {
  it('splits on LF and drops the trailing empty piece like Python splitlines', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a')).toEqual(['a'])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\n\n')).toEqual(['a', ''])
  })
})

describe('visibleLines', () => {
  it('keeps prose, blanks fenced code including both fence lines, and blanks four-space indented code', () => {
    const text = ['prose', '```yaml', 'key: <!-- not a comment -->', '```', '    code line', '\tnot code', 'after'].join('\n')
    expect(visibleLines(text)).toEqual(['prose', '', '', '', '', '\tnot code', 'after'])
  })

  it('closes a fence only with a matching marker of at least the same length and no info string', () => {
    const text = ['~~~', '```', 'still fenced', '~~', '~~~~ info', '~~~~', 'free'].join('\n')
    expect(visibleLines(text)).toEqual(['', '', '', '', '', '', 'free'])
    expect(visibleLines('````\n```\n````\nout')).toEqual(['', '', '', 'out'])
  })

  it('does not open a backtick fence whose info string contains a backtick, and ignores fences indented four spaces', () => {
    expect(visibleLines('``` a`b\nvisible')).toEqual(['``` a`b', 'visible'])
    expect(visibleLines('   ```\nfenced\n```')).toEqual(['', '', ''])
    expect(visibleLines('    ```\nvisible')).toEqual(['', 'visible'])
    expect(visibleLines('```\n    ```\nstill fenced\n```\nout')).toEqual(['', '', '', '', 'out'])
  })

  it('removes HTML comments across lines and keeps the rest of each line in place', () => {
    const text = ['before <!-- hidden --> after', 'open <!-- starts', 'still hidden', 'ends --> shown', '<!-- never closed', 'gone'].join('\n')
    expect(visibleLines(text)).toEqual(['before  after', 'open ', '', ' shown', '', ''])
  })

  it('keeps inline code spans visible with their backticks and does not open comments inside them', () => {
    expect(visibleLines('use `a <!-- b -->` here')).toEqual(['use `a <!-- b -->` here'])
    expect(visibleLines('double `` `x` `` span')).toEqual(['double `` `x` `` span'])
    expect(visibleLines('a lone ` backtick <!-- c -->')).toEqual(['a lone ` backtick '])
  })

  it('lets a code span cross a soft line break inside one paragraph but not a blank line', () => {
    expect(visibleLines('starts `here <!-- x\nand ends` there <!-- y -->')).toEqual(['starts `here <!-- x', 'and ends` there '])
    expect(visibleLines('starts `here\n\nnext` para <!-- z -->')).toEqual(['starts `here', '', 'next` para '])
    expect(visibleLines('a `b\nc d\ne` f')).toEqual(['a `b', 'c d', 'e` f'])
  })

  it('treats a line that becomes indented code after comment removal as code and resets spans on blank lines', () => {
    expect(visibleLines('<!-- x -->    code')).toEqual([''])
    expect(visibleLines('`open\n\n    indented')).toEqual(['`open', '', ''])
  })

  it('does not open a fence while a comment is open', () => {
    expect(visibleLines('<!--\n```\nvisible? -->\nafter')).toEqual(['', '', '', 'after'])
  })
})

describe('sections', () => {
  const body = ['intro', '## Goal', 'g1', '', '## Behavior', '```', '## Not a heading', '```', '### Sub', 'b', '## Goal', 'again', '## Empty', '<!-- only a comment -->'].join('\n')

  it('slices H2 sections with their heading and trailing blanks, first duplicate winning', () => {
    expect(sectionHeadings(body)).toEqual(['Goal', 'Behavior', 'Goal', 'Empty'])
    expect(Object.keys(sectionSlices(body))).toEqual(['Goal', 'Behavior', 'Empty'])
    expect(sectionSlices(body).Goal).toBe('## Goal\ng1\n\n')
    expect(sectionContent(body, 'Goal')).toBe('g1')
    expect(sectionContent(body, 'Behavior')).toBe('```\n## Not a heading\n```\n### Sub\nb')
    expect(sectionContent(body, 'Missing')).toBe('')
    expect(visibleSectionContent(body, 'Empty')).toBe('')
    expect(visibleSectionContent(body, 'Behavior')).toBe('### Sub\nb')
    expect(duplicateHeadings(body)).toEqual(['Goal'])
    expect(maskedLines(body)).toEqual(new Set([5, 6, 7, 13]))
    expect(sectionSlices('')).toEqual({})
    expect(sectionSlices('## Tail')).toEqual({ Tail: '## Tail' })
  })
})

describe('codePointLength', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(codePointLength('a😀中')).toBe(3)
  })
})
