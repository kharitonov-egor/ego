/** Words for the `error` the Worker puts on the sign-in return link. */
export function signInErrorMessage(reason: string | null | undefined): string {
  if (reason === 'cancelled') return 'Sign-in was cancelled.'
  if (reason === 'not_allowed') return 'That Google account is not allowed on this server. Choose the account listed in ALLOWED_EMAILS.'
  if (reason === 'expired') return 'That sign-in link expired or was already used. Try again.'
  return 'Google sign-in did not finish. Try again.'
}
