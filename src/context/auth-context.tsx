import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession, logout as apiLogout } from "@/api/auth";
import { clearAuthSession, readAuthSession } from "@/lib/auth-session";
import { queryKeys } from "@/lib/query-keys";
import type { AuthSession, Role } from "@/types";
import { DEFAULT_SESSION } from "@/types";

type AuthContextValue = {
  session: AuthSession;
  isLoading: boolean;
  isSignedIn: boolean;
  role: Role;
  isAdmin: boolean;
  isShopOwner: boolean;
  isSuperAdmin: boolean;
  canBid: boolean;
  canViewReserve: boolean;
  canViewItemOperations: boolean;
  signOut: () => Promise<void>;
  invalidateSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: session = DEFAULT_SESSION, isLoading } = useQuery({
    queryKey: queryKeys.auth.session(),
    queryFn: getSession,
    initialData: readAuthSession(), // render immediately from sessionStorage
    staleTime: 60_000,             // 1 min — refetches quickly after sign-in/out
    retry: false,
  });

  const signOut = useCallback(async () => {
    await apiLogout();
    clearAuthSession();
    // Set session to guest immediately so UI updates before any re-fetch
    queryClient.setQueryData(queryKeys.auth.session(), DEFAULT_SESSION);
    // Wipe all other cached data so the new user starts fresh
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
  }, [queryClient]);

  const invalidateSession = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session() });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      isSignedIn: session.signedIn,
      role: session.role,
      isAdmin: session.role === "Admin" || session.role === "SuperAdmin",
      isShopOwner: session.role === "ShopOwner",
      isSuperAdmin: session.role === "SuperAdmin",
      canBid: session.role === "Bidder" || session.role === "Admin",
      canViewReserve: session.role === "Admin" || session.role === "SuperAdmin",
      canViewItemOperations: session.role === "ShopOwner" || session.role === "Admin" || session.role === "SuperAdmin",
      signOut,
      invalidateSession,
    }),
    [session, isLoading, signOut, invalidateSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
