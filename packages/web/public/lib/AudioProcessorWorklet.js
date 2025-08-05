class AudioProcessorWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isProcessing = false;

    this.port.onmessage = (event) => {
      if (event.data.type === "start-processing") {
        this.isProcessing = true;
      } else if (event.data.type === "stop-processing") {
        this.isProcessing = false;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isProcessing) {
      return true;
    }

    const input = inputs[0][0]; // Assume mono input

    if (!input || input.length === 0) {
      return true;
    }

    outputs[0][0].set(input);
    // Convert to 16-bit PCM
    const pcmData = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      pcmData[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
    }

    // Convert to a byte string array (browser-safe way)
    const bytesStringData = this.arrayBufferToBytesString(pcmData.buffer);

    // Send the processed audio data back to the main thread
    // In a worklet, we don't have access to btoa, so we'll send the binary data
    // and convert it in the main thread
    this.port.postMessage({
      type: "audio-processed",
      audioData: bytesStringData,
    });

    // let average = 0;
    // for (let i = 0; i < input.length; i++) {
    //   average += Math.abs(input[i]);
    // }
    // average /= input.length;
    // this.port.postMessage({
    //   type: "volume",
    //   volume: average,
    // });

    return true;
  }

  // Convert ArrayBuffer to base64 string
  arrayBufferToBytesString(buffer) {
    const binary = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary.push(String.fromCharCode(bytes[i]));
    }

    return binary.join("");
  }
}

registerProcessor("audio-processor", AudioProcessorWorklet);
