/**
 * Lifecycle team tables: the lifecycle state table, the agent registry, and
 * the work-item id scheme, loaded from YAML with one problem per root cause
 * and derived instead of copied by every consumer.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-table
 */

export { loadIdScheme } from './id-scheme.ts'
export { effortFor, loadAgentRegistry, seatFor } from './registry.ts'
export {
  legalReqStatuses,
  loadLifecycleTable,
  reachableStates,
  requiredGates,
  roleStates,
  sensitiveKinds,
  signerOf,
  statusIndex,
  transitionById,
} from './table.ts'
export type * from './types.ts'
