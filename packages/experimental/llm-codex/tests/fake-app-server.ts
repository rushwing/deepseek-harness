/** Scripted stand-in for the Codex app-server process behind the subprocess seam. */

import { PassThrough } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

export type JsonObject = Record<string, unknown>

/** Reads the frames the client writes and lets a test answer them. */
export class ProtocolPeer {
  private buffer = ''
  private readonly frames: JsonObject[] = []
  private readonly wakeups = new Set<() => void>()

  constructor(
    input: PassThrough,
    private readonly output: PassThrough,
  ) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) this.frames.push(JSON.parse(line) as JsonObject)
      }
      for (const wake of this.wakeups) wake()
      this.wakeups.clear()
    })
  }

  async next(predicate: (frame: JsonObject) => boolean): Promise<JsonObject> {
    for (;;) {
      const index = this.frames.findIndex(predicate)
      if (index >= 0) return this.frames.splice(index, 1)[0]!
      await new Promise<void>((resolve) => { this.wakeups.add(resolve) })
    }
  }

  nextMethod(method: string): Promise<JsonObject> {
    return this.next(frame => frame.method === method)
  }

  nextResponse(id: unknown): Promise<JsonObject> {
    return this.next(frame => frame.id === id && frame.method === undefined)
  }

  pending(): readonly JsonObject[] {
    return [...this.frames]
  }

  send(...frames: readonly JsonObject[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }

  respond(requestFrame: JsonObject, result: unknown): void {
    this.send({ id: requestFrame.id, result })
  }

  respondError(requestFrame: JsonObject, code: number, message: string): void {
    this.send({ id: requestFrame.id, error: { code, message } })
  }

  request(id: string, method: string, params: JsonObject): void {
    this.send({ id, method, params })
  }

  notify(method: string, params: JsonObject): void {
    this.send({ method, params })
  }
}

/** One spawned fake process: its handle, its protocol peer, and its exit controls. */
export interface FakeChild {
  readonly handle: SubprocessHandle
  /** The writable side of the child's stderr pipe. */
  readonly stderr: PassThrough
  readonly peer: ProtocolPeer
  readonly spec: SubprocessSpawnSpec
  readonly settle: (outcome?: SubprocessOutcome) => void
  /** Reject `done` the way the seam reports a spawn or provider failure. */
  readonly fail: (error: Error) => void
  readonly terminated: () => number
}

/** A spawn function that records every spawn and hands each child to the test. */
export interface FakeSpawner {
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly children: FakeChild[]
  /** Resolves with the next child the client spawns. */
  readonly nextChild: () => Promise<FakeChild>
}

export function fakeSpawner(): FakeSpawner {
  const children: FakeChild[] = []
  const waiters: Array<(child: FakeChild) => void> = []
  return {
    children,
    nextChild: () => new Promise<FakeChild>((resolve) => {
      const existing = children.find(child => !consumed.has(child))
      if (existing !== undefined) {
        consumed.add(existing)
        resolve(existing)
        return
      }
      waiters.push(resolve)
    }),
    spawn: (spec) => {
      const fromChild = new PassThrough()
      const toChild = new PassThrough()
      const stderr = new PassThrough()
      const peer = new ProtocolPeer(toChild, fromChild)
      let exited = false
      let terminations = 0
      let resolveDone!: (outcome: SubprocessOutcome) => void
      let rejectDone!: (error: Error) => void
      const done = new Promise<SubprocessOutcome>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      })
      const settle = (outcome: SubprocessOutcome = { exitCode: 0, signal: null }): void => {
        if (exited) return
        exited = true
        fromChild.end()
        resolveDone(outcome)
      }
      const fail = (error: Error): void => {
        if (exited) return
        exited = true
        fromChild.end()
        rejectDone(error)
      }
      const handle: SubprocessHandle = {
        control: undefined,
        stdin: toChild,
        stdout: fromChild,
        stderr,
        collected: {},
        done,
        terminate: () => {
          terminations += 1
          settle({ exitCode: null, signal: 'SIGTERM' })
        },
        waitForExit: async () => {
          await done.catch(() => {})
          return true
        },
      }
      const child: FakeChild = { handle, stderr, peer, spec, settle, fail, terminated: () => terminations }
      children.push(child)
      const waiter = waiters.shift()
      if (waiter !== undefined) {
        consumed.add(child)
        waiter(child)
      }
      return handle
    },
  }
}

const consumed = new WeakSet<FakeChild>()

/** Answer the handshake the client performs after spawning. */
export async function completeHandshake(child: FakeChild): Promise<void> {
  child.peer.respond(await child.peer.nextMethod('initialize'), { userAgent: 'codex-cli 0.153.4' })
  await child.peer.nextMethod('initialized')
}
