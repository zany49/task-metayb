import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAccessToken, setSessionExpiredHandler } from '../api/client.js';

/**
 * Keeps the signed-in session ({ token, user }) in memory and in localStorage,
 * so a page refresh keeps you signed in until the token expires.
 */
const STORAGE_KEY = 'relay.session';
const AuthContext = createContext(null);

function readStoredSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored?.token && stored?.user ? stored : null;
  } catch {
    return null;
  }
}

function storeSession(session) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the session then lasts until the tab closes.
  }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(readStoredSession);
  const [notice, setNotice] = useState(null);

  // Set synchronously so the very first request after sign-in already carries the token.
  setAccessToken(session?.token ?? null);

  const signIn = useCallback((newSession) => {
    storeSession(newSession);
    setAccessToken(newSession.token);
    setNotice(null);
    setSession(newSession);
  }, []);

  const signOut = useCallback(
    (message = null) => {
      storeSession(null);
      setAccessToken(null);
      queryClient.clear();
      setNotice(message);
      setSession(null);
    },
    [queryClient],
  );

  useEffect(() => {
    setSessionExpiredHandler((error) => {
      signOut(error.code === 'ACCOUNT_INACTIVE' ? 'This account has been deactivated.' : 'Your session has ended. Sign in again.');
    });
    return () => setSessionExpiredHandler(null);
  }, [signOut]);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, notice, signIn, signOut }),
    [session, notice, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Where each role lands after signing in. */
export const homePathFor = (user) => (user?.role === 'RIDER' ? '/me' : '/jobs');
