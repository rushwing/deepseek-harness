import { describe, expect, it } from 'vitest'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { PROPOSAL_SCHEMA, parseProposal } from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'

function textResult(text: string): SubagentResult {
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}

function fenced(value: unknown): SubagentResult {
  return textResult(`Done.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`)
}

describe('the transition proposal', () => {
  it('declares a structured-output schema with the summary required', () => {
    expect(PROPOSAL_SCHEMA.type).toBe('object')
  })

  it('reads structured output first, then the last fenced JSON block of the text', () => {
    const structured: SubagentResult = { ...fenced({ transition: 'T01', summary: 'from text' }), structured: { transition: 'T02', summary: 'from schema' } }
    expect(parseProposal(structured)).toEqual({ ok: true, proposal: { kind: 'step', transition: 'T02', event: undefined, summary: 'from schema', decisions: {}, pr: undefined } })
    const twoBlocks = textResult('```json\n{"transition":"T01","summary":"first"}\n```\nthen\n```json\n{"event":"bug_fix","summary":" last ","pr":7,"decisions":{"fields":{"a":1},"tcStatuses":{"TC-1":"passing","TC-2":3}}}\n```\n')
    expect(parseProposal(twoBlocks)).toEqual({
      ok: true,
      proposal: { kind: 'step', transition: undefined, event: 'bug_fix', summary: 'last', decisions: { fields: { a: 1 }, tcStatuses: { 'TC-1': 'passing' } }, pr: 7 },
    })
    const mixed: SubagentResult = { output: [{ type: 'thinking', thinking: 'hm' } as never, { type: 'text', text: '```json\n{"transition":"T03","summary":"ok","pr":null,"event":null}\n```' }], stopReason: 'completed' }
    expect(parseProposal(mixed)).toMatchObject({ ok: true, proposal: { transition: 'T03', pr: undefined } })
  })

  it('reads a needsHuman hand-over as a question', () => {
    expect(parseProposal(fenced({ needsHuman: true, question: ' Which AC applies? ' }))).toEqual({ ok: true, proposal: { kind: 'question', question: 'Which AC applies?' } })
    expect(parseProposal(fenced({ needsHuman: false, transition: 'T02', summary: 'x' }))).toMatchObject({ ok: true, proposal: { kind: 'step', transition: 'T02' } })
    const missing = parseProposal(fenced({ needsHuman: true }))
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problem).toContain('question')
    expect(PROPOSAL_SCHEMA.required).toEqual([])
    expect(Object.keys(PROPOSAL_SCHEMA.properties ?? {})).toEqual(['transition', 'event', 'summary', 'decisions', 'pr', 'needsHuman', 'question'])
  })

  it('names the first problem of an unusable hand-over', () => {
    const cases: [SubagentResult, string][] = [
      [textResult('Done without a block.'), 'without a fenced'],
      [textResult('```json\n{ not json\n```'), 'not valid JSON'],
      [fenced([1, 2]), 'not a JSON object'],
      [fenced({ transition: 7, summary: 'x' }), 'transition must be a non-empty string or null'],
      [fenced({ event: '  ', summary: 'x' }), 'event must be a non-empty string or null'],
      [fenced({ summary: 'x' }), 'neither a transition nor an event'],
      [fenced({ needsHuman: 'yes', summary: 'x' }), 'needsHuman must be a boolean'],
      [fenced({ transition: 'T01', event: 'bug_fix', summary: 'x' }), 'both a transition and an event'],
      [fenced({ transition: 'T01', summary: '  ' }), 'summary must be one non-empty sentence'],
      [fenced({ transition: 'T01' }), 'summary must be one non-empty sentence'],
      [fenced({ transition: 'T01', summary: 'x', decisions: 'no' }), 'decisions must be an object'],
      [fenced({ transition: 'T01', summary: 'x', pr: 1.5 }), 'pr must be an integer or null'],
    ]
    for (const [result, expected] of cases) {
      const parsed = parseProposal(result)
      expect(parsed.ok, expected).toBe(false)
      if (!parsed.ok) expect(parsed.problem).toContain(expected)
    }
  })
})
