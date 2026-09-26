/**
 * Frontmatter rules: required fields and enumerations per kind, id-scheme
 * placement, the REQ schema and ownership facts, the blocked-field
 * invariant, `pr_number`, archive consistency, and id uniqueness.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-work-items/rules/frontmatter
 */

import { restoreRoles } from '@deepseek-ai/dsh-experimental-lifecycle-table'
import type { Artifact, Req } from '../artifacts.ts'
import { asList, positiveInt, scalar } from '../frontmatter.ts'
import { list, quote, textOf, type LintContext, type Violation } from './context.ts'

const REQ_FIELDS = [
  'req_id', 'tool', 'title', 'status', 'owner', 'priority', 'phase', 'scope', 'tc_policy', 'exempt_reason', 'depends_on', 'test_case_ref',
  'acceptance', 'review_round', 'pending_bugs', 'blocked_reason', 'blocked_from_status', 'blocked_from_owner', 'pr_number',
] as const
const TC_FIELDS = ['tc_id', 'tool', 'linked_req', 'title', 'status', 'level', 'owner', 'automated'] as const
const BUG_FIELDS = ['bug_id', 'tool', 'title', 'status', 'severity', 'bug_type', 'owner'] as const
const TC_POLICIES = ['required', 'optional', 'exempt'] as const
const EARLY_STATES = ['draft', 'req_review'] as const
const BLOCKED = 'blocked'
const BLOCKING_FIELDS = ['blocked_reason', 'blocked_from_status', 'blocked_from_owner'] as const
const ID_SHAPE_HINT: Readonly<Record<'REQ' | 'TC' | 'BUG', (prefix: string) => string>> = {
  REQ: prefix => `REQ-${prefix}-NNN.md`,
  TC: prefix => `TC-${prefix}-NNN-SS.md`,
  BUG: prefix => `BUG-${prefix}-NNN.md`,
}

function requiredFields(node: Artifact, fields: readonly string[], rule: string, out: Violation[]): void {
  for (const field of fields) {
    if (!(field in node.fm)) out.push({ file: node.label, rule, message: `missing frontmatter field '${field}'` })
  }
}

function idAndTool(node: Artifact, idField: string, rule: string, out: Violation[]): void {
  const id = textOf(node.fm[idField])
  if (id !== node.id) out.push({ file: node.label, rule, message: `${idField} ${quote(id)} does not match the file name` })
  const tool = textOf(node.fm.tool)
  if (node.live && tool !== node.scopeDir) {
    out.push({ file: node.label, rule, message: `tool ${quote(tool)} does not match the directory ${quote(node.scopeDir)}` })
  }
}

function ownerRegistered(ctx: LintContext, node: Artifact, rule: string, out: Violation[]): void {
  if (ctx.registry === undefined) return
  const owner = textOf(node.fm.owner)
  if (!ctx.agents.has(owner)) out.push({ file: node.label, rule, message: `owner ${quote(owner)} is not registered in agent-registry.yml` })
}

function statusRegistered(node: Artifact, legal: ReadonlySet<string>, kind: string, rule: string, out: Violation[]): void {
  if (!legal.has(node.status)) out.push({ file: node.label, rule, message: `status ${quote(node.status)} is not a registered ${kind} status` })
}

function enumerated(node: Artifact, field: string, legal: readonly string[], rule: string, out: Violation[]): void {
  const value = textOf(node.fm[field])
  if (!legal.includes(value)) out.push({ file: node.label, rule, message: `${field} ${quote(value)} is not one of ${list(legal)}` })
}

/**
 * The scope-directory placement of live REQ, TC, and BUG files against the id scheme.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkPlacement(ctx: LintContext): Violation[] {
  const scheme = ctx.idScheme
  if (scheme === undefined) return []
  const out: Violation[] = []
  for (const node of ctx.graph.artifacts) {
    if (!node.live || (node.kind !== 'REQ' && node.kind !== 'TC' && node.kind !== 'BUG')) continue
    const prefix = scheme.scopes[node.scopeDir]
    if (prefix === undefined) {
      out.push({ file: node.label, rule: 'placement', message: `directory ${quote(node.scopeDir)} is not registered in id-scheme.yml scopes` })
      continue
    }
    if (node.prefix !== prefix) out.push({ file: node.label, rule: 'placement', message: `file name should look like ${ID_SHAPE_HINT[node.kind](prefix)}` })
  }
  return out
}

/**
 * Required fields and enumerations of every REQ, TC, and BUG.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkFields(ctx: LintContext): Violation[] {
  const out: Violation[] = []
  const tcStatuses = new Set(ctx.table.states.tc)
  const bugStatuses = new Set(ctx.table.states.bug)
  for (const node of ctx.graph.artifacts) {
    switch (node.kind) {
      case 'REQ': {
        const rule = 'req-fields'
        requiredFields(node, REQ_FIELDS, rule, out)
        idAndTool(node, 'req_id', rule, out)
        statusRegistered(node, ctx.reqStatuses, 'REQ', rule, out)
        enumerated(node, 'priority', ctx.contract.req.priorities, rule, out)
        enumerated(node, 'scope', ctx.contract.req.scopes, rule, out)
        enumerated(node, 'tc_policy', TC_POLICIES, rule, out)
        if (node.tcPolicy === 'exempt' && textOf(node.fm.exempt_reason).trim() === '') {
          out.push({ file: node.label, rule, message: 'tc_policy exempt requires exempt_reason' })
        }
        ownerRegistered(ctx, node, rule, out)
        if (textOf(node.fm.acceptance).trim() === '') {
          out.push({ file: node.label, rule, message: 'acceptance must not be empty; a requirement must be verifiable' })
        }
        if (node.status === BLOCKED && textOf(node.fm.blocked_reason).trim() === '') {
          out.push({ file: node.label, rule, message: 'status blocked requires blocked_reason' })
        }
        break
      }
      case 'TC':
        requiredFields(node, TC_FIELDS, 'tc-fields', out)
        idAndTool(node, 'tc_id', 'tc-fields', out)
        statusRegistered(node, tcStatuses, 'TC', 'tc-fields', out)
        ownerRegistered(ctx, node, 'tc-fields', out)
        break
      case 'BUG':
        requiredFields(node, BUG_FIELDS, 'bug-fields', out)
        idAndTool(node, 'bug_id', 'bug-fields', out)
        statusRegistered(node, bugStatuses, 'BUG', 'bug-fields', out)
        ownerRegistered(ctx, node, 'bug-fields', out)
        break
      case 'RV':
      case 'PL':
        break
    }
  }
  return out
}

/**
 * The schema marker, `intent`, `review_round`, and owner facts of every REQ.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkReqFrontmatter(ctx: LintContext): Violation[] {
  const rule = 'req-frontmatter'
  const out: Violation[] = []
  for (const req of ctx.graph.reqs.values()) {
    if (req.v2) {
      if (scalar(req.fm.intent) === undefined) out.push({ file: req.label, rule, message: "v2 REQ lacks scalar frontmatter field 'intent'" })
      const round = req.fm.review_round
      if (typeof round !== 'number' || !Number.isInteger(round)) {
        out.push({ file: req.label, rule, message: `review_round ${quote(round)} is not an integer` })
      }
    } else if (req.live && !(EARLY_STATES as readonly string[]).includes(req.status)) {
      const { key, version } = ctx.contract.schema
      out.push({ file: req.label, rule, message: `status ${quote(req.status)} has left ${EARLY_STATES.join(' and ')}; frontmatter must declare ${key}: ${version}` })
    }
    if (ctx.registry === undefined) continue
    const owner = textOf(req.fm.owner)
    const agent = ctx.agents.get(owner)
    if (agent === undefined) {
      out.push({ file: req.label, rule, message: `owner ${quote(owner)} is not registered in agent-registry.yml` })
    } else if (!agent.handles.includes(req.status)) {
      out.push({ file: req.label, rule, message: `status ${quote(req.status)} is not within owner ${quote(owner)}'s handles ${list(agent.handles)}` })
    }
  }
  return out
}

function blockedFieldsOf(ctx: LintContext, req: Req, out: Violation[]): void {
  const rule = 'blocked-fields'
  const pending = asList(req.fm.pending_bugs)
  const blocked = req.status === BLOCKED
  if (pending.length > 0 && !blocked) out.push({ file: req.label, rule, message: 'pending_bugs is not empty but status is not blocked' })
  if (blocked && pending.length === 0) out.push({ file: req.label, rule, message: 'status is blocked but pending_bugs is empty' })
  if (!blocked) {
    const leftovers = BLOCKING_FIELDS.filter(field => textOf(req.fm[field]).trim() !== '')
    if (leftovers.length > 0) out.push({ file: req.label, rule, message: `status is not blocked; blocking fields ${list(leftovers)} must be cleared` })
  } else {
    if (textOf(req.fm.blocked_reason).trim() === '') out.push({ file: req.label, rule, message: 'blocked_reason must not be empty while blocked' })
    const restore = textOf(req.fm.blocked_from_status)
    const targets = restoreRoles(ctx.table)
    const expectedRole = targets[restore]
    if (expectedRole === undefined) {
      out.push({ file: req.label, rule, message: `blocked_from_status ${quote(restore)} is not a restore target; legal values ${list(Object.keys(targets).sort())}` })
    }
    const restoreOwner = textOf(req.fm.blocked_from_owner)
    if (!ctx.table.roles.includes(restoreOwner)) {
      out.push({ file: req.label, rule, message: `blocked_from_owner ${quote(restoreOwner)} is not a registered role` })
    } else if (expectedRole !== undefined && restoreOwner !== expectedRole) {
      out.push({ file: req.label, rule, message: `restore target ${quote(restore)} is taken over by ${expectedRole}; blocked_from_owner ${quote(restoreOwner)} is another role` })
    }
  }
  for (const bugId of pending) {
    const bug = ctx.graph.bugs.get(bugId)
    if (bug === undefined) {
      out.push({ file: req.label, rule, message: `${bugId} in pending_bugs does not exist` })
    } else if (!asList(bug.fm.blocks_req).includes(req.id)) {
      out.push({ file: req.label, rule, message: `${bugId} in pending_bugs does not list this REQ in blocks_req` })
    }
  }
}

/**
 * The blocked-field invariant of every REQ: `pending_bugs` and `blocked`
 * agree, blocking fields are set only while blocked, the restore pair names
 * a registered restore target and its role, and every pending BUG exists and blocks the REQ.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkBlockedFields(ctx: LintContext): Violation[] {
  const out: Violation[] = []
  for (const req of ctx.graph.reqs.values()) blockedFieldsOf(ctx, req, out)
  return out
}

/**
 * `pr_number` is null or a positive integer.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkPrNumber(ctx: LintContext): Violation[] {
  const out: Violation[] = []
  for (const req of ctx.graph.reqs.values()) {
    const value = req.fm.pr_number
    if (value === null || value === undefined || positiveInt(value)) continue
    out.push({ file: req.label, rule: 'pr-number', message: `pr_number ${quote(value)} is illegal; only null or a positive integer` })
  }
  return out
}

/**
 * Archive directories agree with the REQ status.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkArchiveConsistency(ctx: LintContext): Violation[] {
  const rule = 'archive-consistency'
  const out: Violation[] = []
  for (const req of ctx.graph.reqs.values()) {
    if (req.location === 'archive/done' && req.status !== 'done') {
      out.push({ file: req.label, rule, message: `in archive/done the status must be done; got ${quote(req.status)}` })
    }
    if (req.live && req.status === 'done') {
      out.push({ file: req.label, rule, message: 'a done REQ must move to archive/done, not stay in a live directory' })
    }
    if (req.location === 'archive/superseded' && asList(req.fm.superseded_by).length === 0) {
      out.push({ file: req.label, rule, message: 'in archive/superseded superseded_by must be set' })
    }
  }
  return out
}

/**
 * Every id belongs to one file; later copies in path order are named.
 * @param ctx - the lint context.
 * @returns the violations.
 */
export function checkArtifactUniqueness(ctx: LintContext): Violation[] {
  const out: Violation[] = []
  for (const [id, labels] of ctx.graph.duplicates) {
    const [first, ...others] = [...labels].sort()
    const kind = String(id.split('-')[0])
    for (const copy of others) {
      out.push({ file: copy, rule: 'artifact-uniqueness', message: `${kind} id ${id} duplicates ${String(first)}; ids are unique across the tasks tree` })
    }
  }
  return out
}
