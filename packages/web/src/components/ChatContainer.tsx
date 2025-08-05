import { useChatStore, type ChatMessage } from "@/store/chatStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pause, Play, Share, Trash, X } from "lucide-react";
import { useAudioConfigStore } from "@/store/audioConfigStore";
import { useAudioStore } from "@/store/audioStore";

export function ChatContainer() {
  const {
    history,
    clearHistory,
    waitingForUserTranscription,
    waitingForAssistantResponse,
  } = useChatStore();
  const { hideChat, isChatVisible } = useSidebarStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [history, waitingForUserTranscription, waitingForAssistantResponse]);

  useEffect(() => {
    return () => {
      setPlaying(false);
    };
  }, []);

  useEffect(() => {
    if (!isChatVisible) {
      setPlaying(false);
    }
  }, [isChatVisible]);

  useEffect(() => {
    if (!playing) {
      audio?.pause();
    }
  }, [playing]);

  return (
    <Card
      ref={containerRef}
      className="flex-1 overflow-y-auto h-full w-[100vw] md:w-full rounded-none md:rounded-lg flex flex-col bg-background md:backdrop-blur-sm shadow-lg"
    >
      <div className="sticky  top-0 z-10 flex gap-2 justify-between items-center p-2 bg-background/90 backdrop-blur-sm border-b">
        <h2 className="font-semibold text-lg">Chat History</h2>
        {useAudioConfigStore.getState().enableRecording && (
          <div className="flex gap-2 items-center">
            <Button
              variant="default"
              className="rounded-full h-8 "
              size="icon"
              onClick={() => {
                if (!playing) {
                  setPlaying(true);
                  const audioBlob = new Blob(
                    useAudioStore.getState().audioBlob,
                    {
                      type: "audio/mp3",
                    }
                  );
                  const audioUrl = URL.createObjectURL(audioBlob);
                  let _audio = audio;
                  if (!_audio) {
                    _audio = new Audio();
                    setAudio(_audio);
                  }
                  _audio.src = audioUrl;
                  _audio?.play();
                  _audio!.onended = () => {
                    setPlaying(false);
                    setAudio(null);
                  };
                } else {
                  setPlaying(false);
                }
              }}
              title="Play recorded audio"
            >
              {playing ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>

            <Button
              variant="default"
              size="icon"
              className="rounded-full h-8"
              onClick={() => {
                const audioBlob = new Blob(useAudioStore.getState().audioBlob, {
                  type: "audio/mp3",
                });

                // Create a download link
                const audioUrl = URL.createObjectURL(audioBlob);
                const downloadLink = document.createElement("a");
                downloadLink.href = audioUrl;
                downloadLink.download = `nova-sonic-audio-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.mp3`;

                // Trigger download
                document.body.appendChild(downloadLink);
                downloadLink.click();

                // Clean up
                document.body.removeChild(downloadLink);
                setTimeout(() => URL.revokeObjectURL(audioUrl), 100);
              }}
              title="Share/download recorded audio"
            >
              <Share className="h-4 w-4" />
            </Button>

            <Button
              variant={"default"}
              size="lg"
              onClick={() => {
                clearHistory();
                useAudioStore.getState().resetAudioBlob();
              }}
              className="flex items-center gap-2 px-4 text-sm h-8 rounded-full shadow-sm hover:shadow transition-all"
            >
              <Trash className="h-4 w-4" />
              New
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={hideChat}
          aria-label="Close chat history"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <CardContent className="p-4 flex flex-col overflow-y-auto">
        {history.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}

        {/* Thinking indicators */}
        {waitingForUserTranscription && (
          <ThinkingIndicator role="USER" text="Listening" />
        )}

        {waitingForAssistantResponse && (
          <ThinkingIndicator role="ASSISTANT" text="Thinking" />
        )}
      </CardContent>
    </Card>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "USER";
  const isSystem = message.role === "SYSTEM";

  if (isSystem) {
    return (
      <div className="bg-muted/50 text-muted-foreground py-2 px-4 rounded-full mx-auto my-2 text-sm italic">
        {message.message}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "max-w-[70%] rounded-lg p-4 mb-4",
        isUser
          ? "bg-primary text-primary-foreground self-end rounded-br-none"
          : "bg-secondary text-secondary-foreground self-start rounded-bl-none"
      )}
    >
      <div className="text-xs font-semibold mb-1 opacity-70">
        {message.role}
      </div>
      <div>{message.message}</div>
    </div>
  );
}

interface ThinkingIndicatorProps {
  role: string;
  text: string;
}

function ThinkingIndicator({ role, text }: ThinkingIndicatorProps) {
  const isUser = role === "USER";

  return (
    <div
      className={cn(
        "max-w-[70%] rounded-lg p-4 mb-4 flex items-center",
        isUser
          ? "bg-primary/70 text-primary-foreground self-end rounded-br-none"
          : "bg-secondary/70 text-secondary-foreground self-start rounded-bl-none"
      )}
    >
      <div className="text-xs font-semibold mr-2 opacity-70">{role}</div>
      <div className="italic mr-2">{text}</div>
      <div className="flex gap-1">
        <div
          className="w-2 h-2 rounded-full bg-current animate-pulse"
          style={{ animationDelay: "0ms" }}
        ></div>
        <div
          className="w-2 h-2 rounded-full bg-current animate-pulse"
          style={{ animationDelay: "300ms" }}
        ></div>
        <div
          className="w-2 h-2 rounded-full bg-current animate-pulse"
          style={{ animationDelay: "600ms" }}
        ></div>
      </div>
    </div>
  );
}
