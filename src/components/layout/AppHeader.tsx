import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, X, LogOut, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/context/auth-context";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex min-h-[3rem] w-full shrink-0 items-center justify-center px-5 text-sm font-semibold transition duration-200 sm:w-auto sm:px-6 sm:whitespace-nowrap",
    isActive
      ? "rounded-[0.9rem] bg-neon text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)]"
      : "rounded-[0.9rem] bg-white text-ink hover:bg-[#eef3ff] hover:text-neon"
  );

const actionClass =
  "inline-flex min-h-[3rem] w-full max-w-full shrink-0 items-center justify-center gap-2 rounded-[0.9rem] bg-white px-6 text-sm font-semibold text-ink transition duration-200 hover:bg-[#eef3ff] hover:text-neon sm:w-auto sm:whitespace-nowrap";

export function AppHeader() {
  const { isSignedIn, isAdmin, canViewItemOperations, role, session, signOut } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/signin");
  };

  const navLinks = (
    <>
      <NavLink to="/bidding" className={navLinkClass}>Auction desk</NavLink>
      <NavLink to="/dashboard" className={navLinkClass}>Dashboard</NavLink>
      <NavLink to="/my-bids" className={navLinkClass}>My bids</NavLink>
      {canViewItemOperations && <NavLink to="/admin/items" className={navLinkClass}>Items</NavLink>}
      {isAdmin && <NavLink to="/operations" className={navLinkClass}>Operations</NavLink>}
    </>
  );

  const accountLinks = (
    <>
      {isSignedIn && (
        <span className="inline-flex min-h-[3rem] w-full shrink-0 items-center justify-center rounded-[0.9rem] bg-[#eef3ff] px-4 text-sm font-semibold text-neon sm:w-auto sm:px-6 sm:whitespace-nowrap">
          Role: {role}
        </span>
      )}
      <NavLink to="/profile" className={actionClass}>
        <span className="min-w-0 truncate">{isSignedIn ? session.displayName : "Profile"}</span>
        <User size={16} />
      </NavLink>
      {isSignedIn ? (
        <button type="button" onClick={handleSignOut} className={actionClass}>
          <span className="min-w-0 truncate">Sign out</span>
          <LogOut size={16} />
        </button>
      ) : (
        <NavLink to="/signin" className={navLinkClass}>Sign in</NavLink>
      )}
    </>
  );

  return (
    <header className="bg-white px-4 py-4 md:px-6">
      <nav className="mx-auto flex w-full max-w-[112rem] flex-col items-center gap-4 rounded-[1.5rem] border border-ink/10 bg-white px-4 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] sm:rounded-[2rem] sm:px-5 lg:flex-row lg:flex-nowrap lg:justify-between lg:px-8">
        <div className="flex w-full items-center justify-between gap-4 lg:w-auto">
          <Link to="/" className="flex shrink-0 items-center gap-3">
            <img src="/slides/fmdq-logo.png" alt="FMDQ" className="h-10 w-auto sm:h-12" />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            className="inline-flex h-12 w-12 items-center justify-center rounded-[0.9rem] bg-[#eef3ff] text-neon lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
        <div className="hidden w-full items-center justify-center gap-2 lg:flex lg:w-auto lg:flex-1">
          {navLinks}
        </div>
        <div className="hidden w-full items-center justify-center gap-3 lg:flex lg:w-auto lg:flex-nowrap lg:justify-end">
          {accountLinks}
        </div>
        {mobileOpen && (
          <div className="w-full space-y-3 border-t border-ink/10 pt-4 lg:hidden">
            <div className="grid grid-cols-1 gap-2">{navLinks}</div>
            <div className="grid grid-cols-1 gap-3">{accountLinks}</div>
          </div>
        )}
      </nav>
    </header>
  );
}
