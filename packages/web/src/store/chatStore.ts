import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ChatMessage {
  role: string;
  message: string;
  endOfResponse?: boolean;
}

interface ChatState {
  history: ChatMessage[];
  waitingForUserTranscription: boolean;
  waitingForAssistantResponse: boolean;
  transcriptionReceived: boolean;
  displayAssistantText: boolean;
  lastMessage: ChatMessage | null;

  // Actions
  addTextMessage: (content: { role: string; message: string }) => void;
  endTurn: () => void;
  endConversation: () => void;
  setWaitingForUserTranscription: (waiting: boolean) => void;
  setWaitingForAssistantResponse: (waiting: boolean) => void;
  setTranscriptionReceived: (received: boolean) => void;
  setDisplayAssistantText: (display: boolean) => void;
  clearHistory: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      history: [],
      waitingForUserTranscription: false,
      waitingForAssistantResponse: false,
      transcriptionReceived: false,
      displayAssistantText: false,
      lastMessage: null,

      addTextMessage: (content) => {
        set((state) => {
          let updatedChatHistory = [...state.history];
          let lastTurn = updatedChatHistory[updatedChatHistory.length - 1];

          if (lastTurn !== undefined && lastTurn.role === content.role) {
            // Same role, append to the last turn
            updatedChatHistory[updatedChatHistory.length - 1] = {
              ...content,
              message: lastTurn.message + " " + content.message,
            };
          } else {
            // Different role, add a new turn
            updatedChatHistory.push({
              role: content.role,
              message: content.message,
            });
          }

          return { history: updatedChatHistory, lastMessage: content };
        });
      },

      endTurn: () => {
        set((state) => ({
          history: state.history.map((item) => ({
            ...item,
            endOfResponse: true,
          })),
        }));
      },

      endConversation: () => {
        set((state) => {
          const updatedChatHistory = state.history.map((item) => ({
            ...item,
            endOfResponse: true,
          }));

          updatedChatHistory.push({
            role: "SYSTEM",
            message: "Conversation ended",
            endOfResponse: true,
          });

          return { history: updatedChatHistory };
        });
      },

      setWaitingForUserTranscription: (waiting) =>
        set({ waitingForUserTranscription: waiting }),
      setWaitingForAssistantResponse: (waiting) =>
        set({ waitingForAssistantResponse: waiting }),
      setTranscriptionReceived: (received) =>
        set({ transcriptionReceived: received }),
      setDisplayAssistantText: (display) =>
        set({ displayAssistantText: display }),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "chat-storage",
    }
  )
);
