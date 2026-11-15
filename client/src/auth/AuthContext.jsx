import { useEffect, useMemo, useState } from "react";
import { AuthContext } from "./auth-context";
import {
  clearStoredSession,
  readStoredSession,
  SESSION_EVENT,
  storeSession,
} from "../lib/api";

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readStoredSession);

  useEffect(() => {
    const expireSession = () => setSession(null);
    window.addEventListener(SESSION_EVENT, expireSession);
    return () => window.removeEventListener(SESSION_EVENT, expireSession);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: Boolean(session?.token),
      signIn(token, user) {
        storeSession(token, user);
        setSession({ token, user });
      },
      signOut() {
        clearStoredSession();
        setSession(null);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
