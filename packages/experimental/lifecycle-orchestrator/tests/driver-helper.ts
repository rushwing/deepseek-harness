import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentResult,
  type SubagentRun,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import LifecycleService from '@deepseek-ai/dsh-experimental-lifecycle-orchestrator'
import { REQ_010, agentAt, setField, workspace } from './workspace-helper.ts'

export const RV_010 = 'lifecycle/tasks/reviews/platform/RV-PLAT-010.md'
export const RV_009 = 'lifecycle/tasks/reviews/platform/RV-PLAT-009.md'
export const TC_010_01 = 'lifecycle/tasks/test-cases/platform/TC-PLAT-010-01.md'
const SIGN_DATE = '2026-09-26'
const CHECKLIST = Array.from({ length: 8 }, (_, index) => `- [x] CHK0${String(index + 1)} Checked`).join('\n')

/** The hand-over a scripted child ends with. */
export interface Proposal {
  readonly transition?: string | null
  readonly event?: string
  readonly summary: string
  readonly decisions?: Readonly<Record<string, unknown>>
  readonly pr?: number
}

/** One scripted role child, matched by the start label prefix `lifecycle:<uid>@<state>:<REQ>`. */
export interface ScriptedChild {
  readonly label: string
  /** File edits the child makes in the workspace before handing over. */
  readonly edit?: (root: string) => Promise<void>
  /** The proposal; `null` hands over without a fenced JSON block. */
  readonly proposal?: Proposal | null
  /** The complete output text, replacing the rendered proposal. */
  readonly text?: string
  readonly stopReason?: SubagentStopReason
  /** Tool calls or other actions the child performs with its own identity. */
  readonly act?: (request: ResolvedSubagentStartRequest, childId: SessionId) => Promise<void>
  /** Resolve only when the driver aborts the run. */
  readonly hang?: boolean
}

function renderProposal(proposal: Proposal | null | undefined): string {
  if (proposal === null || proposal === undefined) return 'Work done.\n'
  return `Work done.\n\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\`\n`
}

/** A subagent provider that plays scripted role children and records every start request. */
export class FakeRoleProvider implements SubagentProvider {
  readonly name = 'fake-roles'
  readonly capabilities: SubagentCapabilities
  readonly inheritsParentContext = false
  readonly requests: ResolvedSubagentStartRequest[] = []
  readonly disposed: string[] = []
  private runs = 0

  constructor(private readonly root: string, private readonly children: readonly ScriptedChild[], capabilities?: SubagentCapabilities) {
    this.capabilities = capabilities ?? { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: false }
  }

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.requests.push(request)
    const label = request.label ?? ''
    const script = this.children.find(child => label.startsWith(child.label))
    if (script === undefined) return Promise.reject(new Error(`no scripted child for ${label}`))
    const id = SessionId(`lifecycle-child-${String(++this.runs)}`)
    const result = this.perform(script, request, id)
    return Promise.resolve({
      id,
      localAgent: undefined,
      result,
      dispose: () => {
        this.disposed.push(String(id))
        return Promise.resolve()
      },
    })
  }

  private async perform(script: ScriptedChild, request: ResolvedSubagentStartRequest, id: SessionId): Promise<SubagentResult> {
    if (script.hang === true) {
      if (!request.signal.aborted) {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => {
            resolve()
          }, { once: true })
        })
      }
      return { output: [], stopReason: 'aborted' }
    }
    await script.edit?.(this.root)
    await script.act?.(request, id)
    const text = script.text ?? renderProposal(script.proposal)
    const hasProposal = script.proposal !== null && script.proposal !== undefined
    const structured = request.outputSchema !== undefined && script.text === undefined && hasProposal ? script.proposal : undefined
    return { output: [{ type: 'text', text }], ...(structured === undefined ? {} : { structured }), stopReason: script.stopReason ?? 'completed' }
  }
}

/** One question the driver asked the human. */
export interface AskedQuestion {
  readonly question: string
  readonly options: string[]
}

/**
 * A user-questions service that answers from a script; an exhausted script
 * rejects like a headless deployment without an answerer.
 */
export function scriptedAnswerer(ctx: Context, answers: string[]): AskedQuestion[] {
  const asked: AskedQuestion[] = []
  const service = {
    ask(request: { questions: { id: string; question: string; options?: { label: string }[] }[] }) {
      const [question] = request.questions
      if (question === undefined) return Promise.reject(new Error('no question'))
      asked.push({ question: question.question, options: (question.options ?? []).map(option => option.label) })
      const answer = answers.shift()
      if (answer === undefined) return Promise.reject(new HarnessError('no human is attached to this Session', 'NO_PROVIDER'))
      if (answer === 'BOOM') return Promise.reject(new Error('the answerer crashed'))
      return Promise.resolve({ answers: [{ id: question.id, selected: answer === '' ? [] : [answer] }] })
    },
  }
  ctx.provide('userQuestions', service as never)
  return asked
}

/** What a driver test starts from. */
export interface DriverSetup {
  readonly ctx: Context
  readonly root: string
  readonly agent: Agent
  readonly provider: FakeRoleProvider
  readonly asked: AskedQuestion[]
}

/** Options of {@link setupDriver}. */
export interface DriverOptions {
  readonly config?: Record<string, unknown>
  /** Scripted human answers; `'none'` composes no user-questions service. */
  readonly answers?: string[] | 'none'
  readonly prepare?: (root: string) => Promise<void>
  /** Provider capabilities; every capability is on by default. */
  readonly capabilities?: SubagentCapabilities
}

/** A context with the real prompt, tool, subagent, and lifecycle services, the scripted provider, and a fresh workspace copy. */
export async function setupDriver(children: readonly ScriptedChild[], options: DriverOptions = {}): Promise<DriverSetup> {
  const root = await workspace()
  await options.prepare?.(root)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime, {})
  await ctx.plugin(LifecycleService, { lifecycleDir: 'lifecycle', subagentProvider: 'fake-roles', maxStepsPerRun: 12, ...options.config })
  const provider = new FakeRoleProvider(root, children, options.capabilities)
  ctx.subagents.registerProvider(provider)
  const asked = options.answers === 'none' ? [] : scriptedAnswerer(ctx, [...(options.answers ?? [])])
  return { ctx, root, agent: agentAt(ctx, root), provider, asked }
}

/** Register a `write` tool that writes the named file, standing in for the first-party tool. */
export function registerWriteTool(ctx: Context): string[] {
  const written: string[] = []
  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Write a file.',
    parameters: {
      file_path: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `wrote ${value.path}` }],
    },
    execute: async (args) => {
      await mkdir(dirname(args.file_path), { recursive: true })
      await writeFile(args.file_path, args.content, 'utf8')
      written.push(args.file_path)
      return { path: args.file_path }
    },
    presentCall: args => ({ card: 'generic', title: `write ${args.file_path}`, kind: 'other' }),
  }))
  return written
}

/** The review record of REQ-PLAT-010 with the named sections, each signed PASS at round 1. */
export function reviewRecord(sections: readonly { section: string; uid: string; round?: number; verdict?: string }[]): string {
  const parts = ['---', 'rv_id: RV-PLAT-010', 'tool: platform', 'linked_req: REQ-PLAT-010', '---', '']
  for (const entry of sections) {
    parts.push(
      `## ${entry.section}`, '',
      `Conclusion: ${entry.verdict ?? 'PASS'} (round ${String(entry.round ?? 1)}, ${SIGN_DATE}, ${entry.uid})`, '',
      ...(entry.section === 'req_review' ? ['Fixed items:', CHECKLIST, ''] : []),
      'Review scope: the whole REQ', '', 'Evidence: 1 read', '', 'Findings: None', '', 'Pending human-001: None', '',
    )
  }
  return parts.join('\n')
}

/** Write a workspace file, creating its directory. */
export async function writeArtifact(root: string, label: string, text: string): Promise<void> {
  const path = join(root, ...label.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, 'utf8')
}

/** Append a signed section to RV-PLAT-010, which must already exist. */
export async function signSection(root: string, section: string, uid: string): Promise<void> {
  const path = join(root, ...RV_010.split('/'))
  const text = await readFile(path, 'utf8')
  const signed = [
    `## ${section}`, '', `Conclusion: PASS (round 1, ${SIGN_DATE}, ${uid})`, '',
    'Review scope: the whole REQ', '', 'Evidence: 1 read', '', 'Findings: None', '', 'Pending human-001: None', '',
  ].join('\n')
  await writeFile(path, `${text}${signed}`, 'utf8')
}

/** A draft TC of REQ-PLAT-010 verifying both acceptance criteria. */
export function draftTestCase(location = 'Pending: the generator names the test at tc_impl.'): string {
  return [
    '---', 'tc_id: TC-PLAT-010-01', 'tool: platform', 'linked_req: REQ-PLAT-010', 'verifies: [AC-PLAT-010-01, AC-PLAT-010-02]',
    'title: "Lint reports one line per defect and nothing for a clean tree"', 'status: draft', 'level: unit', 'owner: evaluator-002', 'automated: true', '---', '',
    '## Preconditions', '', 'A tasks tree with one malformed artifact, and a clean copy of it.', '',
    '## Steps', '', '1. Run the lint over the malformed tree and read the report.', '2. Run the lint over the clean tree and read the report.', '',
    '## Expected results', '',
    '- AC-PLAT-010-01: the report has one line naming the malformed file, the rule, and the defect.',
    '- AC-PLAT-010-02: the report over the clean tree is empty.', '',
    '## Implementation location', '', location, '',
  ].join('\n')
}

/** Create TC-PLAT-010-01 and list it in the REQ's `test_case_ref`. */
export async function designTestCase(root: string): Promise<void> {
  await writeArtifact(root, TC_010_01, draftTestCase())
  await setField(root, REQ_010, 'test_case_ref', '[TC-PLAT-010-01]')
}

/** Fill the TC's implementation location. */
export async function implementTestCase(root: string): Promise<void> {
  await writeArtifact(root, TC_010_01, draftTestCase('`lint.spec.ts::reports one line per defect`'))
}

/** The scripted children that carry REQ-PLAT-010 from req_review to pr_draft. */
export function happyPathChildren(): ScriptedChild[] {
  return [
    { label: 'lifecycle:planner-001@req_review:REQ-PLAT-010', proposal: { transition: 'T02', summary: 'Scope and direction are written' } },
    {
      label: 'lifecycle:evaluator-002@req_review:REQ-PLAT-010',
      edit: root => writeArtifact(root, RV_010, reviewRecord([{ section: 'req_review', uid: 'evaluator-002' }])),
      proposal: { transition: 'T03', summary: 'Requirement review passes' },
    },
    { label: 'lifecycle:evaluator-002@tc_design:REQ-PLAT-010', edit: designTestCase, proposal: { transition: 'T05', summary: 'Test case text written' } },
    {
      label: 'lifecycle:generator-001@tc_review:REQ-PLAT-010',
      edit: root => signSection(root, 'tc_review', 'generator-001'),
      proposal: { transition: 'T06', summary: 'Test cases are implementable' },
    },
    { label: 'lifecycle:generator-001@tc_impl:REQ-PLAT-010', edit: implementTestCase, proposal: { transition: 'T08', summary: 'Test implemented' } },
    {
      label: 'lifecycle:evaluator-001@tc_impl_review:REQ-PLAT-010',
      edit: root => signSection(root, 'tc_impl_review', 'evaluator-001'),
      proposal: { transition: 'T09', summary: 'Test implementation matches its text' },
    },
    { label: 'lifecycle:generator-001@req_impl:REQ-PLAT-010', proposal: { transition: 'T11', summary: 'Implementation ready for review', pr: 26 } },
    {
      label: 'lifecycle:evaluator-002@req_impl_review:REQ-PLAT-010',
      edit: root => signSection(root, 'req_impl_review', 'evaluator-002'),
      proposal: { transition: 'T13', summary: 'Implementation review passes', decisions: { tcStatuses: { 'TC-PLAT-010-01': 'passing' } } },
    },
  ]
}

/** The frontmatter fields of a workspace artifact as `key: value` lines. */
export async function frontmatterOf(root: string, label: string): Promise<Record<string, string>> {
  const text = await readFile(join(root, ...label.split('/')), 'utf8')
  const block = text.split('\n---\n')[0] ?? ''
  return Object.fromEntries(block.split('\n').filter(line => /^[a-z_]+:/.test(line)).map((line) => {
    const index = line.indexOf(':')
    return [line.slice(0, index), line.slice(index + 1).trim()]
  }))
}

/** An open BUG found at req_review; `binding` names the REQ it originates from (`''` for none) and `blocks` the REQ it blocks. */
export function bugReport(id: string, binding: string, blocks = ''): string {
  return [
    '---', `bug_id: ${id}`, 'tool: platform', 'title: "A defect found in review"', 'status: open', 'severity: low', 'bug_type: req_bug',
    'owner: evaluator-002', 'linked_req: ""', `origin_req: ${binding === '' ? '""' : binding}`, `blocks_req: [${blocks}]`, 'found_in: req_review',
    'test_case_ref: []', '---', '', '## Symptom', '', 'A defect.', '',
  ].join('\n')
}
