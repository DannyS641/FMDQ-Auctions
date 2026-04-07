import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getAdminUsers,
  getRoles,
  assignRole,
  removeRole,
  disableUser,
  enableUser,
  forcePasswordReset,
  bulkPasswordReset,
  bulkImportUsers,
  getOperations,
  getAudits,
  getNotifications,
  processNotifications,
} from "@/api/admin";
import { queryKeys } from "@/lib/query-keys";

export function useAdminUsers() {
  return useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: getAdminUsers,
    staleTime: 30_000,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.admin.roles(),
    queryFn: getRoles,
    staleTime: 10 * 60_000,
  });
}

export function useOperations() {
  return useQuery({
    queryKey: queryKeys.admin.operations(),
    queryFn: getOperations,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useAudits(filters: Record<string, string> = {}) {
  return useQuery({
    queryKey: queryKeys.admin.audits(filters),
    queryFn: () => getAudits(filters),
    staleTime: 30_000,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.admin.notifications(),
    queryFn: getNotifications,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleName }: { userId: string; roleName: string }) =>
      assignRole(userId, roleName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success("Role assigned.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to assign role."),
  });
}

export function useRemoveRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleName }: { userId: string; roleName: string }) =>
      removeRole(userId, roleName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success("Role removed.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove role."),
  });
}

export function useDisableUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      disableUser(userId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success("User disabled.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to disable user."),
  });
}

export function useEnableUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => enableUser(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success("User enabled.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to enable user."),
  });
}

export function useForcePasswordReset() {
  return useMutation({
    mutationFn: (userId: string) => forcePasswordReset(userId),
    onSuccess: () => toast.success("Password reset email queued."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to queue reset."),
  });
}

export function useBulkPasswordReset() {
  return useMutation({
    mutationFn: (vars: { scope: "all" | "role" | "selected"; role?: string; userIds?: string[] }) =>
      bulkPasswordReset(vars.scope, vars.role, vars.userIds),
    onSuccess: (result) => toast.success(`Queued resets for ${result.count ?? 0} user(s).`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Bulk reset failed."),
  });
}

export function useBulkImportUsers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => bulkImportUsers(file),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success(`Import complete: ${report.created} created, ${report.skipped} skipped, ${report.failed} failed.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });
}

export function useProcessNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: processNotifications,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
      toast.success(`Processed ${result.processed} notification(s).`);
    },
    onError: () => toast.error("Failed to process notifications."),
  });
}
