const failures = {
  connection: 'Connection lost.',
  unavailable: 'Server unavailable.',
  unreadable: 'Unreadable server response.',
  unexpected: 'Unexpected response.',
} as const

export function requestFailureMessage(failure: keyof typeof failures, method: string): string {
  const readOnly = ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  return `${failures[failure]}${readOnly ? '' : ' Request not confirmed.'} Try again.`
}
