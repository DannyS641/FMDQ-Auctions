import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { placeBid } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { formatMoney } from "@/lib/formatters";
import type { AuctionItem } from "@/types";

type PlaceBidVars = {
  itemId: string;
  amount: number;
  expectedCurrentBid: number;
};

export function usePlaceBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, amount, expectedCurrentBid }: PlaceBidVars) =>
      placeBid(itemId, amount, expectedCurrentBid),

    onMutate: async ({ itemId, amount }) => {
      // Cancel any in-flight refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.items.detail(itemId) });
      const previous = queryClient.getQueryData<AuctionItem>(queryKeys.items.detail(itemId));

      // Optimistically update the current bid
      queryClient.setQueryData<AuctionItem>(queryKeys.items.detail(itemId), (old) =>
        old ? { ...old, currentBid: amount } : old
      );

      return { previous };
    },

    onError: (error, { itemId }, context) => {
      // Roll back the optimistic update
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.items.detail(itemId), context.previous);
      }
      toast.error(error instanceof Error ? error.message : "Bid failed. Please try again.");
    },

    onSuccess: (updatedItem, { itemId }) => {
      // Commit the authoritative server response
      queryClient.setQueryData(queryKeys.items.detail(itemId), updatedItem);
      // Also refresh the list so bid count / current bid is accurate
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.list() });
      toast.success(`Bid of ${formatMoney(updatedItem.currentBid)} placed successfully.`);
    },
  });
}
