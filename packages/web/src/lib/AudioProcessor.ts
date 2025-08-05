// import { useSocketStore } from "@/store/socketStore";

export class AudioProcessor {
  private audioContext: AudioContext;
  private workletNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private isProcessing: boolean = false;
  private onAudioProcessedCallback: ((data: string) => void) | null = null;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  get node() {
    return this.workletNode;
  }

  async init(): Promise<void> {
    try {
      console.log("Initialiazing AudioProcessor");
      // Create the source node from the microphone stream
      // Load the audio worklet module
      await this.audioContext.audioWorklet.addModule(
        "/lib/AudioProcessorWorklet.js"
      );

      // Create the audio worklet node
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-processor"
      );

      // Set up message handling for processed audio data
      this.workletNode.port.onmessage = (event) => {
        if (
          event.data.type === "audio-processed" &&
          this.onAudioProcessedCallback &&
          this.isProcessing
        ) {
          this.onAudioProcessedCallback(btoa(event.data.audioData));
        }
        // if (event.data.type === "audio-processed" && this.isProcessing)
        //   useSocketStore
        //     .getState()
        //     .emitEvent("audioInput", btoa(event.data.audioData));
        // if (event.data.type === "volume") {
        //   if (
        //     this.onVoiceDetectedCallback &&
        //     event.data.volume > this.threshold
        //   ) {
        //     this.onVoiceDetectedCallback();
        //   }
        // }
      };

      // We don't connect the worklet to the destination to avoid feedback
      // The worklet will process the audio and send it back via messages
    } catch (error) {
      console.error("Error initializing AudioProcessor:", error);
      throw error;
    }
  }

  start(onAudioProcessed: (data: string) => void): void {
    if (this.isProcessing) return;

    this.onAudioProcessedCallback = onAudioProcessed;
    this.isProcessing = true;

    // Tell the worklet to start processing
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: "start-processing",
      });
    }
  }

  stop(): void {
    console.log("Stopping AudioProcessor", { isProcessing: this.isProcessing });
    if (!this.isProcessing) return;

    // Tell the worklet to stop processing
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: "stop-processing",
      });
    }

    this.isProcessing = false;
    this.onAudioProcessedCallback = null;
  }

  disconnect(): void {
    this.stop();

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
  }
}
