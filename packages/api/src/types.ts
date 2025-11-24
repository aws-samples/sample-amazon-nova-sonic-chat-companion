export interface InferenceConfig {
  readonly maxTokens: number;
  readonly topP: number;
  readonly temperature: number;
}

export type ContentType = "AUDIO" | "TEXT" | "TOOL";
export type AudioType = "SPEECH";
export type AudioMediaType =
  | "audio/wav"
  | "audio/lpcm"
  | "audio/mulaw"
  | "audio/mpeg";
export type TextMediaType = "text/plain" | "application/json";

export interface AudioConfiguration {
  readonly audioType: AudioType;
  readonly mediaType: AudioMediaType;
  readonly sampleRateHertz: number;
  readonly sampleSizeBits: number;
  readonly channelCount: number;
  readonly encoding: string;
  readonly voiceId?: string;
}

export interface TextConfiguration {
  readonly mediaType: TextMediaType;
}

export interface ToolConfiguration {
  readonly toolUseId: string;
  readonly type: "TEXT";
  readonly textInputConfiguration: {
    readonly mediaType: "text/plain";
  };
}

// MCP Tool Types
export interface MCPToolConfig {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  clientId: string;
  enabled: boolean;
  additionalInstruction?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MCPToolSecret {
  toolId: string;
  clientSecret: string;
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

export interface MCPToolRequest {
  name: string;
  description?: string;
  endpoint: string;
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  additionalInstruction?: string;
}

export interface MCPToolResponse {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  clientId: string;
  enabled: boolean;
  additionalInstruction?: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "error" | "disabled";
}
