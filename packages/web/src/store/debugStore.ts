import { create } from "zustand";

export interface SonicEvent {
  timeStamp: number;
  role: "USER" | "ASSISTANT";
  stopReason?: string;
  type: string;
  count: number;
}

interface DebugEventsState {
  events: SonicEvent[];
  addEvent: (
    role: "USER" | "ASSISTANT",
    type: string,
    stopReason?: string
  ) => void;
  clearEvents: () => void;
}

export const useDebugStore = create<DebugEventsState>((set) => ({
  events: [],

  addEvent: (role, type, stopReason) => {
    set((state) => {
      // Check if an error with the same message already exists

      if (
        state.events.at(-1)?.type === type &&
        state.events.at(-1)?.role === role
      ) {
        // Update existing error
        const updatedEvents = [...state.events];
        const existingErrorIndex = updatedEvents.length - 1;
        const existingError = updatedEvents[existingErrorIndex];

        // Update the count and reset the timeout
        updatedEvents[existingErrorIndex] = {
          ...existingError,
          count: (existingError.count || 1) + 1,
        };

        return { errors: updatedEvents };
      } else {
        // Add new error

        const event: SonicEvent = {
          role,
          type,
          stopReason,
          timeStamp: Date.now(),
          count: 1,
        };

        return { events: [...state.events, event] };
      }
    });
  },

  clearEvents: () => {
    set({ events: [] });
  },
}));
