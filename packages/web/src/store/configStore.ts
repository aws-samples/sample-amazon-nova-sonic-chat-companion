import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface ConfigState {
  systemPrompt: string;
  temperature: number;
  voiceId: "matthew" | "tiffany" | "amy";
  debug: boolean;

  setSystemPrompt: (prompt: string) => void;
  setTemperature: (temperature: number) => void;
  setVoiceId: (voiceId: "matthew" | "tiffany" | "amy") => void;
  setDebug: (debug: boolean) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      systemPrompt:
        "You are a friend. The user and you will engage in a spoken " +
        "dialog exchanging the transcripts of a natural real-time conversation. Keep your responses short, " +
        "generally two or three sentences for chatty scenarios.",
      temperature: 0.5,
      voiceId: "matthew",
      debug: false,
      setSystemPrompt: (prompt: string) => set({ systemPrompt: prompt }),
      setTemperature: (temperature: number) => set({ temperature }),
      setVoiceId: (voiceId: "matthew" | "tiffany" | "amy") => set({ voiceId }),
      setDebug: (debug: boolean) => set({ debug }),
    }),
    {
      name: "audio-chatbot-config", // unique name for localStorage key
      storage: createJSONStorage(() => localStorage), // use localStorage
      // Only persist these state properties
      partialize: (state) => ({
        systemPrompt: state.systemPrompt,
        temperature: state.temperature,
        voiceId: state.voiceId,
        debug: state.debug,
      }),
    }
  )
);
