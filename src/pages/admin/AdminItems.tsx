import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Plus, Upload } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useAuth } from "@/context/auth-context";
import { getItems, archiveItem, restoreItem, bulkImportItems, exportItemsCsv } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { formatDate, formatMoney } from "@/lib/formatters";
import { getAuctionStatus, getReserveOutcome } from "@/lib/auction-utils";
import { ApiError } from "@/lib/api-client";
import type { BulkImportReport } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
type ListingFilter = "all" | "live" | "upcoming" | "closed" | "archived";
type OutcomeFilter = "all" | "no-bids" | "has-bids" | "wins" | "reserve-met" | "reserve-pending" | "reserve-not-met";

const escapeCsvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

const downloadBulkImportTemplate = () => {
  const headers = [
    "title",
    "category",
    "lot",
    "sku",
    "condition",
    "location",
    "start_bid",
    "reserve",
    "increment",
    "start_time",
    "end_time",
    "description",
    "image1",
    "image2",
    "document1",
    "document1_visibility",
  ];

  const rows = [
    [
      "Toyota Corolla 2018",
      "Cars",
      "CAR-018",
      "FMDQ-CAR-018",
      "New",
      "Lagos Warehouse",
      100000,
      120000,
      5000,
      "2026-04-20T09:00",
      "2026-04-22T17:00",
      "Clean 2018 Toyota Corolla with low mileage.",
      "",
      "",
      "",
      "bidder_visible",
    ],
    [
      "Samsung 65 inch UHD Smart TV",
      "Household Appliances",
      "HAP-210",
      "FMDQ-HAP-210",
      "Used",
      "Abuja Hub",
      180000,
      0,
      10000,
      "2026-04-21T10:30",
      "2026-04-23T16:00",
      "65-inch UHD smart television with remote and wall mount.",
      "",
      "",
      "",
      "admin_only",
    ],
  ];

  const csv = [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvCell(value)).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "items-bulk-import-template.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const isBulkImportReport = (value: unknown): value is BulkImportReport => {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<BulkImportReport>;
  return (
    typeof report.created === "number" &&
    typeof report.skipped === "number" &&
    typeof report.failed === "number" &&
    Array.isArray(report.items)
  );
};

export default function AdminItems() {
  const { isAdmin, isShopOwner } = useAuth();
  const queryClient = useQueryClient();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [importReport, setImportReport] = useState<BulkImportReport | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedListingState, setSelectedListingState] = useState<ListingFilter>("all");
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeFilter>("all");
  const { data: items, isLoading, isError } = useQuery({
    queryKey: queryKeys.items.list(isAdmin),
    queryFn: () => getItems(isAdmin),
    staleTime: 10_000,
  });

  const categoryOptions = useMemo(
    () => Array.from(new Set((items ?? []).map((item) => item.category).filter(Boolean))).sort(),
    [items]
  );

  const filteredItems = useMemo(() => {
    return (items ?? []).filter((item) => {
      const status = getAuctionStatus(item);
      const isArchived = Boolean(item.archivedAt);
      const reserveOutcome = getReserveOutcome(item).toLowerCase();
      const hasBids = item.currentBid > 0;
      const isWin = status === "Closed" && hasBids && reserveOutcome !== "reserve not met";

      if (selectedCategory !== "all" && item.category !== selectedCategory) return false;

      if (selectedListingState === "archived" && !isArchived) return false;
      if (selectedListingState !== "all" && selectedListingState !== "archived") {
        if (isArchived) return false;
        if (status.toLowerCase() !== selectedListingState) return false;
      }

      if (selectedOutcome === "no-bids" && hasBids) return false;
      if (selectedOutcome === "has-bids" && !hasBids) return false;
      if (selectedOutcome === "wins" && !isWin) return false;
      if (selectedOutcome === "reserve-met" && reserveOutcome !== "reserve met") return false;
      if (selectedOutcome === "reserve-pending" && reserveOutcome !== "reserve pending") return false;
      if (selectedOutcome === "reserve-not-met" && reserveOutcome !== "reserve not met") return false;

      return true;
    });
  }, [items, selectedCategory, selectedListingState, selectedOutcome]);

  const refreshItems = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.items.all() });
  };

  const handleExportAuctionDetails = async () => {
    try {
      const blob = await exportItemsCsv();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `auction-details-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Auction details exported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export auction details.");
    }
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
      if (error instanceof ApiError && isBulkImportReport(error.payload)) {
        setImportReport(error.payload);
        const firstFailure = error.payload.items.find((entry) => entry.status === "failed")?.message;
        toast.error(firstFailure ?? error.message);
        return;
      }
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
            <p className="text-xs uppercase tracking-[0.3em] text-slate">{isShopOwner ? "Shop owner" : "Admin"}</p>
            <h1 className="mt-2 text-[27px] font-semibold text-neon">Items</h1>
            <p className="mt-2 text-sm text-slate">
              {isAdmin
                ? "Review all auction items, edit existing listings, and create new ones."
                : "Review auction listings, inspect bid activity, and export auction details."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void handleExportAuctionDetails()}>
              Export auction details
            </Button>
            {isAdmin && (
              <Button variant="secondary" onClick={downloadBulkImportTemplate}>
                <Download size={16} />
                Bulk import template
              </Button>
            )}
            {isAdmin && (
              <Link to="/admin/items/new">
                <Button>
                  <Plus size={16} />
                  New item
                </Button>
              </Link>
            )}
          </div>
        </div>

        {isAdmin && (
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
        )}

        {isError && <ErrorMessage title="Could not load items" />}

        {!isError && (
          <Card className="overflow-hidden">
            <div className="border-b border-ink/10 bg-white px-4 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-[11rem]">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">
                      Category
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(event) => setSelectedCategory(event.target.value)}
                      className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink"
                    >
                      <option value="all">All categories</option>
                      {categoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-[11rem]">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">
                      Listing state
                    </label>
                    <select
                      value={selectedListingState}
                      onChange={(event) => setSelectedListingState(event.target.value as ListingFilter)}
                      className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink"
                    >
                      <option value="all">All states</option>
                      <option value="live">Live</option>
                      <option value="upcoming">Upcoming</option>
                      <option value="closed">Closed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div className="min-w-[11rem]">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">
                      Outcome
                    </label>
                    <select
                      value={selectedOutcome}
                      onChange={(event) => setSelectedOutcome(event.target.value as OutcomeFilter)}
                      className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink"
                    >
                      <option value="all">All outcomes</option>
                      <option value="no-bids">No bids</option>
                      <option value="has-bids">Has bids</option>
                      <option value="wins">Wins</option>
                      <option value="reserve-met">Reserve met</option>
                      <option value="reserve-pending">Reserve pending</option>
                      <option value="reserve-not-met">Reserve not met</option>
                    </select>
                  </div>
                </div>
                <p className="text-sm text-slate">
                  Showing {filteredItems.length} of {items?.length ?? 0} item(s)
                </p>
              </div>
            </div>
            {!filteredItems || filteredItems.length === 0 ? (
              <div className="px-6 py-10 text-sm text-slate">No auction items found yet.</div>
            ) : (
              <div className="w-full">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ash text-left">
                      {isAdmin ? (
                        <th className="w-8 px-2 py-3">
                          <input type="checkbox" aria-label="Select all items" className="h-4 w-4 rounded border-ink/20 accent-neon" />
                        </th>
                      ) : null}
                      <th className={`${isAdmin ? "w-[28%]" : "w-[31%]"} px-2 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate`}>Name</th>
                      <th className="w-[10%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate">SKU</th>
                      <th className="w-[9%] px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">Availability</th>
                      <th className="w-[14%] px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">Price</th>
                      <th className="w-[10%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate">Categories</th>
                      <th className="hidden 2xl:table-cell w-[7%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate">Tags</th>
                      <th className="w-[10%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate">Date</th>
                      <th className="w-[10%] px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate">Author</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {filteredItems.map((item) => {
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
                          {isAdmin ? (
                            <td className="px-2 py-4 align-top">
                              <input
                                type="checkbox"
                                aria-label={`Select ${item.title}`}
                                className="h-4 w-4 rounded border-ink/20 accent-neon"
                              />
                            </td>
                          ) : null}
                          <td className="px-2 py-4 align-top">
                            <div className="flex gap-2.5">
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink/10 bg-ash">
                                {imageUrl ? (
                                  <img src={imageUrl} alt={item.title} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="text-[10px] text-slate">No image</div>
                                )}
                              </div>
                              <div className="min-w-0 overflow-hidden">
                                <Link to={isAdmin ? `/admin/items/${item.id}` : `/bidding/${item.id}`} className="line-clamp-2 font-semibold text-neon hover:underline">
                                  {item.title}
                                </Link>
                                <p className="mt-1 text-xs text-slate">Lot: {item.lot}</p>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                  <Link to={`/bidding/${item.id}`} className="text-neon hover:underline">Preview</Link>
                                  {isAdmin ? (
                                    <>
                                      <Link to={`/admin/items/${item.id}`} className="text-neon hover:underline">Edit</Link>
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
                                    </>
                                  ) : null}
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
                          <td className="hidden 2xl:table-cell px-3 py-4 align-top text-slate">
                            <div className="line-clamp-2">{tagLabel || "—"}</div>
                          </td>
                          <td className="px-3 py-4 align-top text-slate">
                            <div>{publishLabel}</div>
                            <div className="mt-1 text-xs">{formatDate(item.endTime)}</div>
                          </td>
                          <td className="px-3 py-4 align-top text-neon">
                            <div className="whitespace-normal break-words">Oluwanifemi Oso</div>
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
