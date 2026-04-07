import { create } from "zustand";

type ConfirmDialog = {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

type UiStore = {
  // Mobile nav
  isMobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;

  // Bidding desk: selected item
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;

  // Confirmation dialog (destructive actions)
  confirmDialog: ConfirmDialog | null;
  openConfirm: (dialog: ConfirmDialog) => void;
  closeConfirm: () => void;

  // Admin: active operations tab
  operationsTab: "audits" | "notifications" | "users";
  setOperationsTab: (tab: UiStore["operationsTab"]) => void;
};

export const useUiStore = create<UiStore>((set) => ({
  isMobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ isMobileMenuOpen: open }),
  toggleMobileMenu: () => set((s) => ({ isMobileMenuOpen: !s.isMobileMenuOpen })),

  selectedItemId: null,
  setSelectedItemId: (id) => set({ selectedItemId: id }),

  confirmDialog: null,
  openConfirm: (dialog) => set({ confirmDialog: dialog }),
  closeConfirm: () => set({ confirmDialog: null }),

  operationsTab: "audits",
  setOperationsTab: (tab) => set({ operationsTab: tab }),
}));
