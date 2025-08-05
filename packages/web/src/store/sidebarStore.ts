import { create } from "zustand";

interface SidebarState {
  isChatVisible: boolean;
  showChat: () => void;
  hideChat: () => void;
  toggleChat: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isChatVisible: false,
  showChat: () => set({ isChatVisible: true }),
  hideChat: () => set({ isChatVisible: false }),
  toggleChat: () => set((state) => ({ isChatVisible: !state.isChatVisible })),
}));
