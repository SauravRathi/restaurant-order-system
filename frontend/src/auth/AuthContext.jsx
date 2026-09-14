// Who is signed in, for the whole app.
//
// The token is the session; this turns it into a user. On a cold load there is a token in
// localStorage and nothing else, so the first thing that happens is GET /auth/me — which the
// backend wrote specifically for this: it re-reads the row rather than echoing the token's
// claims, so a token whose account has since been removed stops working instead of describing
// a user who is not there.

import { createContext, use, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api/client.js';
import { clearToken, getToken, setToken, subscribeToToken } from '../api/token.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  // The token lives outside React, because a 401 on any request clears it — including one from
  // a background poll. Mirroring it into state is what makes the app re-render when that
  // happens, instead of carrying on as if the session were still good.
  const [token, setTokenState] = useState(getToken);
  useEffect(() => subscribeToToken(setTokenState), []);

  const {
    data: user,
    isPending,
    isError,
  } = useQuery({
    // Keyed on the token: signing in as someone else is a different key, so the previous user's
    // record can never be served out of the cache to the new one.
    queryKey: ['auth', 'me', token],
    queryFn: () => get('/auth/me').then((r) => r.user),
    enabled: token !== null,
    staleTime: Infinity,

    // A 401 here has already cleared the token inside the client, which flips `enabled` off.
    // Retrying would be asking again with a credential we just threw away.
    retry: false,
  });

  async function signIn(email, password) {
    const { token: issued, user: signedIn } = await post('/auth/login', { email, password });

    setToken(issued);
    // Seed the cache with the user the login already returned, under the key the query above
    // will look for. Without this the app would immediately spend a second round trip asking
    // /auth/me for something it was just handed.
    queryClient.setQueryData(['auth', 'me', issued], signedIn);
  }

  function signOut() {
    clearToken();
    // Tokens cannot be revoked, so signing out is local by definition — which makes clearing
    // the cache part of the job, not housekeeping. Leaving it would let the next person to use
    // this browser read the previous user's orders out of memory before any request is made.
    queryClient.clear();
  }

  const value = {
    user: user ?? null,
    // Only "loading" when there is a token to check. With no token there is nothing to wait
    // for and the login page should render immediately.
    isLoading: token !== null && isPending,
    // The token exists but /auth/me failed for a reason that is not 401 — the API is down, or
    // it 500'd. Distinct from signed-out, because the answer is "try again", not "sign in".
    isBroken: token !== null && isError,
    signIn,
    signOut,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** True for a manager. The server enforces this; the UI uses it to not offer what would 403. */
export const useIsManager = () => useAuth().user?.role === 'manager';
