export type Role = "Guest" | "Bidder" | "ShopOwner" | "Admin" | "SuperAdmin";

export const normalizeDisplayRoleName = (role: string) =>
  role === "Observer" ? "ShopOwner" : role;

export const normalizeRole = (roles: string[]): Role => {
  const normalizedRoles = roles.map(normalizeDisplayRoleName);
  if (normalizedRoles.includes("SuperAdmin")) return "SuperAdmin";
  if (normalizedRoles.includes("Admin")) return "Admin";
  if (normalizedRoles.includes("ShopOwner")) return "ShopOwner";
  if (normalizedRoles.includes("Bidder")) return "Bidder";
  return "Guest";
};

export const isSuperAdminRole = (role: Role) => role === "SuperAdmin";

export const isAdminRole = (role: Role) => role === "Admin" || role === "SuperAdmin";

export const canBidWithRole = (role: Role) => role === "Bidder" || role === "Admin";

export const canViewReserveWithRole = (role: Role) => isAdminRole(role);

export const canViewItemOperationsWithRole = (role: Role) =>
  role === "ShopOwner" || isAdminRole(role);

export const canAccessOperationsWithRole = (role: Role) => isAdminRole(role);
