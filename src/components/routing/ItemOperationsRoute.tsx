import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { PageSpinner } from "@/components/ui/Spinner";

export function ItemOperationsRoute() {
  const { isSignedIn, isLoading, canViewItemOperations } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageSpinner />;
  if (!isSignedIn) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }
  if (!canViewItemOperations) return <Navigate to="/bidding" replace />;

  return <Outlet />;
}
