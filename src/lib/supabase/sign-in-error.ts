// Decides what the login page tells the user after a failed sign-in.
// Only a real credentials problem may say "Email or password is wrong". Anything else (project paused or restricted,
// rate limit, network or server error) is "unavailable", so a broken service is never mistaken for a wrong password.

export type SignInFailure = { code?: string; status?: number };

export function signInErrorKind(error: SignInFailure): 'invalid' | 'unavailable' {
  if (error.code === 'invalid_credentials' || error.code === 'user_not_found') return 'invalid';
  if (!error.code && (error.status === 400 || error.status === 401)) return 'invalid';
  return 'unavailable';
}
