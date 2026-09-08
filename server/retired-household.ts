import { householdSchema } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'

export function isRetiredHouseholdState(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'demo' in value && value.demo === true
}

export function parseStoredHousehold(state: string): Household | null {
  const value: unknown = JSON.parse(state)
  return isRetiredHouseholdState(value) ? null : householdSchema.parse(value)
}
