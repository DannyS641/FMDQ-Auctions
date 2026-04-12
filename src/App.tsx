import { Suspense } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { ProtectedRoute } from "@/components/routing/ProtectedRoute";
import { AdminRoute } from "@/components/routing/AdminRoute";
import { ItemOperationsRoute } from "@/components/routing/ItemOperationsRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { Footer } from "@/components/layout/Footer";
import { PageSpinner } from "@/components/ui/Spinner";
import { useInactivityTimeout } from "@/hooks/use-inactivity-timeout";
import { lazyWithRetry } from "@/lib/lazy-with-retry";

// Public pages
const Landing = lazyWithRetry(() => import("@/pages/Landing"), "Landing");
const SignIn = lazyWithRetry(() => import("@/pages/auth/SignIn"), "SignIn");
const SignUp = lazyWithRetry(() => import("@/pages/auth/SignUp"), "SignUp");
const Verify = lazyWithRetry(() => import("@/pages/auth/Verify"), "Verify");
const ResetPassword = lazyWithRetry(() => import("@/pages/auth/ResetPassword"), "ResetPassword");
const BiddingDesk = lazyWithRetry(() => import("@/pages/auction/BiddingDesk"), "BiddingDesk");
const ItemDetail = lazyWithRetry(() => import("@/pages/auction/ItemDetail"), "ItemDetail");
const Closed = lazyWithRetry(() => import("@/pages/auction/Closed"), "Closed");

// Authenticated pages
const Dashboard = lazyWithRetry(() => import("@/pages/user/Dashboard"), "Dashboard");
const MyBids = lazyWithRetry(() => import("@/pages/user/MyBids"), "MyBids");
const Won = lazyWithRetry(() => import("@/pages/user/Won"), "Won");
const Profile = lazyWithRetry(() => import("@/pages/user/Profile"), "Profile");

// Admin pages
const AdminItems = lazyWithRetry(() => import("@/pages/admin/AdminItems"), "AdminItems");
const AdminItemForm = lazyWithRetry(() => import("@/pages/admin/AdminItemForm"), "AdminItemForm");
const Operations = lazyWithRetry(() => import("@/pages/admin/Operations"), "Operations");

// Fallback
const NotFound = lazyWithRetry(() => import("@/pages/NotFound"), "NotFound");

// Page-level suspense fallback — only content area spins, never the shell
function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink/10 border-t-neon" />
    </div>
  );
}

// Persistent app shell — renders ONCE, never unmounts on navigation
function AppShell() {
  useInactivityTimeout();
  return (
    <div className="flex min-h-screen flex-col bg-ash">
      <AppHeader />
      <main className="flex flex-1 flex-col">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

// Auth pages have their own full-screen layout — no shell
function AuthShell() {
  return (
    <Suspense fallback={<PageSpinner fullScreen />}>
      <Outlet />
    </Suspense>
  );
}

export function App() {
  return (
    <Routes>
      {/* Auth pages — full screen, no header/footer */}
      <Route element={<AuthShell />}>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      {/* All other pages share the persistent AppShell */}
      <Route element={<AppShell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/bidding" element={<BiddingDesk />} />
        <Route path="/bidding/:id" element={<ItemDetail />} />
        <Route path="/closed" element={<Closed />} />

        {/* Authenticated */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/my-bids" element={<MyBids />} />
          <Route path="/won" element={<Won />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        {/* Item operations viewers */}
        <Route element={<ItemOperationsRoute />}>
          <Route path="/admin/items" element={<AdminItems />} />
        </Route>

        {/* Admin only */}
        <Route element={<AdminRoute />}>
          <Route path="/admin/items/new" element={<AdminItemForm />} />
          <Route path="/admin/items/:id" element={<AdminItemForm />} />
          <Route path="/operations" element={<Operations />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
