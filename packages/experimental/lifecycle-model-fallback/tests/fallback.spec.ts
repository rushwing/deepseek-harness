import { afterEach, describe, expect, it } from 'vitest'
import * as retry from '@deepseek-ai/dsh-llm-retry'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { CLAUDE_EFFORTS, RetryingMockAdapter, childAgent, cleanup, failWith, lastTurnEnd, oneRetry, routesOf, setupLoop, turn } from './harness.ts'

const PLANNER = 'lifecycle:planner-001@req_review:REQ-PLAT-010'

afterEach(cleanup)

describe('lifecycle model fallback', () => {
  it('moves a role child to its first fallback route on a hop-worthy failure and keeps an advertised effort', async () => {
    const setup = await setupLoop({ claude: new MockAdapter([failWith('SERVER'), textResponse('done')], CLAUDE_EFFORTS) })
    const agent = await childAgent(setup, PLANNER)
    await turn(agent)
    expect(routesOf(setup.claude)).toEqual(['claude-code/opus@xhigh', 'claude-code/sonnet@xhigh'])
    expect(routesOf(setup.codex)).toEqual([])
    expect(lastTurnEnd(agent)).toBe('completed')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(1)
  })

  it('drops the effort when the next route does not advertise it and stays on the fallback for later steps', async () => {
    const setup = await setupLoop({
      claude: new MockAdapter([failWith('RATE_LIMIT'), failWith('TIMEOUT')], CLAUDE_EFFORTS),
      codex: new MockAdapter([textResponse('done'), textResponse('again')]),
    })
    const agent = await childAgent(setup, PLANNER)
    await turn(agent)
    expect(routesOf(setup.claude)).toEqual(['claude-code/opus@xhigh', 'claude-code/sonnet@xhigh'])
    expect(routesOf(setup.codex)).toEqual(['codex/gpt-5.6-sol'])
    await turn(agent, 'more')
    expect(routesOf(setup.codex)).toEqual(['codex/gpt-5.6-sol', 'codex/gpt-5.6-sol'])
  })

  it('stops hopping at the cap and when the registry lists no further route', async () => {
    const capped = await setupLoop({
      claude: new MockAdapter([failWith('SERVER'), failWith('SERVER')], CLAUDE_EFFORTS),
      codex: new MockAdapter([failWith('SERVER')]),
    })
    const agent = await childAgent(capped, PLANNER)
    await turn(agent)
    expect(routesOf(capped.claude)).toHaveLength(2)
    expect(routesOf(capped.codex)).toEqual(['codex/gpt-5.6-sol'])
    expect(lastTurnEnd(agent)).toBe('error')

    const oneHop = await setupLoop({ claude: new MockAdapter([failWith('SERVER'), failWith('SERVER')], CLAUDE_EFFORTS), config: { maxHops: 1 } })
    const limited = await childAgent(oneHop, PLANNER)
    await turn(limited)
    expect(routesOf(oneHop.claude)).toEqual(['claude-code/opus@xhigh', 'claude-code/sonnet@xhigh'])
    expect(routesOf(oneHop.codex)).toEqual([])
    expect(lastTurnEnd(limited)).toBe('error')

    const exhausted = await setupLoop({ claude: new MockAdapter([failWith('SERVER')], CLAUDE_EFFORTS), config: { maxHops: 5 } })
    const evaluator = await childAgent(exhausted, 'lifecycle:evaluator-002@req_review:REQ-PLAT-010')
    await turn(evaluator)
    expect(routesOf(exhausted.claude)).toEqual(['claude-code/opus@xhigh'])
    expect(lastTurnEnd(evaluator)).toBe('error')
  })

  it('leaves other agents and other failure codes alone', async () => {
    const plain = await setupLoop({ claude: new MockAdapter([failWith('SERVER')], CLAUDE_EFFORTS) })
    const agent = await childAgent(plain, null)
    await turn(agent)
    expect(routesOf(plain.claude)).toEqual(['claude-code/opus@xhigh'])
    expect(lastTurnEnd(agent)).toBe('error')

    const context = await setupLoop({ claude: new MockAdapter([failWith('CONTEXT_WINDOW_EXCEEDED')], CLAUDE_EFFORTS) })
    const labeled = await childAgent(context, PLANNER)
    await turn(labeled)
    expect(routesOf(context.claude)).toEqual(['claude-code/opus@xhigh'])
    expect(lastTurnEnd(labeled)).toBe('error')
  })

  it('lets llm-retry exhaust its same-route budget before hopping, whichever mounted first', async () => {
    const claude = new RetryingMockAdapter([failWith('SERVER'), failWith('SERVER'), textResponse('done')], oneRetry(), CLAUDE_EFFORTS)
    const retryFirst = await setupLoop({
      claude,
      before: async (ctx) => {
        await ctx.plugin(Object.assign((inner: typeof ctx) => {
          retry.apply(inner, {})
        }, { inject: retry.inject }))
      },
    })
    const agent = await childAgent(retryFirst, PLANNER)
    await turn(agent)
    expect(routesOf(claude)).toEqual(['claude-code/opus@xhigh', 'claude-code/opus@xhigh', 'claude-code/sonnet@xhigh'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry')).toHaveLength(1)

    const later = new RetryingMockAdapter([failWith('SERVER'), failWith('SERVER'), textResponse('done')], oneRetry(), CLAUDE_EFFORTS)
    const fallbackFirst = await setupLoop({ claude: later })
    await fallbackFirst.ctx.plugin(Object.assign((inner: typeof fallbackFirst.ctx) => {
      retry.apply(inner, {})
    }, { inject: retry.inject }))
    const second = await childAgent(fallbackFirst, PLANNER, 'second-child')
    await turn(second)
    expect(routesOf(later)).toEqual(['claude-code/opus@xhigh', 'claude-code/opus@xhigh', 'claude-code/sonnet@xhigh'])
  })
})
