import { createDemo, getHousehold, RequestError } from './api.ts'
import type { Session } from '../shared/domain.ts'

const sampleKey = 'roomlings.sample-session'

export function rememberSample(session: Session): void {
  if (!session.household.demo) throw new Error('Personal household access cannot be saved as a sample.')
  localStorage.setItem(sampleKey, session.token)
}

export async function restoreSample(): Promise<{ session: Session; renewed?: true }> {
  const token = localStorage.getItem(sampleKey)
  if (token) {
    try {
      const current = await getHousehold(token)
      if (!current.household.demo) throw new Error('This sample shortcut points to a personal household. Open your home instead.')
      return { session: { token, ...current } }
    } catch (failure) {
      if (!(failure instanceof RequestError) || failure.status !== 401) throw failure
      return { session: await createDemo(), renewed: true }
    }
  }
  return { session: await createDemo() }
}
