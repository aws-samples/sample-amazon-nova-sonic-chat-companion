import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import { useAudioStore } from "./audioStore";
import { useChatStore } from "./chatStore";
import { useErrorStore } from "./errorStore";
import { useConfigStore } from "./configStore";
import { useDebugStore } from "./debugStore";
import { useAuthStore } from "./authStore";

interface SocketState {
  socket: Socket | null;
  isConnected: boolean;
  // Actions
  initSocket: () => void;
  emitEvent: (event: string, data?: any) => void;
  cleanUpSocket: () => void;
  contentTracks: Map<string, string>;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  contentTracks: new Map(),
  isConnected: false,

  initSocket: () => {
    console.log("Initializing socket");
    // Initialize socket.io connection
    const _socket = io({
      transports: ["websocket"],
    });
    // Set up socket event listeners
    _socket.on("connect", () => {
      set({ isConnected: true });
      console.log("Connected to server with id ", _socket.id);
      // Connection status is now shown in the UI, no need for toast notification
    });

    _socket.on("disconnect", (reason) => {
      set({ isConnected: false });
      console.log("Disconnected from server ", _socket.id, "reason:", reason);

      // Check if disconnection might be due to authentication issues
      if (reason === "io server disconnect" || reason === "transport close") {
        // Server forced the disconnect, could be auth-related
        console.log("Server initiated disconnect, checking authentication");

        // Try to reconnect once
        _socket.connect();

        // Set a timeout to check if reconnection failed
        setTimeout(() => {
          if (!_socket.connected) {
            console.log("Reconnection failed, likely authentication issue");
            useErrorStore
              .getState()
              .addError(
                "Connection lost. Your session may have expired.",
                "warning"
              );

            // Prompt user to refresh
            if (
              confirm("Your session may have expired. Refresh to reconnect?")
            ) {
              useAuthStore.getState().forceReauthentication();
            }
          }
        }, 3000);
      }
    });

    _socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);

      // Check if error is likely due to authentication
      if (
        error.message?.includes("401") ||
        error.message?.includes("403") ||
        error.message?.includes("authentication") ||
        error.message?.includes("unauthorized")
      ) {
        console.log("Authentication error detected, forcing re-authentication");
        useErrorStore
          .getState()
          .addError(
            "Your session has expired. Redirecting to login...",
            "warning"
          );

        // Force re-authentication
        setTimeout(() => {
          useAuthStore.getState().forceReauthentication();
        }, 2000); // Short delay to allow error message to be seen
      } else {
        useErrorStore
          .getState()
          .addError(
            `Socket connection error: ${error.message || JSON.stringify(error)}`,
            "error"
          );
      }
    });

    _socket.on("error", (error) => {
      console.error("Server error:", error);
      useErrorStore
        .getState()
        .addError(
          `Server error: ${error.message || JSON.stringify(error)}`,
          "error"
        );
    });

    _socket.on("contentStart", (data) => {
      console.log("Content start received:", data);

      // Debug notification for content start
      if (useConfigStore.getState().debug) {
        useDebugStore.getState().addEvent(data.role, "S " + data.type);
      }
      get().contentTracks.set(data.contentId, data.role);

      if (data.type === "TEXT") {
        let isSpeculative = false;
        try {
          if (data.additionalModelFields) {
            const additionalFields = JSON.parse(data.additionalModelFields);
            isSpeculative = additionalFields.generationStage === "SPECULATIVE";
            if (isSpeculative) {
              console.log("Received speculative content");
              useChatStore.getState().setDisplayAssistantText(true);
            } else {
              useChatStore.getState().setDisplayAssistantText(false);
            }
          }
        } catch (e: any) {
          console.error("Error parsing additionalModelFields:", e);
          useErrorStore
            .getState()
            .addError(
              `Error parsing model fields: ${e.message || "Unknown error"}`,
              "warning"
            );
        }
      } else if (data.type === "AUDIO") {
        // When audio content starts, we may need to show user thinking indicator
        if (useAudioStore.getState().isStreaming) {
          useChatStore.getState().setWaitingForUserTranscription(true);
        }
      }
    });

    _socket.on("textOutput", (data) => {
      console.log("Received text output:", data);

      if (data.role === "USER") {
        // When user text is received, show thinking indicator for assistant response
        useChatStore.getState().setTranscriptionReceived(true);
        useChatStore.getState().setWaitingForUserTranscription(false);

        // Add user message to chat
        useChatStore.getState().addTextMessage({
          role: data.role,
          message: data.content,
        });

        // Show assistant thinking indicator after user text appears
        useChatStore.getState().setWaitingForAssistantResponse(true);
      } else if (data.role === "ASSISTANT") {
        useChatStore.getState().setWaitingForAssistantResponse(false);
        if (useChatStore.getState().displayAssistantText) {
          useChatStore.getState().addTextMessage({
            role: data.role,
            message: data.content,
          });
        }
      }
    });

    _socket.on("audioOutput", (data) => {
      if (data.content) {
        try {
          const audioData = base64ToFloat32Array(data.content);
          useAudioStore.getState().audioPlayer?.playAudio(audioData);
        } catch (error: any) {
          console.error("Error processing audio data:", error);
          useErrorStore
            .getState()
            .addError(
              `Error processing audio data: ${
                error.message || "Unknown error"
              }`,
              "error"
            );
        }
      }
    });

    _socket.on("contentEnd", (data) => {
      data.role = get().contentTracks.get(data.contentId);
      console.log("Content end received:", data);
      // Debug notification for content end
      if (useConfigStore.getState().debug) {
        useDebugStore
          .getState()
          .addEvent(data.role, "E " + data.type, data.stopReason);
      }

      if (data.type === "TEXT") {
        if (data.role === "USER") {
          // When user's text content ends, make sure assistant thinking is shown
          useChatStore.getState().setWaitingForUserTranscription(false);
          useChatStore.getState().setWaitingForAssistantResponse(true);
        } else if (data.role === "ASSISTANT") {
          // When assistant's text content ends, prepare for user input in next turn
          useChatStore.getState().setWaitingForAssistantResponse(false);
        } else {
          console.error("Unknown role:", data.role);
          useErrorStore
            .getState()
            .addError("Unknown role: " + data.role, "error");
        }

        // Handle stop reasons
        if (data.stopReason && data.stopReason.toUpperCase() === "END_TURN") {
          useChatStore.getState().endTurn();
        } else if (
          data.stopReason &&
          data.stopReason.toUpperCase() === "INTERRUPTED"
        ) {
          useAudioStore.getState().bargeIn();
        }
      } else if (data.type === "AUDIO") {
        // When audio content ends, we may need to show user thinking indicator
        if (useAudioStore.getState().isStreaming) {
          useChatStore.getState().setWaitingForUserTranscription(true);
        }
      }
    });

    _socket.on("streamComplete", () => {
      if (useAudioStore.getState().isStreaming) {
        // Update the isStreaming state directly since stopStreaming is now in Controls
        useAudioStore.setState({ isStreaming: false });

        // Clean up audio processor if it exists
        const audioProcessor = useAudioStore.getState().audioProcessor;
        if (audioProcessor) {
          audioProcessor.stop();
        }

        // Stop audio player if it exists
        const audioPlayer = useAudioStore.getState().audioPlayer;
        if (audioPlayer) {
          audioPlayer.stop();
        }
      }
    });

    set({ socket: _socket });
  },

  emitEvent: (event, data) => {
    const { socket } = get();
    if (socket) {
      socket.emit(event, data);
    } else {
      console.error("Socket not initialized");
      useErrorStore
        .getState()
        .addError("Socket not initialized. Please refresh the page.", "error");
    }
  },
  cleanUpSocket: async () => {
    console.log("Cleaning up socket");
    const { socket } = get();
    if (socket)
      if (socket.connected) {
        socket.disconnect();
      } else {
        socket.removeAllListeners();
        socket.on("connect", () => {
          socket.disconnect();
          console.log(`Socket disconnecting`);
        });
      }
    set({ socket: null });
  },
}));

// Base64 to Float32Array conversion
function base64ToFloat32Array(base64String: string): Float32Array {
  try {
    const binaryString = window.atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    return float32Array;
  } catch (error: any) {
    console.error("Error in base64ToFloat32Array:", error);
    useErrorStore
      .getState()
      .addError(
        `Error converting audio data: ${error.message || "Unknown error"}`,
        "error"
      );
    throw error;
  }
}
