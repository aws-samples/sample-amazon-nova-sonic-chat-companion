import { useEffect, useState, useRef } from "react";
import VoiceSpectrumBars from "@/components/VoiceSpectrumBars";
import { Controls } from "@/components/Controls";
import { ErrorToast } from "@/components/ErrorToast";
import { Toaster } from "@/components/ui/toaster";
import { DebugPanel } from "@/components/DebugPanel";
import { useAudioStore } from "@/store/audioStore";
import { useSocketStore } from "./store/socketStore";
import { useChatStore, ChatMessage } from "./store/chatStore";
import { useSidebarStore } from "./store/sidebarStore";
import { useThemeStore, applyTheme } from "./store/themeStore";
import { useSwipeGesture } from "./hooks/useSwipeGesture";
import { ChatContainer } from "./components/ChatContainer";
import { SwipeIndicator } from "./components/SwipeIndicator";
import clsx from "clsx";
import { ConfigPanel } from "./components/ConfigPanel";
import { useAuthStore } from "./store/authStore";
import { useErrorStore } from "./store/errorStore";

function App() {
  const { cleanUpAudio, analyser, isStreaming } = useAudioStore();
  const { initSocket, cleanUpSocket } = useSocketStore();
  const { lastMessage, history } = useChatStore();
  const { isChatVisible, showChat, hideChat } = useSidebarStore();
  const { theme } = useThemeStore();
  const [textBuffer, setTextBuffer] = useState<ChatMessage[]>(
    Array(3).fill(null)
  );
  const appRef = useRef<HTMLDivElement>(null);
  const [showConfig, setShowConfig] = useState(false);
  const { waitingForAssistantResponse } = useChatStore();

  // Set up swipe gesture detection
  useSwipeGesture(appRef, {
    onSwipeLeft: () => {
      if (history.length > 0) showChat();
    },
    onSwipeRight: () => {
      hideChat();
    },
    threshold: 50,
  });
  // Apply theme when component mounts and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Extract token expiration time on app initialization
  useEffect(() => {
    // This is a simplified approach - we'll set expiration to 24 hours from now
    // In a production app, you'd extract the actual expiration from the token
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    useAuthStore.getState().setTokenExpiration(expiresAt);
    console.log("Token expiration set to:", new Date(expiresAt).toISOString());
  }, []);

  // Check token expiration on app initialization
  useEffect(() => {
    if (useAuthStore.getState().isTokenExpired()) {
      console.log(
        "Token expired on app initialization, forcing re-authentication"
      );
      useErrorStore
        .getState()
        .addError(
          "Your session has expired. Redirecting to login...",
          "warning"
        );

      // Force re-authentication after a short delay
      setTimeout(() => {
        useAuthStore.getState().forceReauthentication();
      }, 2000);
    }
  }, []);

  useEffect(() => {
    // Initialize audio and socket connection when the component mounts
    initSocket();
    //initAudio();

    // Set up system theme change listener
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      cleanUpAudio();
      cleanUpSocket();
      setTextBuffer(Array(3).fill(null));
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (lastMessage && isStreaming) {
      setTextBuffer((prev) => {
        const newBuffer = [...prev];

        newBuffer.shift();
        newBuffer.push(lastMessage);

        return newBuffer;
      });
    }
  }, [lastMessage]);

  useEffect(() => {
    console.log("Is streaming", isStreaming);
  }, [isStreaming]);

  useEffect(() => {
    if (history.length === 0) {
      hideChat();
      setTextBuffer(new Array(3).fill(null));
    }
  }, [history]);

  return (
    <div
      ref={appRef}
      className="flex flex-col h-screen max-w-screen mx-auto p-4 relative overflow-hidden"
    >
      {/* Chat sidebar */}
      <div
        className={`absolute top-0 right-0 h-full sm:w-[100vw] max-w-md z-10 transform transition-transform duration-300 ease-in-out ${
          isChatVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <ChatContainer />
      </div>
      {/* Config */}
      <ConfigPanel open={showConfig} onOpenChange={setShowConfig} />

      {/* Main content */}
      {/* Chat tab indicator */}
      <SwipeIndicator />

      <div
        className={`flex flex-col h-full w-full transition-transform duration-300 ease-in-out ${
          isChatVisible ? "translate-x-[-90%]" : "translate-x-0"
        }`}
      >
        {/* <StatusBar /> */}
        <div className="flex flex-col items-center justify-center h-64 pt-56">
          <div className="w-16 h-16 md:w-32 md:h-32">
            <VoiceSpectrumBars
              bins={8}
              isPlaying={isStreaming}
              analyser={analyser ?? undefined}
            />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-full mh-6">
          {textBuffer
            .filter((t) => t !== null)
            .map((t) => (
              <div
                key={t.role + t.message.slice(0, 10)}
                className={clsx(
                  "text-lg font-medium text-center font-transcript",
                  {
                    "text-muted-foreground": t.role === "USER",
                    "text-foreground": t.role === "ASSISTANT",
                  }
                )}
              >
                {t.message}
              </div>
            ))}
          {waitingForAssistantResponse && (
            <div
              key="thinking"
              className="text-lg font-medium text-center font-transcript text-foreground italic"
            >
              thinking...
            </div>
          )}
        </div>

        <Controls onConfig={(isOpen) => setShowConfig(isOpen)} />
        <ErrorToast />
        <Toaster />
      </div>
      <DebugPanel />
    </div>
  );
}

export default App;
