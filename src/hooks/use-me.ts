import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getMyProfile,
  getMySessions,
  revokeSession,
  revokeOtherSessions,
} from "@/api/auth";
import { getMyDashboard, getMyBids, getMyWins } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";

export function useMyProfile() {
  return useQuery({
    queryKey: queryKeys.me.profile(),
    queryFn: getMyProfile,
    staleTime: 2 * 60_000,
  });
}

export function useMySessions() {
  return useQuery({
    queryKey: queryKeys.me.sessions(),
    queryFn: getMySessions,
    staleTime: 60_000,
  });
}

export function useMyDashboard() {
  return useQuery({
    queryKey: queryKeys.me.dashboard(),
    queryFn: getMyDashboard,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useMyBids() {
  return useQuery({
    queryKey: queryKeys.me.bids(),
    queryFn: getMyBids,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useMyWins() {
  return useQuery({
    queryKey: queryKeys.me.wins(),
    queryFn: getMyWins,
    staleTime: 60_000,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.sessions() });
      toast.success("Session revoked.");
    },
    onError: () => toast.error("Failed to revoke session."),
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.sessions() });
      toast.success(`Revoked ${result.count ?? 0} other session(s).`);
    },
    onError: () => toast.error("Failed to revoke sessions."),
  });
}
