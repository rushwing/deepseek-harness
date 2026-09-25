/**
 * Turns a product's streamed text and reasoning into the harness `StreamChunk`
 * protocol: correlated block indices, `block-end` with the assembled block,
 * usage before the terminal finish, and nothing afterward.
 *
 * @module @deepseek-ai/dsh-experimental-llm-product-backend/stream
 */

import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

type OpenBlock = {
  readonly index: number
  readonly type: 'text' | 'reasoning'
  text: string
}

type Settlement =
  | { readonly kind: 'finished' }
  | { readonly kind: 'failed'; readonly error: Error }

/**
 * One turn's chunk source. The product side calls {@link text},
 * {@link reasoning}, {@link usage}, and finally {@link finish} or
 * {@link fail}; the adapter yields {@link chunks} to the LLM runtime. A text
 * delta after reasoning (or the reverse) closes the open block and starts a
 * new one, so activity lines written as reasoning never merge into the answer.
 */
export class ProductTurnStream {
  private readonly queue: StreamChunk[] = []
  private waiter: (() => void) | undefined
  private settlement: Settlement | undefined
  private open: OpenBlock | undefined
  private lastUsage: TokenUsage | undefined
  private nextIndex = 0

  /**
   * Append assistant text.
   * @param delta - the next text fragment; empty fragments are ignored.
   */
  text(delta: string): void {
    this.delta('text', delta)
  }

  /**
   * Append reasoning or activity text.
   * @param delta - the next fragment; empty fragments are ignored.
   */
  reasoning(delta: string): void {
    this.delta('reasoning', delta)
  }

  /**
   * Record the turn's latest token usage; the last value is emitted before finish.
   * @param usage - disjoint token counts for the turn so far.
   */
  usage(usage: TokenUsage): void {
    this.assertUnsettled()
    this.lastUsage = usage
  }

  /**
   * Close the open block, emit the last usage, and end the stream.
   * @param reason - why the turn stopped.
   */
  finish(reason: FinishReason): void {
    this.assertUnsettled()
    this.closeBlock()
    if (this.lastUsage !== undefined) this.push({ type: 'usage', usage: this.lastUsage })
    this.push({ type: 'finish', reason })
    this.settlement = { kind: 'finished' }
    this.wake()
  }

  /**
   * End the stream with an error after whatever was already produced.
   * @param error - the failure the iterator rethrows.
   */
  fail(error: Error): void {
    this.assertUnsettled()
    this.settlement = { kind: 'failed', error }
    this.wake()
  }

  /**
   * The chunks in production order. Iteration waits for more output until the
   * stream is finished or failed.
   * @returns the chunk stream for `LlmAdapter.stream()`.
   */
  async * chunks(): AsyncIterable<StreamChunk> {
    for (;;) {
      const next = this.queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      const settlement = this.settlement
      if (settlement !== undefined) {
        if (settlement.kind === 'failed') throw settlement.error
        return
      }
      await new Promise<void>((resolve) => { this.waiter = resolve })
    }
  }

  private delta(type: OpenBlock['type'], text: string): void {
    this.assertUnsettled()
    if (text.length === 0) return
    if (this.open !== undefined && this.open.type !== type) this.closeBlock()
    if (this.open === undefined) {
      this.open = { index: this.nextIndex, type, text: '' }
      this.nextIndex += 1
      this.push({ type: 'block-start', index: this.open.index, blockType: type })
    }
    this.open.text += text
    this.push(type === 'text'
      ? { type: 'text-delta', index: this.open.index, text }
      : { type: 'reasoning-delta', index: this.open.index, text })
  }

  private closeBlock(): void {
    const open = this.open
    if (open === undefined) return
    this.open = undefined
    this.push({ type: 'block-end', index: open.index, block: { type: open.type, text: open.text } })
  }

  private push(chunk: StreamChunk): void {
    this.queue.push(chunk)
    this.wake()
  }

  private wake(): void {
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
  }

  private assertUnsettled(): void {
    if (this.settlement !== undefined) {
      throw new Error('llm-product-backend: stream already settled')
    }
  }
}
