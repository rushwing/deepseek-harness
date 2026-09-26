import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_KINDS,
  acIdParts,
  derivedReqOf,
  idPrefixOf,
  idShapeOf,
  kindOf,
  locationOf,
  misplaced,
  reqOfSameNumber,
} from '@deepseek-ai/dsh-experimental-lifecycle-work-items'

describe('artifact ids', () => {
  it('recognises the five kinds by stem prefix and validates each id shape', () => {
    expect(ARTIFACT_KINDS).toEqual(['REQ', 'TC', 'BUG', 'RV', 'PL'])
    expect(kindOf('REQ-PLAT-007')).toBe('REQ')
    expect(kindOf('TC-PLAT-009-01')).toBe('TC')
    expect(kindOf('README')).toBeUndefined()
    expect(kindOf('REQUIREMENTS')).toBeUndefined()
    expect(idShapeOf('REQ').test('REQ-PLAT-007')).toBe(true)
    expect(idShapeOf('REQ').test('REQ-PLAT-7')).toBe(false)
    expect(idShapeOf('TC').test('TC-PLAT-009-01')).toBe(true)
    expect(idShapeOf('TC').test('TC-PLAT-009')).toBe(false)
    expect(idShapeOf('BUG').test('BUG-CBOM-003')).toBe(true)
    expect(idShapeOf('RV').test('RV-PLAT-009')).toBe(true)
    expect(idShapeOf('PL').test('PL-PLAT-009')).toBe(true)
    expect(idPrefixOf('TC-PLAT-009-01')).toBe('PLAT')
    expect(idPrefixOf('nope')).toBe('')
    expect(derivedReqOf('TC-PLAT-009-01')).toBe('REQ-PLAT-009')
    expect(derivedReqOf('TC-PLAT')).toBe('')
    expect(reqOfSameNumber('RV-PLAT-009')).toBe('REQ-PLAT-009')
    expect(reqOfSameNumber('PL-CBOM-021')).toBe('REQ-CBOM-021')
    expect(acIdParts('AC-PLAT-009-03')).toEqual({ prefix: 'PLAT', req: '009', order: 3 })
    expect(acIdParts('AC-PLAT-9-03')).toBeUndefined()
  })

  it('accepts only the canonical directories per kind and reports the offending one', () => {
    expect(misplaced(['features', 'platform'], 'REQ')).toBe('')
    expect(misplaced(['archive', 'done'], 'REQ')).toBe('')
    expect(misplaced(['archive', 'superseded'], 'REQ')).toBe('')
    expect(misplaced(['archive', 'staging'], 'REQ')).toBe('archive/staging')
    expect(misplaced(['features'], 'REQ')).toBe('features')
    expect(misplaced(['features', 'platform', 'deep'], 'REQ')).toBe('features/platform/deep')
    expect(misplaced(['test-cases', 'platform'], 'TC')).toBe('')
    expect(misplaced(['archive', 'done'], 'TC')).toBe('archive/done')
    expect(misplaced(['bugs', 'platform'], 'BUG')).toBe('')
    expect(misplaced(['reviews', 'platform'], 'RV')).toBe('')
    expect(misplaced(['plans', 'platform'], 'PL')).toBe('')
    expect(misplaced(['features', 'platform'], 'PL')).toBe('features/platform')
    expect(misplaced([], 'REQ')).toBe('(not under the tasks directory)')
  })

  it('locates archived files by their first directory segment', () => {
    expect(locationOf(['features', 'platform'])).toBe('live')
    expect(locationOf(['archive', 'done'])).toBe('archive/done')
    expect(locationOf(['archive', 'superseded'])).toBe('archive/superseded')
    expect(locationOf([])).toBe('live')
  })
})
