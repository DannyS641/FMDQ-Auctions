import { lazy, Suspense } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { ProtectedRoute } from "@/components/routing/ProtectedRoute";
import { AdminRoute } from "@/components/routing/AdminRoute";
import { AppHeader } from "@/components/layout/AppHeader";
import { Footer } from "@/components/layout/Footer";
import { PageSpinner } from "@/components/ui/Spinner";
import { useInactivityTimeout } from "@/hooks/use-inactivity-timeout";

// Public pages
const Landing = lazy(() => import("@/pages/Landing"));
const SignIn = lazy(() => import("@/pages/auth/SignIn"));
const SignUp = lazy(() => import("@/pages/auth/SignUp"));
const Verify = lazy(() => import("@/pages/auth/Verify"));
const ResetPassword = lazy(() => import("@/pages/auth/ResetPassword"));
const BiddingDesk = lazy(() => import("@/pages/auction/BiddingDesk"));
const ItemDetail = lazy(() => import("@/pages/auction/ItemDetail"));
const Closed = lazy(() => import("@/pages/auction/Closed"));

// Authenticated pages
const Dashboard = lazy(() => import("@/pages/user/Dashboard"));
const MyBids = lazy(() => import("@/pages/user/MyBids"));
const Won = lazy(() => import("@/pages/user/Won"));
const Profile = lazy(() => import("@/pages/user/Profile"));

// Admin pages
const AdminItems = lazy(() => import("@/pages/admin/AdminItems"));
const AdminItemForm = lazy(() => import("@/pages/admin/AdminItemForm"));
const Operations = lazy(() => import("@/pages/admin/Operations"));

// Fallback
const NotFound = lazy(() => import("@/pages/NotFound"));

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
    <Suspense fallback={<PageSpinner />}>
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

        {/* Admin only */}
        <Route element={<AdminRoute />}>
          <Route path="/admin/items" element={<AdminItems />} />
          <Route path="/admin/items/new" element={<AdminItemForm />} />
          <Route path="/admin/items/:id" element={<AdminItemForm />} />
          <Route path="/operations" element={<Operations />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
