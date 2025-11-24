import { useState, useEffect } from "react";
import { useConfigStore, VoiceId } from "@/store/configStore";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sun, Moon, Monitor, X, Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { MCPToolPanel } from "@/components/MCPToolPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioConfigStore } from "@/store/audioConfigStore";
import { useAudioStore } from "@/store/audioStore";
import { useThemeStore, Theme } from "@/store/themeStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useErrorStore } from "@/store/errorStore";

// Predefined system prompts
const PREDEFINED_PROMPTS = {
  Assistant:
    "You are a friend. The user and you will engage in a spoken " +
    "dialog exchanging the transcripts of a natural real-time conversation. Keep your responses short, " +
    "generally two or three sentences for chatty scenarios.",
  Expert:
    "You are a clear, patient technical expert. " +
    "Explain complex concepts in simple, conversational language as if speaking to someone in person. " +
    'Break down information into digestible chunks with clear verbal signposts like "The first key point is..." and "Another important aspect...".' +
    " Use brief pauses (indicated by ellipses) when transitioning between difficult concepts. " +
    'Occasionally check in with phrases like "Does that make sense?" to simulate natural teaching dialogue.',
  Storyteller:
    'You are an enthusiastic storyteller. Craft responses with narrative flair and conversational elements like "you know," "imagine this," and occasional "haha" or "wow" reactions where appropriate. Use ellipses for dramatic pauses... and vary your phrasing to maintain interest. Include brief emotional reactions to the user\'s questions or stories, and use a warm, inviting conversation style that feels like talking to a friend.',
};

interface ConfigPanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConfigPanel({
  open: externalOpen,
  onOpenChange,
}: ConfigPanelProps) {
  const {
    systemPrompt,
    temperature,
    voiceId,
    debug,
    setSystemPrompt,
    setTemperature,
    setVoiceId,
    setDebug,
  } = useConfigStore();

  const { cleanUpAudio, initAudio } = useAudioStore();
  const { theme, setTheme } = useThemeStore();

  const {
    loopBackGain,
    echoSuppression,
    noiseSuppression,
    autoGainControl,
    inputDeviceId,
    outputDeviceId,
    enableRecording,
    setLoopBackGain,
    setEchoSuppression,
    setNoiseSuppression,
    setAutoGainControl,
    setInputDeviceId,
    setOutputDeviceId,
    setEnableRecording,
  } = useAudioConfigStore();

  const [internalOpen, setInternalOpen] = useState(false);

  // Use external state if provided, otherwise use internal state
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [localLoopBackGain, setLocalLoopBackGain] = useState(loopBackGain);
  const [localEchoSuppression, setLocalEchoSuppression] =
    useState(echoSuppression);
  const [localNoiseSuppression, setLocalNoiseSuppression] =
    useState(noiseSuppression);
  const [localAutoGainControl, setLocalAutoGainControl] =
    useState(autoGainControl);
  const [localInputDeviceId, setLocalInputDeviceId] = useState(inputDeviceId);
  const [localOutputDeviceId, setLocalOutputDeviceId] =
    useState(outputDeviceId);
  const [localEnableRecording, setLocalEnableRecording] =
    useState(enableRecording);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [localSystemPrompt, setLocalSystemPrompt] = useState(systemPrompt);
  const [localTemperature] = useState(temperature);
  const [localVoiceId, setLocalVoiceId] = useState<VoiceId>(voiceId);
  const [localTheme, setLocalTheme] = useState<Theme>(theme);
  const [localDebug, setLocalDebug] = useState<boolean>(debug);
  const [testAudio, setTestAudio] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [testState, setTestState] = useState<string>("");
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);

  const toggleTestAudio = () => {
    if (testAudio) saveAudioConfig();
    if (!audio) {
      setAudio(new Audio());
    }
    setTestAudio(!testAudio);
  };

  useEffect(() => {
    setTestAudio(false);
  }, [
    inputDeviceId,
    outputDeviceId,
    loopBackGain,
    echoSuppression,
    noiseSuppression,
    autoGainControl,
  ]);

  // Function to enumerate available audio devices
  const enumerateDevices = async () => {
    try {
      // Request permission to access media devices
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const devices = await navigator.mediaDevices.enumerateDevices();

      const audioInputs = devices.filter(
        (device) => device.kind === "audioinput"
      );
      const audioOutputs = devices.filter(
        (device) => device.kind === "audiooutput"
      );
      stream.getTracks().forEach((t) => t.stop());

      setInputDevices(audioInputs);
      setOutputDevices(audioOutputs);
    } catch (error) {
      console.error("Error enumerating devices:", error);
    }
  };

  // Enumerate devices when the component mounts or when the dialog opens
  useEffect(() => {
    if (open) {
      enumerateDevices();
    } else {
      setTestState("");
      setTestAudio(false);
      cleanUpAudio();
    }
  }, [open]);

  useEffect(() => {
    if (testAudio) {
      setTestState("Wait...");
      initAudio(true).then(() => {
        const destination = useAudioStore.getState().recordingDestination;
        if (!destination) {
          console.log("Recording not possible");
          return;
        }
        let chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(destination.stream);
        recorder.onstop = () => {
          console.log("recording stopped");
          const audioBlob = new Blob(chunks, {
            type: "audio/mp3",
          });
          const audioUrl = URL.createObjectURL(audioBlob);
          if (audio) {
            audio.src = audioUrl;

            audio.autoplay = true;
            audio.play();
            setTestState("Playing back");
            audio.onended = () => {
              setTestState("");
              chunks = [];
            };
            audio.onerror = (error) => {
              useErrorStore
                .getState()
                .addError(`Playback error: ${error}`, "error");
              console.error("Playback error:", error);
            };
          }
          // setAudioBlob(audioBlob);
          // setAudioUrl(audioUrl);
          setRecorder(null);
        };
        recorder.ondataavailable = (e) => {
          console.log("recording");
          chunks.push(e.data);
        };
        recorder.start();
        setTestState("Speak");
        console.log("recording started", recorder.state);
        setRecorder(recorder);
      });
    } else {
      cleanUpAudio();
      recorder?.stop();
      setRecorder(null);
    }
  }, [testAudio]);

  const saveAudioConfig = () => {
    setLoopBackGain(localLoopBackGain);
    setEchoSuppression(localEchoSuppression);
    setNoiseSuppression(localNoiseSuppression);
    setAutoGainControl(localAutoGainControl);
    setInputDeviceId(localInputDeviceId);
    setOutputDeviceId(localOutputDeviceId);
    setEnableRecording(localEnableRecording);
  };

  const saveConfig = () => {
    setSystemPrompt(localSystemPrompt);
    setTemperature(localTemperature);
    setVoiceId(localVoiceId);
    setDebug(localDebug);
    saveAudioConfig();
    setTheme(localTheme);
    cleanUpAudio();
    initAudio(false);
    setOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md md:max-w-2xl h-[100dvh] sm:h-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader className="sticky top-0 bg-background pb-4 border-b z-10">
            <div className="flex justify-between items-center">
              <DialogTitle>Configuration</DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="rounded-full"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2 px-1">
              <Label htmlFor="systemPrompt">System Prompt</Label>
              <div className="flex flex-wrap gap-2 mb-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLocalSystemPrompt(PREDEFINED_PROMPTS.Assistant)
                  }
                  className="flex-1"
                >
                  Assistant
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLocalSystemPrompt(PREDEFINED_PROMPTS.Expert)
                  }
                  className="flex-1"
                >
                  Expert
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLocalSystemPrompt(PREDEFINED_PROMPTS.Storyteller)
                  }
                  className="flex-1"
                >
                  Storyteller
                </Button>
              </div>
              <Textarea
                id="systemPrompt"
                value={localSystemPrompt}
                onChange={(e) => setLocalSystemPrompt(e.target.value)}
                className="h-32 resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="voice">Voice</Label>
              <Select
                value={localVoiceId}
                onValueChange={(value: VoiceId) => setLocalVoiceId(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matthew">Matthew</SelectItem>
                  <SelectItem value="tiffany">Tiffany</SelectItem>
                  <SelectItem value="amy">Amy</SelectItem>
                  <SelectItem value="ambre">Ambre</SelectItem>
                  <SelectItem value="florian">Florian</SelectItem>
                  <SelectItem value="beatrice">Beatrice</SelectItem>
                  <SelectItem value="lorenzo">Lorenzo</SelectItem>
                  <SelectItem value="greta">Greta</SelectItem>
                  <SelectItem value="lennart">Lennart</SelectItem>
                  <SelectItem value="lupe">Lupe</SelectItem>
                  <SelectItem value="carlos">Carlos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 pt-4">
              <Label htmlFor="input-device">Input Device</Label>
              <Select
                value={localInputDeviceId}
                onValueChange={setLocalInputDeviceId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select microphone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  {inputDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label ||
                        `Microphone ${device.deviceId.slice(0, 5)}...`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Select which microphone to use for input
              </p>
            </div>

            <div className="flex items-center justify-between space-y-2">
              <Label htmlFor="echo-suppression" className="cursor-pointer">
                Echo Suppression
              </Label>
              <Switch
                id="echo-suppression"
                checked={localEchoSuppression}
                onCheckedChange={setLocalEchoSuppression}
              />
            </div>

            <div className="flex items-center justify-between space-y-2">
              <Label htmlFor="noise-suppression" className="cursor-pointer">
                Noise Suppression
              </Label>
              <Switch
                id="noise-suppression"
                checked={localNoiseSuppression}
                onCheckedChange={setLocalNoiseSuppression}
              />
            </div>

            <div className="flex items-center justify-between space-y-2">
              <Label htmlFor="auto-gain-control" className="cursor-pointer">
                Auto Gain Control
              </Label>
              <Switch
                id="auto-gain-control"
                checked={localAutoGainControl}
                onCheckedChange={setLocalAutoGainControl}
              />
            </div>

            <div className="flex items-center justify-between space-y-2">
              <Label htmlFor="enable-recording" className="cursor-pointer">
                Enable Audio Recording
              </Label>
              <Switch
                id="enable-recording"
                checked={localEnableRecording}
                onCheckedChange={setLocalEnableRecording}
              />
            </div>

            <div className="space-y-2 pt-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="loopback-gain">Loopback Gain</Label>
                <span className="text-sm">{localLoopBackGain.toFixed(2)}</span>
              </div>
              <input
                id="loopback-gain"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={localLoopBackGain}
                onChange={(e) =>
                  setLocalLoopBackGain(parseFloat(e.target.value))
                }
                className="w-full"
              />
              <p className="text-sm text-muted-foreground">
                The volume of the loop back feed from mic to speaker. Use with
                headsets. (0 to disable)
              </p>
            </div>

            <div className="space-y-2 pt-4">
              <Label htmlFor="output-device">Output Device</Label>
              <Select
                value={localOutputDeviceId}
                onValueChange={setLocalOutputDeviceId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select speaker" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  {outputDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label ||
                        `Speaker ${device.deviceId.slice(0, 5)}...`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Select which speaker to use for output
              </p>
            </div>

            <div className="space-y-2 pt-4 flex justify-start gap-4">
              <Button onClick={toggleTestAudio}>
                {testAudio ? "Stop" : "Start"} Test Audio
              </Button>
              <p className="text-sm text-muted-foreground">{testState}</p>
            </div>

            <div className="flex items-center justify-between space-y-2 pt-4">
              <Label htmlFor="debug-mode" className="cursor-pointer">
                Debug Mode
              </Label>
              <Switch
                id="debug-mode"
                checked={localDebug}
                onCheckedChange={setLocalDebug}
              />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              When enabled, shows notifications for audio playback, text
              reception, and bargein events
            </p>

            <div className="space-y-2 pt-4 border-t">
              <Label className="text-base font-semibold">External Tools</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Manage MCP (Model Context Protocol) tools that extend AI
                capabilities
              </p>
              <Button
                variant="outline"
                onClick={() => setMcpPanelOpen(true)}
                className="w-full"
              >
                <Settings className="h-4 w-4 mr-2" />
                Manage MCP Tools
              </Button>
            </div>

            <div className="space-y-2 pt-4">
              <Label>Theme</Label>
              <RadioGroup
                value={localTheme}
                onValueChange={(value: Theme) => setLocalTheme(value)}
                className="flex flex-col space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="light" id="light" />
                  <Label
                    htmlFor="light"
                    className="cursor-pointer flex items-center"
                  >
                    <Sun className="h-4 w-4 mr-2" /> Light
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dark" id="dark" />
                  <Label
                    htmlFor="dark"
                    className="cursor-pointer flex items-center"
                  >
                    <Moon className="h-4 w-4 mr-2" /> Dark
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="system" id="system" />
                  <Label
                    htmlFor="system"
                    className="cursor-pointer flex items-center"
                  >
                    <Monitor className="h-4 w-4 mr-2" /> System
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 bg-background pt-4 border-t">
            <Button variant="default" onClick={saveConfig}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MCP Tools Management Panel */}
      <MCPToolPanel open={mcpPanelOpen} onOpenChange={setMcpPanelOpen} />
    </>
  );
}
