export type Role = "Guest" | "Bidder" | "ShopOwner" | "Admin" | "SuperAdmin";

// Retained (as an identity mapping) only because the legacy Express server
// still imports it; the DB stores "ShopOwner" directly now, no more alias.
export const normalizeDisplayRoleName = (role: string) => role;

export const normalizeRole = (roles: string[]): Role => {
  if (roles.includes("SuperAdmin")) return "SuperAdmin";
  if (roles.includes("Admin")) return "Admin";
  if (roles.includes("ShopOwner")) return "ShopOwner";
  if (roles.includes("Bidder")) return "Bidder";
  return "Guest";
};

export const isSuperAdminRole = (role: Role) => role === "SuperAdmin";

export const isAdminRole = (role: Role) => role === "Admin" || role === "SuperAdmin";

export const canBidWithRole = (role: Role) => role === "Bidder" || role === "Admin";

export const canViewReserveWithRole = (role: Role) => isAdminRole(role);

export const canViewItemOperationsWithRole = (role: Role) =>
  role === "ShopOwner" || isAdminRole(role);

export const canAccessOperationsWithRole = (role: Role) => isAdminRole(role);
