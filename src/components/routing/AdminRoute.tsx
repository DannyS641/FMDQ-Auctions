import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { PageSpinner } from "@/components/ui/Spinner";

export function AdminRoute() {
  const { isSignedIn, isAdmin, isLoading } = useAuth();

  if (isLoading) return <PageSpinner />;
  if (!isSignedIn) return <Navigate to="/signin" replace />;
  if (!isAdmin) return <Navigate to="/bidding" replace />;

  return <Outlet />;
}
