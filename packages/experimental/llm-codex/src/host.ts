/**
 * Owns the one Codex app-server process behind a plugin instance: lazy start
 * on the first request, a shared connection while the process lives, respawn
 * after it exits, and termination on disposal.
 *
 * @module @deepseek-ai/dsh-experimental-llm-codex/host
 */

import {
  CodexAppServerConnection,
  codexAppServerArgv,
  raceAbort,
  type CodexServerRequestHandler,
} from '@deepseek-ai/dsh-codex-app-server'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

const SOURCE = 'llm-codex'

/** What the host needs from its plugin. */
export interface CodexAppServerHostOptions {
  /** The shared subprocess service's spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Working directory of the app-server process itself; threads carry their own workspace. */
  readonly cwd: string
  /** Explicit environment overlay after the seam's credential scrub. */
  readonly env: Readonly<Record<string, string>>
  /** Grace between termination tiers on disposal. */
  readonly disposeGraceMs: number
  /** Answers the app-server's approval, user-input, and elicitation requests. */
  readonly handler: CodexServerRequestHandler
  /** Receives the product's stderr; defaults to the Host process stderr. */
  readonly stderr?: (chunk: Buffer) => void
}

interface Generation {
  readonly child: SubprocessHandle
  readonly connection: CodexAppServerConnection
  readonly ready: Promise<CodexAppServerConnection>
}

function defaultStderr(chunk: Buffer): void {
  process.stderr.write(chunk)
}

/**
 * One app-server per plugin instance, started on demand. Threads created or
 * resumed on the current process are recorded with {@link markThreadLive} so a
 * later turn knows whether it must resume them again after a respawn.
 */
export class CodexAppServerHost {
  private generation: Generation | undefined
  private readonly liveThreads = new Set<string>()
  private disposed = false

  constructor(private readonly options: CodexAppServerHostOptions) {}

  /**
   * The initialized connection to the running app-server, starting one when
   * none is running. Concurrent callers share the same start.
   * @param signal - the caller's wait cancellation; it does not stop the start itself.
   * @returns the live connection.
   */
  connection(signal: AbortSignal): Promise<CodexAppServerConnection> {
    if (this.disposed) return Promise.reject(new Error(`${SOURCE}: host is disposed`))
    const current = this.generation
    const generation = current !== undefined && !current.connection.closed ? current : this.start()
    return raceAbort(generation.ready, signal, SOURCE)
  }

  /**
   * Whether the current process already knows a thread, so a turn can run on
   * it without `thread/resume`.
   * @param threadId - the product thread id.
   * @returns `true` while the process that started or resumed the thread is alive.
   */
  threadIsLive(threadId: string): boolean {
    const generation = this.generation
    return generation !== undefined && !generation.connection.closed && this.liveThreads.has(threadId)
  }

  /**
   * Record that the current process started or resumed a thread.
   * @param threadId - the product thread id.
   */
  markThreadLive(threadId: string): void {
    this.liveThreads.add(threadId)
  }

  /** Close the connection, terminate the process, and wait for its exit. Idempotent. */
  async dispose(): Promise<void> {
    this.disposed = true
    const generation = this.generation
    this.generation = undefined
    this.liveThreads.clear()
    if (generation === undefined) return
    await this.terminate(generation)
  }

  private start(): Generation {
    const { options } = this
    const child = options.spawn({
      argv: codexAppServerArgv(),
      cwd: options.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: options.disposeGraceMs,
      env: { ...options.env },
    })
    const stderr = options.stderr ?? defaultStderr
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    const connection = new CodexAppServerConnection(
      child.stdout as NonNullable<SubprocessHandle['stdout']>,
      child.stdin as NonNullable<SubprocessHandle['stdin']>,
      options.handler,
    )
    connection.start()
    this.liveThreads.clear()
    const handshake = Promise.withResolvers<CodexAppServerConnection>()
    const generation: Generation = { child, connection, ready: handshake.promise }
    void (async () => {
      try {
        await connection.initialize(new AbortController().signal)
        handshake.resolve(connection)
      } catch (error: unknown) {
        // A handshake that fails after disposal finds its generation already terminated.
        if (this.generation === generation) {
          this.generation = undefined
          await this.terminate(generation)
        }
        handshake.reject(error)
      }
    })()
    // A generation that fails its handshake rejects `ready` for every waiter;
    // the rejection is observed by each caller, so no unhandled rejection remains.
    void generation.ready.catch(() => {})
    // Process exit ends the generation at once: pending requests fail instead
    // of waiting for the pipes to drain, and the next request respawns.
    const exited = (): void => {
      if (this.generation === generation) this.liveThreads.clear()
      connection.close()
    }
    void child.done.then(exited, exited)
    this.generation = generation
    return generation
  }

  private async terminate(generation: Generation): Promise<void> {
    generation.connection.close()
    generation.child.stdin?.end()
    generation.child.terminate()
    await generation.child.waitForExit()
    await generation.child.done.catch(() => {})
  }
}
