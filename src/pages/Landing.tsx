import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { useLandingStats } from "@/hooks/use-auction-items";
import { getSlides, getSiteSettings } from "@/api/slides";
import { queryKeys } from "@/lib/query-keys";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function Landing() {
  const { isSignedIn } = useAuth();
  const { data: stats } = useLandingStats();
  const { data: slides = [] } = useQuery({
    queryKey: queryKeys.content.slides("landing"),
    queryFn: () => getSlides("landing"),
    staleTime: 5 * 60_000,
  });
  const { data: settings } = useQuery({
    queryKey: queryKeys.content.settings(),
    queryFn: getSiteSettings,
    staleTime: 5 * 60_000,
  });
  const cycleSeconds = (settings?.slideDurationSeconds ?? 4) * slides.length;

  return (
    <section className="relative mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 px-6 py-12 md:grid-cols-[1.2fr_0.8fr]">
      <div className="relative z-10">
        <h1 className="mt-6 text-[33px] font-semibold leading-tight text-neon md:text-[45px]">
          <span className="text-neon">DISCOVER</span> .{" "}
          <span className="text-slate">BID</span> .{" "}
          <span className="text-gold">OWN</span>
        </h1>
        <p className="mt-4 max-w-xl text-base text-slate">
          Centralise listings, enforce bidding rules, and let registered
          members compete in real time with account-based access and
          transparent workflows.
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <Link
            to={isSignedIn ? "/bidding" : "/signin"}
            className="rounded-none bg-neon px-6 py-3 text-sm font-semibold text-white"
          >
            Start bidding
          </Link>
          <Link
            to="/bidding"
            className="rounded-none border border-ink/20 px-6 py-3 text-sm font-semibold text-ink hover:bg-[#eef3ff]"
          >
            View auctions
          </Link>
        </div>
        <div className="mt-8 grid gap-6 text-slate md:grid-cols-3">
          <div>
            <p className="text-3xl font-semibold text-ink">{stats?.activeLots ?? "—"}</p>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Active lots</p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-ink">{stats?.verifiedBidders ?? "—"}</p>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Verified bidders</p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-ink">{stats?.accountUptime ?? "—"}</p>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Account uptime</p>
          </div>
        </div>
      </div>
      <div className="relative z-10 h-full">
        <div className="relative h-full min-h-[400px] w-full overflow-hidden rounded-3xl bg-white">
          {slides.map((slide, index) => (
            <img
              key={slide.id}
              src={`${API_BASE}${slide.url}`}
              alt="Auction preview"
              fetchPriority={index === 0 ? "high" : undefined}
              loading={index === 0 ? undefined : "lazy"}
              className="slide-fade absolute inset-0 h-full w-full object-cover"
              style={{
                animationDuration: `${cycleSeconds}s`,
                animationDelay: `${index * (cycleSeconds / slides.length)}s`,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
