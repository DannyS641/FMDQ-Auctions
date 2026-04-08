import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/layout/PageShell";
import { AuctionCard } from "@/components/auction/AuctionCard";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuctionItems, useCategories, usePrefetchAuctionItem } from "@/hooks/use-auction-items";
import { useAuth } from "@/context/auth-context";
import { getAuctionStatus } from "@/lib/auction-utils";

export default function BiddingDesk() {
  const { data: items, isLoading, isError } = useAuctionItems();
  const { data: categories = [] } = useCategories();
  const prefetch = usePrefetchAuctionItem();
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedCondition, setSelectedCondition] = useState("all");
  const [activeTab, setActiveTab] = useState("all");

  const conditions = useMemo(() => {
    if (!items) return [];
    return [...new Set(items.map((i) => i.condition).filter(Boolean))];
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((item) => {
      const status = getAuctionStatus(item);
      if (activeTab !== "all" && status !== activeTab) return false;
      if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
      if (selectedCondition !== "all" && item.condition !== selectedCondition) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!item.title.toLowerCase().includes(q) && !item.lot.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, activeTab, selectedCategory, selectedCondition, search]);

  const liveCount = useMemo(() => (items ?? []).filter((i) => getAuctionStatus(i) === "Live").length, [items]);
  const closingSoonCount = useMemo(() => {
    const threshold = Date.now() + 30 * 60 * 1000;
    return (items ?? []).filter((i) => {
      const end = new Date(i.endTime).getTime();
      return getAuctionStatus(i) === "Live" && end <= threshold;
    }).length;
  }, [items]);

  const clearFilters = () => {
    setSearch("");
    setSelectedCategory("all");
    setSelectedCondition("all");
    setActiveTab("all");
  };

  if (isLoading) {
    return (
      <PageShell>
        <PageSpinner />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <aside className="space-y-4 rounded-3xl border border-ink/10 bg-white p-4 lg:self-start">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-slate">
            <span>Filters</span>
            <button type="button" onClick={clearFilters} className="text-ink tracking-normal hover:text-neon">Clear</button>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate">Search</p>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items"
              className="mt-2 w-full rounded-2xl border border-ink/10 bg-ink/5 px-4 py-2 text-sm text-ink placeholder:text-slate/60 focus:outline-none focus:ring-2 focus:ring-neon"
            />
          </div>
          {categories.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate">Categories</p>
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-2 text-sm text-slate">
                <label className="flex items-center gap-2 cursor-pointer hover:text-ink">
                  <input type="radio" name="category" checked={selectedCategory === "all"} onChange={() => setSelectedCategory("all")} className="accent-neon" />
                  All categories
                </label>
                {categories.map((c) => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer hover:text-ink">
                    <input type="radio" name="category" checked={selectedCategory === c} onChange={() => setSelectedCategory(c)} className="accent-neon" />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          )}
          {conditions.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate">Condition</p>
              <div className="mt-3 max-h-32 space-y-2 overflow-y-auto pr-2 text-sm text-slate">
                <label className="flex items-center gap-2 cursor-pointer hover:text-ink">
                  <input type="radio" name="condition" checked={selectedCondition === "all"} onChange={() => setSelectedCondition("all")} className="accent-neon" />
                  All conditions
                </label>
                {conditions.map((c) => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer hover:text-ink">
                    <input type="radio" name="condition" checked={selectedCondition === c} onChange={() => setSelectedCondition(c)} className="accent-neon" />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Main content */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Auction lots</p>
              <h1 className="mt-2 text-3xl font-semibold text-ink">Active listings</h1>
              <p className="mt-2 text-sm text-slate">{filtered.length} items found</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-[0.9rem] border border-ink/10 bg-white px-4 py-2 text-xs text-slate">
                <span className="font-semibold text-ink">{liveCount}</span> live ·{" "}
                <span className="font-semibold text-ink">{closingSoonCount}</span> closing soon
              </div>
            </div>
          </div>

          {/* Status tabs */}
          <div className="mt-6 flex flex-wrap gap-2">
            {(["all", "Live", "Upcoming", "Closed"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-[0.9rem] px-4 py-2 text-xs font-semibold capitalize transition duration-200 ${
                  activeTab === tab
                    ? "bg-neon text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)]"
                    : "border border-ink/10 bg-white text-ink hover:bg-[#eef3ff] hover:text-neon"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Grid */}
          {isError && (
            <div className="mt-10 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
              Unable to load auction items right now. Please refresh the page.
            </div>
          )}
          {!isError && filtered.length === 0 && (
            <div className="mt-10 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
              No items match the current filters.
            </div>
          )}
          {!isError && filtered.length > 0 && (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item) => (
                <AuctionCard key={item.id} item={item} onMouseEnter={() => prefetch(item.id)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Admin section */}
      {isAdmin && (
        <section className="mt-12 rounded-3xl border border-ink/10 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Admin</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">Manage auction items</h2>
              <p className="mt-2 text-sm text-slate">Create new listings, edit current items, and inspect the notification queue from dedicated admin workspaces.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/operations" className="rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200">
                Open operations
              </Link>
              <Link to="/admin/items" className="rounded-[0.9rem] bg-neon px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)] transition duration-200 hover:bg-neon/90">
                Open item manager
              </Link>
            </div>
          </div>
        </section>
      )}
    </PageShell>
  );
}
