import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AudioConfigState {
  loopBackGain: number;
  echoSuppression: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputDeviceId: string;
  outputDeviceId: string;
  enableRecording: boolean;

  setLoopBackGain: (gain: number) => void;
  setEchoSuppression: (enabled: boolean) => void;
  setNoiseSuppression: (enabled: boolean) => void;
  setAutoGainControl: (enabled: boolean) => void;
  setInputDeviceId: (deviceId: string) => void;
  setOutputDeviceId: (deviceId: string) => void;
  setEnableRecording: (enabled: boolean) => void;
}

export const useAudioConfigStore = create<AudioConfigState>()(
  persist(
    (set) => ({
      loopBackGain: 0.0,
      echoSuppression: true,
      noiseSuppression: true,
      autoGainControl: true,
      inputDeviceId: "default",
      outputDeviceId: "default",
      enableRecording: true,

      setEchoSuppression: (enabled) => set({ echoSuppression: enabled }),
      setNoiseSuppression: (enabled) => set({ noiseSuppression: enabled }),
      setAutoGainControl: (enabled) => set({ autoGainControl: enabled }),
      setLoopBackGain: (gain) => set({ loopBackGain: gain }),
      setInputDeviceId: (deviceId) => set({ inputDeviceId: deviceId }),
      setOutputDeviceId: (deviceId) => set({ outputDeviceId: deviceId }),
      setEnableRecording: (enabled) => set({ enableRecording: enabled }),
    }),
    {
      name: "audio-config",
    }
  )
);
