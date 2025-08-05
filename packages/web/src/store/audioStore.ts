import { create } from "zustand";
import { AudioPlayer } from "@/lib/AudioPlayer";
import { AudioProcessor } from "@/lib/AudioProcessor";
import { useAudioConfigStore } from "./audioConfigStore";
import { useErrorStore } from "./errorStore";

interface AudioState {
  audioContext: AudioContext | null;
  audioStream: MediaStream | null;
  isStreaming: boolean;
  audioPlayer: AudioPlayer | null;
  audioProcessor: AudioProcessor | null;
  sessionInitialized: boolean;
  analyser: AnalyserNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  loopbackGainNode: GainNode | null;
  recordingDestination: MediaStreamAudioDestinationNode | null;
  mediaRecoder: MediaRecorder | null;
  audioBlob: BlobPart[];
  duckingGainNode: GainNode | null;

  // Actions
  setStreaming: (status: boolean) => void;
  setSessionInitialized: (status: boolean) => void;
  resetAudioProcessor: () => void;
  setAudioProcessor: (processor: AudioProcessor) => void;
  initAudio: (tets: boolean) => Promise<void>;
  cleanUpAudio: () => Promise<void>;
  //setMediaRecorder: (recorder: MediaRecorder) => void;
  bargeIn: () => void;
  addAudioBlobParts: (blobParts: BlobPart[]) => void;
  resetAudioBlob: () => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  audioContext: null,
  audioStream: null,
  isStreaming: false,
  audioPlayer: null,
  audioProcessor: null,
  analyser: null,
  sessionInitialized: false,
  sourceNode: null,
  loopbackGainNode: null,
  duckingGainNode: null,
  recordingDestination: null,
  mediaRecoder: null,
  audioBlob: [],

  setStreaming: (status: boolean) => set({ isStreaming: status }),
  //setMediaRecorder: (recorder: MediaRecorder) => set({ mediaRecoder: recorder }),
  setSessionInitialized: (status: boolean) =>
    set({ sessionInitialized: status }),
  setAudioProcessor: (processor) => set({ audioProcessor: processor }),
  resetAudioProcessor: () => set({ audioProcessor: null }),
  resetAudioBlob: () => set({ audioBlob: [] }),
  addAudioBlobParts: (blobParts: BlobPart[]) =>
    set((state) => ({ audioBlob: [...state.audioBlob, ...blobParts] })),
  initAudio: async (test: boolean) => {
    try {
      console.log("Initializing audio subsystem");

      // Create audio context with options that favor loudspeaker output
      const audioContext = new AudioContext({
        sampleRate: 24000,
      });

      const {
        echoSuppression,
        noiseSuppression,
        autoGainControl,
        inputDeviceId,
        outputDeviceId,
        enableRecording,
      } = useAudioConfigStore.getState();

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId:
            inputDeviceId !== "default" ? { exact: inputDeviceId } : undefined,
          echoCancellation: echoSuppression,
          noiseSuppression: noiseSuppression,
          autoGainControl: autoGainControl,
        },
      });

      const sourceNode = audioContext.createMediaStreamSource(audioStream);
      const duckingGainNode = audioContext.createGain();
      duckingGainNode.gain.value = 1;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;

      sourceNode.connect(analyser);

      const audioPlayer = new AudioPlayer();
      await audioPlayer.start(audioContext);
      audioPlayer.node?.connect(analyser);
      audioPlayer.node?.connect(duckingGainNode);
      duckingGainNode.connect(audioContext.destination);

      // Connect to destination with specific options to prefer loudspeaker
      // // @ts-ignore - TypeScript might not recognize this property
      // if (audioPlayer.node && window.navigator.standalone) {
      //   // Create a media element to help route audio to loudspeaker
      //   const audioElement = new Audio();
      //   audioElement.srcObject = new MediaStream();

      //   // Set audio element properties to prefer loudspeaker
      //   audioElement.setAttribute("playsinline", "");
      //   audioElement.setAttribute("autoplay", "");
      //   audioElement.volume = 1.0;
      // }

      // Connect the audio player to the destination
      if (audioPlayer.node) {
        if (
          outputDeviceId !== "default" &&
          "setSinkId" in AudioContext.prototype
        ) {
          try {
            // @ts-ignore - TypeScript might not recognize this property
            await audioContext.setSinkId(outputDeviceId);
            console.log(`Audio output set to device: ${outputDeviceId}`);
          } catch (err) {
            console.warn("Could not set audio output device:", err);
            useErrorStore
              .getState()
              .addError(
                "Could not set selected audio output device",
                "warning"
              );
          }
        }
        //audioPlayer.node.connect(audioContext.destination);
      }

      const recordingDestination = audioContext.createMediaStreamDestination();
      // Connect to recording destination if in test mode or if recording is enabled
      if (test) {
        sourceNode.connect(recordingDestination);
      }
      if (enableRecording) {
        sourceNode.connect(recordingDestination);
        audioPlayer.node?.connect(recordingDestination);
        const recorder = new MediaRecorder(recordingDestination.stream);
        set({ mediaRecoder: recorder });
      }

      // Initialize the audio processor
      if (!test) {
        const audioProcessor = new AudioProcessor(audioContext);
        await audioProcessor.init();
        set({ audioProcessor });
        // Connect the node
        if (audioProcessor.node) sourceNode.connect(audioProcessor.node);
      }
      // Apply audio config settings
      const { loopBackGain } = useAudioConfigStore.getState();
      if (loopBackGain > 0) {
        const loopbackGainNode = audioContext.createGain();
        loopbackGainNode.gain.value = loopBackGain;
        if (!test) {
          get().audioProcessor?.node?.connect(loopbackGainNode);
        } else sourceNode.connect(loopbackGainNode);
        loopbackGainNode.connect(audioContext.destination);
        set({ loopbackGainNode });
      }

      console.log("Audio subsystem initialized");
      set({
        audioContext,
        audioPlayer,
        duckingGainNode,
        analyser,
        audioStream,
        sourceNode,
        recordingDestination,
      });
    } catch (error) {
      console.error("Error initializing the audio subsystem:", error);
      useErrorStore
        .getState()
        .addError(
          `Error initializing the audio subsystem: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          "error"
        );
    }
  },

  cleanUpAudio: async () => {
    console.log("Cleaning up audio");
    const {
      audioStream,
      sourceNode,
      audioContext,
      audioPlayer,
      audioProcessor,
      loopbackGainNode,
      duckingGainNode,
      recordingDestination,
    } = get();

    recordingDestination?.stream.getTracks().forEach((track) => track.stop());
    audioStream?.getTracks().forEach((track) => track.stop());
    sourceNode?.disconnect();
    audioProcessor?.disconnect();
    loopbackGainNode?.disconnect();
    duckingGainNode?.disconnect();
    await audioPlayer?.stop();
    audioContext?.close();
    set({
      isStreaming: false,
      audioStream: null,
      audioContext: null,
      audioPlayer: null,
      audioProcessor: null,
      duckingGainNode: null,
      loopbackGainNode: null,
      recordingDestination: null,
    });
  },

  bargeIn: () => {
    const { audioPlayer } = get();
    if (audioPlayer) {
      audioPlayer.bargeIn();
    }
  },
}));
