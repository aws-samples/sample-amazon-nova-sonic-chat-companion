import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";

export interface ErrorMessage {
  id: string;
  message: string;
  type: "error" | "warning" | "info" | "success";
  timeout?: number;
  count?: number;
}

interface ErrorState {
  errors: ErrorMessage[];
  addError: (
    message: string,
    type?: "error" | "warning" | "info" | "success",
    timeout?: number
  ) => void;
  dismissError: (id: string) => void;
  dismissAllErrors: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  errors: [],

  addError: (message, type = "error", timeout = 2000) => {
    set((state) => {
      // Check if an error with the same message already exists

      if (state.errors.at(-1)?.message === message) {
        // Update existing error
        const updatedErrors = [...state.errors];
        const existingErrorIndex = updatedErrors.length - 1;
        const existingError = updatedErrors[existingErrorIndex];

        // Update the count and reset the timeout
        updatedErrors[existingErrorIndex] = {
          ...existingError,
          count: (existingError.count || 1) + 1,
        };

        // Set a new timeout
        if (timeout) {
          setTimeout(() => {
            set((s) => ({
              errors: s.errors.filter((e) => e.id !== existingError.id),
            }));
          }, timeout);
        }

        return { errors: updatedErrors };
      } else {
        // Add new error
        const id = uuidv4();
        const error: ErrorMessage = { id, message, type, timeout, count: 1 };

        // Set timeout for new error
        if (timeout) {
          setTimeout(() => {
            set((s) => ({
              errors: s.errors.filter((e) => e.id !== id),
            }));
          }, timeout);
        }

        return { errors: [...state.errors, error] };
      }
    });
  },

  dismissError: (id) => {
    set((state) => ({
      errors: state.errors.filter((error) => error.id !== id),
    }));
  },

  dismissAllErrors: () => {
    set({ errors: [] });
  },
}));
