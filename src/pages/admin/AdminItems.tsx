import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, RotateCcw, Archive } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { getItems, archiveItem, restoreItem } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { formatDate, formatMoney } from "@/lib/formatters";
import { getAuctionStatus } from "@/lib/auction-utils";

export default function AdminItems() {
  const queryClient = useQueryClient();
  const { data: items, isLoading, isError } = useQuery({
    queryKey: queryKeys.items.list(true),
    queryFn: () => getItems(true),
    staleTime: 10_000,
  });

  const refreshItems = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.items.all() });
  };

  const { mutate: archive, isPending: archiving } = useMutation({
    mutationFn: (id: string) => archiveItem(id),
    onSuccess: () => {
      toast.success("Item archived.");
      refreshItems();
    },
    onError: () => toast.error("Could not archive item."),
  });

  const { mutate: restore, isPending: restoring } = useMutation({
    mutationFn: (id: string) => restoreItem(id),
    onSuccess: () => {
      toast.success("Item restored.");
      refreshItems();
    },
    onError: () => toast.error("Could not restore item."),
  });

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Admin</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Items</h1>
            <p className="mt-2 text-sm text-slate">
              Review all auction items, edit existing listings, and create new ones.
            </p>
          </div>
          <Link to="/admin/items/new">
            <Button>
              <Plus size={16} />
              New item
            </Button>
          </Link>
        </div>

        {isLoading && <PageSpinner />}
        {isError && <ErrorMessage title="Could not load items" />}

        {!isLoading && !isError && (
          <Card className="overflow-hidden">
            {!items || items.length === 0 ? (
              <div className="px-6 py-10 text-sm text-slate">No auction items found yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ash text-left">
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Item</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Status</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Current bid</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">End date</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Archive</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {items.map((item) => {
                      const status = getAuctionStatus(item);
                      const isArchived = Boolean(item.archivedAt);
                      return (
                        <tr key={item.id} className="transition hover:bg-ash/40">
                          <td className="px-5 py-4">
                            <p className="font-semibold text-ink">{item.title}</p>
                            <p className="mt-1 text-xs text-slate">
                              {item.category} · Lot {item.lot} · {item.sku}
                            </p>
                          </td>
                          <td className="px-5 py-4">
                            <Badge status={status} />
                          </td>
                          <td className="px-5 py-4 font-semibold text-ink">
                            {item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids"}
                          </td>
                          <td className="px-5 py-4 text-slate">{formatDate(item.endTime)}</td>
                          <td className="px-5 py-4">
                            {isArchived ? (
                              <Badge status="closed" label="Archived" />
                            ) : (
                              <Badge status="active" label="Active" />
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <Link to={`/admin/items/${item.id}`}>
                                <Button variant="ghost" size="sm">
                                  <Pencil size={14} />
                                  Edit
                                </Button>
                              </Link>
                              {isArchived ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  isLoading={restoring}
                                  onClick={() => restore(item.id)}
                                >
                                  <RotateCcw size={14} />
                                  Restore
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  isLoading={archiving}
                                  onClick={() => archive(item.id)}
                                >
                                  <Archive size={14} />
                                  Archive
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </PageShell>
  );
}
