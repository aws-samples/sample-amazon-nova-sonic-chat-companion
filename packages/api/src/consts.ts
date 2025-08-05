import { AudioType, AudioMediaType, TextMediaType } from "./types";

export const DefaultInferenceConfiguration = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
};

export const DefaultAudioInputConfiguration = {
  audioType: "SPEECH" as AudioType,
  encoding: "base64",
  mediaType: "audio/lpcm" as AudioMediaType,
  sampleRateHertz: 24000,
  sampleSizeBits: 16,
  channelCount: 1,
};

export const DefaultToolSchema = JSON.stringify({
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {},
  required: [],
});

export const DefaultTextConfiguration = {
  mediaType: "text/plain" as TextMediaType,
};

export const DefaultSystemPrompt =
  "You are a friend. The user and you will engage in a spoken " +
  "dialog exchanging the transcripts of a natural real-time conversation. Keep your responses short, " +
  "generally two or three sentences for chatty scenarios.";

export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: 24000,
  voiceId: "matthew",
};
