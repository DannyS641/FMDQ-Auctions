import { Link } from "react-router-dom";
import { useAuth } from "@/context/auth-context";

export default function Landing() {
  const { isSignedIn } = useAuth();

  return (
    <section className="relative mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 px-6 py-12 md:grid-cols-[1.2fr_0.8fr]">
      <div className="relative z-10">
        <h1 className="mt-6 text-4xl font-semibold leading-tight text-ink md:text-5xl">
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
            className="rounded-[0.9rem] bg-neon px-6 py-3 text-sm font-semibold text-white"
          >
            Start bidding
          </Link>
          <Link
            to="/bidding"
            className="rounded-[0.9rem] border border-ink/20 px-6 py-3 text-sm font-semibold text-ink hover:bg-[#eef3ff]"
          >
            View auctions
          </Link>
        </div>
        <div className="mt-8 grid gap-6 text-slate md:grid-cols-3">
          <div>
            <p className="text-3xl font-semibold text-ink">326</p>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Active lots</p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-ink">74</p>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Verified bidders</p>
          </div>
          <div>
            <p className="text-3xl font-semibold text-ink">99.9%</p>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Account uptime</p>
          </div>
        </div>
      </div>
      <div className="relative z-10 h-full">
        <div className="relative h-full min-h-[400px] w-full overflow-hidden rounded-3xl bg-white">
          <img
            src="/slides/slide-1.jpg"
            alt="Auction preview"
            fetchPriority="high"
            className="slide-fade absolute inset-0 h-full w-full object-cover"
          />
          <img
            src="/slides/slide-2.jpg"
            alt="Auction preview"
            loading="lazy"
            className="slide-fade absolute inset-0 h-full w-full object-cover"
            style={{ animationDelay: "4s" }}
          />
          <img
            src="/slides/slide-3.jpg"
            alt="Auction preview"
            loading="lazy"
            className="slide-fade absolute inset-0 h-full w-full object-cover"
            style={{ animationDelay: "8s" }}
          />
        </div>
      </div>
    </section>
  );
}
