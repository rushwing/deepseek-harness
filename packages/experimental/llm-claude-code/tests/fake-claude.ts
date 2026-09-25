/** Scripted stand-ins for the Agent SDK query and the CLI process behind the subprocess seam. */

import { PassThrough } from 'node:stream'
import type { AccountInfo, ModelInfo, Options, SDKMessage, SDKUserMessage, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { QueryFactory, QueryLike } from '@deepseek-ai/dsh-experimental-llm-claude-code'

/** One spawned fake CLI process. */
export interface FakeChild {
  readonly handle: SubprocessHandle
  readonly spec: SubprocessSpawnSpec
  readonly settle: (outcome?: SubprocessOutcome) => void
  readonly terminated: () => number
}

/** Records every spawn the adapter requests through the subprocess seam. */
export interface FakeSpawner {
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  readonly children: FakeChild[]
}

export function fakeSpawner(): FakeSpawner {
  const children: FakeChild[] = []
  return {
    children,
    spawn: (spec) => {
      let exited = false
      let terminations = 0
      let resolveDone!: (outcome: SubprocessOutcome) => void
      const done = new Promise<SubprocessOutcome>((resolve) => { resolveDone = resolve })
      const settle = (outcome: SubprocessOutcome = { exitCode: 0, signal: null }): void => {
        if (exited) return
        exited = true
        resolveDone(outcome)
      }
      const handle: SubprocessHandle = {
        control: undefined,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: undefined,
        collected: {},
        done,
        terminate: () => {
          terminations += 1
          settle({ exitCode: null, signal: 'SIGTERM' })
        },
        waitForExit: async () => {
          await done
          return true
        },
      }
      const child: FakeChild = { handle, spec, settle, terminated: () => terminations }
      children.push(child)
      return handle
    },
  }
}

/** One scripted `query()` invocation the adapter made. */
export interface ScriptedQuery {
  readonly options: Options
  /** User messages the adapter wrote to the prompt stream. */
  readonly sent: SDKUserMessage[]
  /** Deliver one SDK message to the adapter's iteration. */
  readonly emit: (message: SDKMessage) => void
  /** End the iteration with an error, the way a dead CLI or an abort surfaces. */
  readonly fail: (error: Error) => void
  /** End the iteration normally without a result. */
  readonly end: () => void
  readonly closed: () => number
  readonly interrupted: () => number
  /** Settle the pending `supportedModels()` call. */
  readonly resolveModels: (models: ModelInfo[]) => void
  /** Fail the pending `supportedModels()` call the way a dead CLI does. */
  readonly rejectModels: (error: Error) => void
  /** Settle the pending `accountInfo()` call. */
  readonly resolveAccount: (account: AccountInfo) => void
  /** The CLI process the adapter spawned for this query, once the fake SDK asked for it. */
  readonly child: () => FakeChild | undefined
}

/** A `query` stand-in that hands every invocation to the test. */
export interface FakeQueryFactory {
  readonly factory: QueryFactory
  readonly queries: ScriptedQuery[]
  /** Resolves with the next query the adapter starts. */
  readonly nextQuery: () => Promise<ScriptedQuery>
}

export function fakeQueryFactory(spawner: FakeSpawner, behavior: { readonly spawns?: boolean } = {}): FakeQueryFactory {
  const queries: ScriptedQuery[] = []
  const waiters: Array<(query: ScriptedQuery) => void> = []
  const consumed = new WeakSet<ScriptedQuery>()
  return {
    queries,
    nextQuery: () => new Promise<ScriptedQuery>((resolve) => {
      const existing = queries.find(query => !consumed.has(query))
      if (existing !== undefined) {
        consumed.add(existing)
        resolve(existing)
        return
      }
      waiters.push(resolve)
    }),
    factory: (params) => {
      const queue: Array<{ readonly message: SDKMessage } | { readonly error: Error } | { readonly end: true }> = []
      const wakeups: Array<() => void> = []
      const wake = (): void => { for (const w of wakeups.splice(0)) w() }
      let closed = 0
      let interrupted = 0
      let child: FakeChild | undefined
      const sent: SDKUserMessage[] = []
      const spawnOptions: SpawnOptions = {
        command: '/sdk/claude',
        args: ['--output-format', 'stream-json'],
        cwd: params.options.cwd ?? '/unset',
        env: params.options.env ?? {},
        signal: params.options.abortController?.signal ?? new AbortController().signal,
      }
      if (behavior.spawns !== false) {
        params.options.spawnClaudeCodeProcess?.(spawnOptions)
        child = spawner.children.at(-1)
      }
      const models = Promise.withResolvers<ModelInfo[]>()
      const account = Promise.withResolvers<AccountInfo>()
      void models.promise.catch(() => {})
      void (async () => {
        for await (const message of params.prompt) sent.push(message)
      })().catch(() => {})
      const query: QueryLike = {
        async* [Symbol.asyncIterator]() {
          for (;;) {
            const next = queue.shift()
            if (next === undefined) {
              await new Promise<void>((resolve) => { wakeups.push(resolve) })
              continue
            }
            if ('end' in next) return
            if ('error' in next) throw next.error
            yield next.message
          }
        },
        close: () => {
          closed += 1
          queue.push({ end: true })
          wake()
          child?.settle()
        },
        interrupt: () => {
          interrupted += 1
          return Promise.resolve(undefined)
        },
        supportedModels: () => models.promise,
        accountInfo: () => account.promise,
      }
      const scripted: ScriptedQuery = {
        options: params.options,
        sent,
        emit: (message) => {
          queue.push({ message })
          wake()
        },
        fail: (error) => {
          queue.push({ error })
          wake()
        },
        end: () => {
          queue.push({ end: true })
          wake()
        },
        closed: () => closed,
        interrupted: () => interrupted,
        resolveModels: models.resolve,
        rejectModels: models.reject,
        resolveAccount: account.resolve,
        child: () => child,
      }
      queries.push(scripted)
      const waiter = waiters.shift()
      if (waiter !== undefined) {
        consumed.add(scripted)
        waiter(scripted)
      }
      return query
    },
  }
}
