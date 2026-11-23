import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const u = await api.get("/api/auth/me");
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("mboa:unauthorized", onUnauthorized);
    return () => window.removeEventListener("mboa:unauthorized", onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/api/auth/logout"); } catch { /* session déjà close */ }
    setUser(null);
  }, []);

  const can = useCallback(
    (permission) => Boolean(user?.permissions?.includes(permission)),
    [user]
  );

  const value = useMemo(
    () => ({ user, setUser, ready, refresh, logout, can, permissions: user?.permissions || [] }),
    [user, ready, refresh, logout, can]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function usePermission(permission) {
  const { can } = useAuth();
  return can(permission);
}
