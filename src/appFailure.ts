let writesInFlight = 0

// Counts saves that have left the browser but have not been answered, so recovery can say a change may be unconfirmed.
export async function trackWrite<T>(write: () => Promise<T>): Promise<T> {
  writesInFlight += 1
  try {
    return await write()
  } finally {
    writesInFlight -= 1
  }
}

export function hasUnconfirmedWrites(): boolean {
  return writesInFlight > 0
}

export type AppFailureKind = 'load' | 'render'

export function appFailureKind(error: unknown): AppFailureKind {
  const message = error instanceof Error ? error.message : ''
  return /dynamically imported module|importing a module script|module script failed|Loading chunk/i.test(message) ? 'load' : 'render'
}

// Operational hook for top-level failures. Reports only the failure kind and error class,
// never messages, stacks or household data, which can contain names, amounts or access secrets.
export function reportAppFailure(kind: AppFailureKind, error: unknown): void {
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error'
  console.error(`Roomlings could not open (${kind}: ${name}).`)
}
