import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Star, Upload } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { getItems, archiveItem, restoreItem, bulkImportItems } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { formatDate, formatMoney } from "@/lib/formatters";
import { getAuctionStatus } from "@/lib/auction-utils";
import type { BulkImportReport } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function AdminItems() {
  const queryClient = useQueryClient();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [importReport, setImportReport] = useState<BulkImportReport | null>(null);
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

  const { mutate: importItems, isPending: importing } = useMutation({
    mutationFn: async () => {
      if (!csvFile) throw new Error("Upload a CSV file first.");
      const formData = new FormData();
      formData.append("csv", csvFile);
      if (zipFile) formData.append("bundle", zipFile);
      return bulkImportItems(formData);
    },
    onSuccess: (report) => {
      setImportReport(report);
      toast.success(`Imported ${report.created} item(s).`);
      setCsvFile(null);
      setZipFile(null);
      if (csvInputRef.current) csvInputRef.current.value = "";
      if (zipInputRef.current) zipInputRef.current.value = "";
      refreshItems();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Bulk import failed.");
    },
  });

  if (isLoading) {
    return (
      <PageShell>
        <PageSpinner label="Loading items" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Admin</p>
            <h1 className="mt-2 text-[27px] font-semibold text-neon">Items</h1>
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

        <Card>
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Bulk upload</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Import multiple items</h2>
              <p className="mt-2 text-sm text-slate">
                Upload a CSV for item rows and an optional ZIP bundle for images/documents referenced by the CSV.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">
                  Items CSV
                </label>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">
                  Assets ZIP (optional)
                </label>
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink"
                />
              </div>
              <Button variant="secondary" isLoading={importing} disabled={!csvFile} onClick={() => importItems()}>
                <Upload size={16} />
                Import items
              </Button>
            </div>

            {importReport && (
              <div className="rounded-2xl border border-ink/10 bg-ash/40 p-4">
                <p className="text-sm font-semibold text-ink">
                  Import result: {importReport.created} created, {importReport.skipped} skipped, {importReport.failed} failed
                </p>
                <div className="mt-3 space-y-2 text-xs text-slate">
                  {importReport.items.slice(0, 8).map((entry, index) => (
                    <div key={`${entry.row}-${index}`} className="rounded-xl bg-white px-3 py-2">
                      Row {entry.row}: {entry.title || "Untitled"} — {entry.message}
                    </div>
                  ))}
                  {importReport.items.length > 8 && (
                    <p>Showing first 8 rows of {importReport.items.length}.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        {isError && <ErrorMessage title="Could not load items" />}

        {!isError && (
          <Card className="overflow-hidden">
            {!items || items.length === 0 ? (
              <div className="px-6 py-10 text-sm text-slate">No auction items found yet.</div>
            ) : (
              <div className="w-full">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ash text-left">
                      <th className="w-10 px-3 py-3">
                        <input type="checkbox" aria-label="Select all items" className="h-4 w-4 rounded border-ink/20 accent-neon" />
                      </th>
                      <th className="w-[32%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Name</th>
                      <th className="w-[10%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">SKU</th>
                      <th className="w-[8%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Availability</th>
                      <th className="w-[15%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Price</th>
                      <th className="w-[12%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Categories</th>
                      <th className="hidden xl:table-cell w-[12%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Tags</th>
                      <th className="hidden 2xl:table-cell w-[4%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate text-center">
                        <Star size={14} className="mx-auto text-slate" />
                      </th>
                      <th className="w-[11%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Date</th>
                      <th className="w-[10%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Author</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {items.map((item) => {
                      const status = getAuctionStatus(item);
                      const isArchived = Boolean(item.archivedAt);
                      const imageUrl = item.images[0]?.url ? `${API_BASE}${item.images[0].url}` : "";
                      const priceLabel =
                        item.currentBid > 0
                          ? `Winning bid: ${formatMoney(item.currentBid)}`
                          : `Starting bid: ${formatMoney(item.startBid)}`;
                      const publishLabel = isArchived ? "Archived" : status === "Upcoming" ? "Scheduled" : "Published";
                      const stockLabel = isArchived ? "Archived" : "Listed";
                      const tagLabel = [item.condition, item.location].filter(Boolean).join(" · ");
                      return (
                        <tr key={item.id} className="transition hover:bg-ash/40">
                          <td className="px-3 py-4 align-top">
                            <input
                              type="checkbox"
                              aria-label={`Select ${item.title}`}
                              className="h-4 w-4 rounded border-ink/20 accent-neon"
                            />
                          </td>
                          <td className="px-3 py-4 align-top">
                            <div className="flex gap-3">
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink/10 bg-ash">
                                {imageUrl ? (
                                  <img src={imageUrl} alt={item.title} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="text-[10px] text-slate">No image</div>
                                )}
                              </div>
                              <div className="min-w-0 overflow-hidden">
                                <Link to={`/admin/items/${item.id}`} className="line-clamp-2 font-semibold text-neon hover:underline">
                                  {item.title}
                                </Link>
                                <p className="mt-1 text-xs text-slate">Lot: {item.lot}</p>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                  <Link to={`/admin/items/${item.id}`} className="text-neon hover:underline">Edit</Link>
                                  <Link to={`/bidding/${item.id}`} className="text-neon hover:underline">Preview</Link>
                                  {isArchived ? (
                                    <button
                                      type="button"
                                      onClick={() => restore(item.id)}
                                      className="text-neon hover:underline"
                                      disabled={restoring}
                                    >
                                      Restore
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => archive(item.id)}
                                      className="text-red-600 hover:underline"
                                      disabled={archiving}
                                    >
                                      Archive
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top text-slate break-words">
                            {item.sku || "—"}
                          </td>
                          <td className="px-3 py-4 align-top">
                            {isArchived ? (
                              <span className="text-xs font-semibold text-red-600">Archived</span>
                            ) : (
                              <span className="text-xs font-semibold text-emerald-600">{stockLabel}</span>
                            )}
                          </td>
                          <td className="px-3 py-4 align-top text-slate">
                            <div>{priceLabel}</div>
                            {item.reserve != null && item.reserve > 0 && (
                              <div className="mt-1 text-xs">Reserve: {formatMoney(item.reserve)}</div>
                            )}
                          </td>
                          <td className="px-3 py-4 align-top text-neon break-words">{item.category}</td>
                          <td className="hidden xl:table-cell px-3 py-4 align-top text-slate">
                            <div className="line-clamp-2">{tagLabel || "—"}</div>
                          </td>
                          <td className="hidden 2xl:table-cell px-3 py-4 align-top text-center text-slate">
                            <Star size={16} className="mx-auto" />
                          </td>
                          <td className="px-3 py-4 align-top text-slate">
                            <div>{publishLabel}</div>
                            <div className="mt-1 text-xs">{formatDate(item.endTime)}</div>
                          </td>
                          <td className="px-3 py-4 align-top text-neon">
                            <div className="line-clamp-2">Oluwanifemi Oso</div>
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
