import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  // Store token expiration time
  tokenExpiresAt: number | null;

  // Actions
  setTokenExpiration: (expiresAt: number) => void;
  isTokenExpired: () => boolean;
  clearTokenExpiration: () => void;

  // Force re-authentication by doing a hard reload
  forceReauthentication: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      tokenExpiresAt: null,

      setTokenExpiration: (expiresAt) => set({ tokenExpiresAt: expiresAt }),

      isTokenExpired: () => {
        const { tokenExpiresAt } = get();
        if (!tokenExpiresAt) return false;

        // Add a small buffer (5 minutes) to ensure we refresh before actual expiration
        const bufferTime = 5 * 60 * 1000;
        return Date.now() > tokenExpiresAt - bufferTime;
      },

      clearTokenExpiration: () => set({ tokenExpiresAt: null }),

      forceReauthentication: () => {
        // Force a hard reload to trigger ALB authentication
        // The no-cache parameter helps bypass browser cache
        window.location.href = `${window.location.origin}?nocache=${Date.now()}`;
      },
    }),
    {
      name: "auth-storage",
    }
  )
);
