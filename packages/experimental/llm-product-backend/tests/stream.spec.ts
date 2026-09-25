import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { ProductTurnStream } from '@deepseek-ai/dsh-experimental-llm-product-backend'

async function collect(stream: ProductTurnStream): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream.chunks()) chunks.push(chunk)
  return chunks
}

describe('ProductTurnStream', () => {
  it('opens, fills, and closes blocks as the product alternates reasoning and text', async () => {
    const stream = new ProductTurnStream()
    stream.reasoning('think ')
    stream.reasoning('more')
    stream.text('Hi ')
    stream.text('there')
    stream.usage({ inputTokens: 10, outputTokens: 5 })
    stream.finish({ kind: 'stop' })
    expect(await collect(stream)).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'think ' },
      { type: 'reasoning-delta', index: 0, text: 'more' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think more' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'Hi ' },
      { type: 'text-delta', index: 1, text: 'there' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'Hi there' } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('starts a new reasoning block after text so activity lines never merge into the answer', async () => {
    const stream = new ProductTurnStream()
    stream.text('answer')
    stream.reasoning('ran `ls` (exit 0)\n')
    stream.finish({ kind: 'stop' })
    const chunks = await collect(stream)
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'block-start', 'text-delta', 'block-end', 'block-start', 'reasoning-delta', 'block-end', 'finish',
    ])
    expect(chunks[3]).toEqual({ type: 'block-start', index: 1, blockType: 'reasoning' })
  })

  it('ignores empty deltas and emits nothing but finish for a silent turn', async () => {
    const stream = new ProductTurnStream()
    stream.text('')
    stream.reasoning('')
    stream.finish({ kind: 'stop' })
    expect(await collect(stream)).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })

  it('delivers chunks to a consumer that started iterating before the product produced them', async () => {
    const stream = new ProductTurnStream()
    const collecting = collect(stream)
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    stream.text('late')
    stream.finish({ kind: 'stop' })
    expect((await collecting).map(chunk => chunk.type)).toEqual(['block-start', 'text-delta', 'block-end', 'finish'])
  })

  it('rethrows a failure from the iterator after yielding what was produced', async () => {
    const stream = new ProductTurnStream()
    stream.text('partial')
    stream.fail(new Error('product died'))
    const seen: string[] = []
    await expect((async () => {
      for await (const chunk of stream.chunks()) seen.push(chunk.type)
    })()).rejects.toThrow('product died')
    expect(seen).toEqual(['block-start', 'text-delta'])
  })

  it('refuses output after the stream settled', () => {
    const stream = new ProductTurnStream()
    stream.finish({ kind: 'stop' })
    expect(() => { stream.text('x') }).toThrow('stream already settled')
    expect(() => { stream.finish({ kind: 'stop' }) }).toThrow('stream already settled')
    expect(() => { stream.fail(new Error('x')) }).toThrow('stream already settled')
  })
})
