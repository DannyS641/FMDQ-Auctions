export type Role = "Guest" | "Bidder" | "ShopOwner" | "Admin" | "SuperAdmin";

export type AuthSession = {
  signedIn: boolean;
  displayName: string;
  role: Role;
  email?: string;
  userId?: string;
  csrfToken?: string;
};

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  status: "pending_verification" | "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string | null;
  role: Role;
  roles: string[];
};

export type UserSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export const DEFAULT_SESSION: AuthSession = {
  signedIn: false,
  displayName: "Guest",
  role: "Guest",
};
