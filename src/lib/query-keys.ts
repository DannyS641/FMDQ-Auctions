export const queryKeys = {
  auth: {
    session: () => ["auth", "session"] as const,
  },
  items: {
    all: () => ["items"] as const,
    list: (includeArchived = false) => ["items", "list", { includeArchived }] as const,
    detail: (id: string) => ["items", id] as const,
    categories: () => ["items", "categories"] as const,
    landingStats: () => ["items", "landing-stats"] as const,
  },
  me: {
    profile: () => ["me", "profile"] as const,
    sessions: () => ["me", "sessions"] as const,
    dashboard: () => ["me", "dashboard"] as const,
    bids: () => ["me", "bids"] as const,
    wins: () => ["me", "wins"] as const,
  },
  admin: {
    users: () => ["admin", "users"] as const,
    roles: () => ["admin", "roles"] as const,
    operations: () => ["admin", "operations"] as const,
    reports: () => ["admin", "reports"] as const,
    audits: (params?: Record<string, string | number>) =>
      ["admin", "audits", params ?? {}] as const,
    notifications: (params?: Record<string, string | number>) =>
      ["admin", "notifications", params ?? {}] as const,
  },
} as const;
