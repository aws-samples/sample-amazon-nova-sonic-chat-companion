import { Button } from "@/components/ui/button";
import { useAudioStore } from "@/store/audioStore";
import { Mic, MicOff, Settings, Zap, ZapOff } from "lucide-react";
import { useSocketStore } from "@/store/socketStore";
import { useConfigStore } from "@/store/configStore";
import { useChatStore } from "@/store/chatStore";
import { useErrorStore } from "@/store/errorStore";
import { useAudioConfigStore } from "@/store/audioConfigStore";

interface ControlsProps {
  onConfig?: (isOpen: boolean) => void;
}

export function Controls({ onConfig }: ControlsProps) {
  const {
    isStreaming,
    //audioPlayer,
    sessionInitialized,
    setSessionInitialized,
    setStreaming,
    initAudio,
    cleanUpAudio,
  } = useAudioStore();

  const { isConnected, emitEvent, cleanUpSocket, initSocket } =
    useSocketStore();
  const {
    setWaitingForUserTranscription,
    setWaitingForAssistantResponse,
    history,
  } = useChatStore();
  const { systemPrompt, voiceId } = useConfigStore();

  const togglePanel = () => {
    onConfig?.(true);
  };

  const initializeSession = async () => {
    if (sessionInitialized) return;
    try {
      console.log("Initialize session");
      emitEvent("sessionStart");
      emitEvent("promptStart", { voiceId });
      emitEvent("systemPrompt", systemPrompt);
      emitEvent("history", history);
      emitEvent("audioStart");

      setSessionInitialized(true);
      console.log(`Session initialized with voice: ${voiceId}`);
    } catch (error: any) {
      console.error("Failed to initialize session:", error);
      useErrorStore
        .getState()
        .addError(
          `Failed to initialize session: ${error.message || "Unknown error"}`,
          "error"
        );
    }
  };

  const startStreaming = async () => {
    // clearHistory();
    try {
      // First, make sure the session is initialized
      await initAudio(false);
      console.log("Mic requested");
      await initializeSession();

      // Start processing audio
      useAudioStore.getState().audioProcessor?.start((audioData: string) => {
        // Send the processed audio data to the server
        emitEvent("audioInput", audioData);
      });

      if (useAudioConfigStore.getState().enableRecording) {
        let chunks: BlobPart[] = [];
        const recorder = useAudioStore.getState().mediaRecoder;
        if (!recorder) {
          console.log("Recorder not available");
          useErrorStore.getState().addError(`Recorder not available`, "error");
          return;
        }
        recorder.onstop = () => {
          console.log("recording stopped");
          useAudioStore.getState().addAudioBlobParts(chunks);
        };
        recorder.ondataavailable = (e) => {
          console.log("recording");
          chunks.push(e.data);
        };
        recorder.start();
        console.log("recording started", recorder.state);
      }
      setStreaming(true);
      setWaitingForUserTranscription(true);
      setWaitingForAssistantResponse(false);
    } catch (error: any) {
      console.error("Error starting recording:", error);
      useErrorStore
        .getState()
        .addError(
          `Error starting recording: ${error.message || "Unknown error"}`,
          "error"
        );
    }
  };

  const stopStreaming = async () => {
    if (!isStreaming) return;

    // // Clean up audio processing
    // if (audioProcessor) {
    //   audioProcessor.stop();
    // }

    // if (audioPlayer) {
    //   audioPlayer.stop();
    // }
    useAudioStore.getState().mediaRecoder?.stop();
    cleanUpAudio();
    // Tell server to finalize processing
    emitEvent("stopAudio");

    setStreaming(false);
    setSessionInitialized(false);
    setWaitingForUserTranscription(false);
    setWaitingForAssistantResponse(false);

    console.log("Streaming stopped");

    await cleanUpSocket();
    await initSocket();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 bg-background flex justify-center gap-4 z-10">
      <div className="flex flex-1">
        {isConnected ? (
          <div className="flex items-center">
            <Zap className="h-6 w-6 mr-1" />
          </div>
        ) : (
          <div className="flex items-center">
            <ZapOff className="h-6 w-6 mr-1" />
          </div>
        )}
      </div>
      <Button
        variant={isStreaming ? "destructive" : "default"}
        onClick={isStreaming ? stopStreaming : startStreaming}
        disabled={!isConnected}
        onMouseDown={(e) => {
          e.preventDefault();
          console.log("MouseDown");
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          console.log("TouchStart");
        }}
        className="flex items-center p-0 w-12 h-12 rounded-full shadow-sm hover:shadow transition-all"
      >
        {isStreaming ? (
          <>
            <MicOff className="h-6 w-6" />
          </>
        ) : (
          <>
            <Mic className="h-6 w-6" />
          </>
        )}
      </Button>

      <div className="flex flex-1 justify-end">
        <Button
          variant="outline"
          size="icon"
          onClick={togglePanel}
          className="rounded-full"
          title="Configuration"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
