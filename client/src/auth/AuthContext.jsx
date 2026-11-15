import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthContext } from "./auth-context";
import {
  clearStoredSession,
  readStoredSession,
  SESSION_EVENT,
  storeSession,
} from "../lib/api";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readStoredSession);
  const sessionRef = useRef(session);

  useEffect(() => {
    const expireSession = () => {
      sessionRef.current = null;
      setSession(null);
    };
    window.addEventListener(SESSION_EVENT, expireSession);
    return () => window.removeEventListener(SESSION_EVENT, expireSession);
  }, []);

  const updateUser = useCallback((user) => {
    const current = sessionRef.current;
    if (!current?.token) return;
    storeSession(current.token, user);
    const next = { ...current, user };
    sessionRef.current = next;
    setSession(next);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: Boolean(session?.token),
      signIn(token, user) {
        storeSession(token, user);
        const next = { token, user };
        sessionRef.current = next;
        setSession(next);
      },
      updateUser,
      signOut() {
        clearStoredSession();
        sessionRef.current = null;
        setSession(null);
      },
    }),
    [session, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
