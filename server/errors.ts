export const apiMessages = {
  householdChanged: 'Kitchen changed. Review the latest details and try again.',
  deletionPending: 'Account deletion pending. Account access stays disabled.',
  signInUnavailable: 'Sign-in unavailable. Try again.',
  tooManyAttempts: 'Too many attempts. Wait a few minutes and try again.',
} as const

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
