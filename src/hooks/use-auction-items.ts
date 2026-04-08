import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getItems, getItem, getCategories, getLandingStats } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { getAuctionStatus } from "@/lib/auction-utils";
import type { AuctionItem } from "@/types";

export function useAuctionItems(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.items.list(includeArchived),
    queryFn: () => getItems(includeArchived),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

export function useAuctionItem(id: string | null, includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.items.detail(id ?? ""),
    queryFn: () => getItem(id!, includeArchived),
    enabled: !!id,
    refetchInterval: (query) => {
      const item = query.state.data as AuctionItem | undefined;
      if (!item) return 15_000;
      return getAuctionStatus(item) === "Closed" ? false : 10_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 8_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.items.categories(),
    queryFn: getCategories,
    staleTime: 5 * 60_000,
  });
}

export function useLandingStats() {
  return useQuery({
    queryKey: queryKeys.items.landingStats(),
    queryFn: getLandingStats,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 20_000,
  });
}

export function usePrefetchAuctionItem() {
  const queryClient = useQueryClient();
  return (id: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.items.detail(id),
      queryFn: () => getItem(id),
      staleTime: 8_000,
    });
  };
}
