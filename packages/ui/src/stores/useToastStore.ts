import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";

export type ToastItem = {
  id: string;
  variant: ToastVariant;
  message: string;
  createdAt: number;
};

type ToastStore = {
  toasts: ToastItem[];
  add: (variant: ToastVariant, message: string) => void;
  dismiss: (id: string) => void;
};

let counter = 0;
const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 5000;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  add: (variant, message) => {
    const id = `toast-${++counter}`;
    const item: ToastItem = { id, variant, message, createdAt: Date.now() };

    set((state) => ({
      toasts: [...state.toasts.slice(-(MAX_TOASTS - 1)), item],
    }));

    setTimeout(() => {
      const { toasts } = get();
      if (toasts.some((t) => t.id === id)) {
        set({ toasts: toasts.filter((t) => t.id !== id) });
      }
    }, AUTO_DISMISS_MS);
  },

  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
