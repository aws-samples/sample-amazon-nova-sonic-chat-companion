import { useErrorStore } from "@/store/errorStore";

export class AudioPlayer {
  private workletNode: AudioWorkletNode | null = null;
  private onAudioPlayedListeners: ((samples: Float32Array) => void)[] = [];
  private initialized: boolean = false;

  constructor() {
    this.onAudioPlayedListeners = [];
    this.initialized = false;
  }

  get node() {
    return this.workletNode;
  }

  addEventListener(event: string, callback: (samples: Float32Array) => void) {
    switch (event) {
      case "onAudioPlayed":
        this.onAudioPlayedListeners.push(callback);
        break;
      default:
        console.error(
          "Listener registered for event type: " +
            JSON.stringify(event) +
            " which is not supported"
        );
    }
  }

  async start(audioContext: AudioContext) {
    if (!audioContext) {
      console.error("Audio context or analyser is not initialized.");
      useErrorStore
        .getState()
        .addError("Audio context or analyser is not initialized.", "error");
      return;
    }
    // Load the audio worklet module
    await audioContext.audioWorklet.addModule(
      "/lib/AudioPlayerProcessor.worklet.js"
    );

    // Create the audio worklet node
    this.workletNode = new AudioWorkletNode(
      audioContext,
      "audio-player-processor"
    );

    // Set up message handling for audio data
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === "audio-processed") {
        const samples = new Float32Array(event.data.samples);

        this.onAudioPlayedListeners.forEach((listener) => listener(samples));
      }
    };

    this.maybeOverrideInitialBufferLength();
    this.initialized = true;
  }

  bargeIn() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: "barge-in",
      });
    }
  }

  stop() {
    this.bargeIn();
  }

  private maybeOverrideInitialBufferLength() {
    if (!this.workletNode) return;

    // Read a user-specified initial buffer length from the URL parameters to help with tinkering
    const params = new URLSearchParams(window.location.search);
    const value = params.get("audioPlayerInitialBufferLength");
    if (value === null) {
      return; // No override specified
    }
    const bufferLength = parseInt(value);
    if (isNaN(bufferLength)) {
      console.error(
        "Invalid audioPlayerInitialBufferLength value:",
        JSON.stringify(value)
      );
      return;
    }
    this.workletNode.port.postMessage({
      type: "initial-buffer-length",
      bufferLength: bufferLength,
    });
  }

  playAudio(samples: Float32Array) {
    if (!this.initialized || !this.workletNode) {
      console.error(
        "The audio player is not initialized. Call init() before attempting to play audio."
      );
      return;
    }
    this.workletNode.port.postMessage({
      type: "audio",
      audioData: samples,
    });
  }
}
