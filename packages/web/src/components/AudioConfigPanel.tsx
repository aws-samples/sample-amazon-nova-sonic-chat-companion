import { useState } from "react";
import { useAudioConfigStore } from "@/store/audioConfigStore";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Volume2 } from "lucide-react";

export function AudioConfigPanel() {
  const {
    loopBackGain,
    echoSuppression,
    noiseSuppression,
    setLoopBackGain,
    setEchoSuppression,
    setNoiseSuppression,
  } = useAudioConfigStore();

  const [isOpen, setIsOpen] = useState(false);
  const [localLoopBackGain, setLocalLoopBackGain] = useState(loopBackGain);
  const [localEchoSuppression, setLocalEchoSuppression] =
    useState(echoSuppression);
  const [localNoiseSuppression, setLocalNoiseSuppression] =
    useState(noiseSuppression);

  const togglePanel = () => {
    setIsOpen(!isOpen);
  };

  const saveConfig = () => {
    setLoopBackGain(localLoopBackGain);
    setEchoSuppression(localEchoSuppression);
    setNoiseSuppression(localNoiseSuppression);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="icon"
        onClick={togglePanel}
        className="rounded-full ml-2"
        title="Audio Configuration"
      >
        <Volume2 className="h-4 w-4" />
      </Button>

      {isOpen && (
        <div className="absolute bottom-8 right-0 w-[300px] bg-background border rounded-md shadow-lg p-6 z-20">
          <h3 className="text-lg font-semibold mb-4">Audio Configuration</h3>

          <div className="space-y-4">
            <div className="space-y-2">
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

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="default" size="sm" onClick={saveConfig}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
