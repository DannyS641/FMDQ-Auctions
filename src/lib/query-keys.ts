export const queryKeys = {
  auth: {
    session: () => ["auth", "session"] as const,
  },
  items: {
    all: () => ["items"] as const,
    list: (includeArchived = false) => ["items", "list", { includeArchived }] as const,
    detail: (id: string) => ["items", id] as const,
    categories: () => ["items", "categories"] as const,
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
    audits: (filters?: Record<string, string>) =>
      ["admin", "audits", filters ?? {}] as const,
    notifications: () => ["admin", "notifications"] as const,
  },
} as const;
