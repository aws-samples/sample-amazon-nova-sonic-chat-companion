# WebSocket API Documentation

## Overview

This document describes the WebSocket API implemented by the Sonic Chat server (`packages/api/src/server.ts`). The API enables real-time bidirectional communication between clients and an AWS Bedrock AI service for voice-based conversations.

## Connection

### Establishing a Connection

The server uses Socket.IO for WebSocket communication on the default port 3000 (or as specified by `PORT` environment variable).

```javascript
// Connect to the WebSocket server
const socket = io("http://localhost:3000");
```

### Connection Events

#### `connection`

Triggered when a client successfully connects to the server.

- Server assigns a unique `sessionId` equal to the Socket.IO `socket.id`
- Server logs: `"New client connected: {socket.id}"`

## Session Lifecycle

### 1. Starting a Session

#### Client Event: `sessionStart`

Initiates a new streaming session with AWS Bedrock.

**Direction:** Client → Server

**Payload:** None

**Example:**

```javascript
socket.emit("sessionStart");
```

**Server Actions:**

- Creates a new streaming session
- Initiates connection to AWS Bedrock
- Sets up event handlers for the session
- Initializes audio recording buffers

### 2. Configuring the Session

#### Client Event: `history`

Provides conversation history for context.

**Direction:** Client → Server

**Payload:** History data object (format defined by AWS Bedrock API)

**Example:**

```javascript
socket.emit("history", historyData);
```

#### Client Event: `systemPrompt`

Sets the system prompt for the AI assistant.

**Direction:** Client → Server

**Payload:** System prompt string or object

**Example:**

```javascript
socket.emit("systemPrompt", {
  text: "You are a helpful AI assistant.",
});
```

#### Client Event: `promptStart`

Signals the start of a new prompt/turn.

**Direction:** Client → Server

**Payload:** Optional parameters object

**Parameters:**

- `voiceId` (optional): Voice ID for AI responses

**Example:**

```javascript
socket.emit("promptStart", { voiceId: "en-US-Neural2-A" });
```

#### Client Event: `audioStart`

Signals the start of audio streaming.

**Direction:** Client → Server

**Payload:** Optional configuration data

**Example:**

```javascript
socket.emit("audioStart");
```

### 3. Streaming Audio

#### Client Event: `audioInput`

Streams audio data from the client to the server.

**Direction:** Client → Server

**Payload:** Base64-encoded audio data (16-bit PCM, 24kHz)

**Format:**

- Audio Format: 16-bit PCM
- Sample Rate: 24kHz
- Encoding: Base64 string

**Example:**

```javascript
// audioData is a Buffer or base64 string
socket.emit("audioInput", audioData);
```

**Server Actions:**

- Converts base64 to Buffer
- Records audio for session replay (if `ENABLE_RECORDING` is set)
- Streams audio to AWS Bedrock service
- Tracks audio input events for monitoring

### 4. Receiving AI Responses

#### Server Event: `contentStart`

Signals the start of AI-generated content.

**Direction:** Server → Client

**Payload:** Content start data object

**Example:**

```javascript
socket.on("contentStart", (data) => {
  console.log("AI started generating content:", data);
});
```

#### Server Event: `textOutput`

Receives text output from the AI.

**Direction:** Server → Client

**Payload:** Object containing text content

**Properties:**

- `content`: The text content string

**Example:**

```javascript
socket.on("textOutput", (data) => {
  console.log("AI text:", data.content);
});
```

#### Server Event: `audioOutput`

Receives audio output from the AI.

**Direction:** Server → Client

**Payload:** Object containing audio content

**Properties:**

- `content`: Base64-encoded audio data (16-bit PCM, 24kHz)

**Format:**

- Audio Format: 16-bit PCM
- Sample Rate: 24kHz
- Encoding: Base64 string

**Example:**

```javascript
socket.on("audioOutput", (data) => {
  // Decode base64 audio and play it
  const audioBuffer = Buffer.from(data.content, "base64");
  playAudio(audioBuffer);
});
```

**Note:** Audio output is recorded by the server for session replay if recording is enabled.

#### Server Event: `toolUse`

Indicates the AI is using a tool.

**Direction:** Server → Client

**Payload:** Object containing tool information

**Properties:**

- `toolName`: Name of the tool being used

**Example:**

```javascript
socket.on("toolUse", (data) => {
  console.log("AI using tool:", data.toolName);
});
```

#### Server Event: `toolResult`

Provides the result of a tool execution.

**Direction:** Server → Client

**Payload:** Tool result data object

**Example:**

```javascript
socket.on("toolResult", (data) => {
  console.log("Tool result received:", data);
});
```

#### Server Event: `contentEnd`

Signals the end of AI-generated content for the current turn.

**Direction:** Server → Client

**Payload:** Object containing end information

**Properties:**

- `stopReason`: Reason for stopping (e.g., "INTERRUPTED")

**Example:**

```javascript
socket.on("contentEnd", (data) => {
  console.log("Content ended:", data.stopReason);
});
```

**Server Actions:**

- If `stopReason` is "INTERRUPTED", clears audio buffers

#### Server Event: `streamComplete`

Signals that the entire stream has completed.

**Direction:** Server → Client

**Payload:** None

**Example:**

```javascript
socket.on("streamComplete", () => {
  console.log("Stream completed");
});
```

### 5. Stopping a Session

#### Client Event: `stopAudio`

Stops the audio streaming and initiates session cleanup.

**Direction:** Client → Server

**Payload:** None

**Example:**

```javascript
socket.emit("stopAudio");
```

**Server Actions:**

1. Saves the audio recording (if enabled)
2. Ends audio content streaming
3. Ends the current prompt
4. Closes the session
5. Logs: `"Session cleanup complete"`

### 6. Disconnection

#### Client Event: `disconnect`

Triggered when a client disconnects (abrupt or intentional).

**Direction:** Client → Server (automatic)

**Server Actions:**

1. Logs: `"Client disconnected abruptly: {socket.id}"`
2. Saves the audio recording (if enabled)
3. Attempts graceful session cleanup:
   - Ends audio content
   - Ends prompt
   - Closes session
4. If cleanup fails after 3 seconds, force closes the session
5. Removes audio recorder from memory
6. Disconnects the socket if still connected

## Error Handling

#### Server Event: `error`

Emitted when an error occurs during processing.

**Direction:** Server → Client

**Payload:** Error object

**Properties:**

- `message`: Human-readable error message
- `details`: Detailed error information (if available)

**Example:**

```javascript
socket.on("error", (error) => {
  console.error("Error:", error.message);
  console.error("Details:", error.details);
});
```

**Common Error Scenarios:**

- Audio processing errors
- Session initialization failures
- AWS Bedrock service errors
- Invalid audio format
- System prompt configuration errors

## Session Management

### Automatic Session Cleanup

The server automatically manages session lifecycle:

1. **Inactive Session Cleanup** (every 60 seconds)

   - Sessions with no activity for 5+ minutes are force closed
   - Prevents resource leaks from abandoned connections

2. **Recording Cleanup** (every 60 minutes)
   - Audio recordings older than 24 hours are automatically deleted
   - Prevents disk space exhaustion

### Session Monitoring

The server tracks:

- Active socket connections (logged every 10-60 seconds)
- Audio input events per second (60-second rolling window)
- Active Bedrock sessions
- Last activity time per session

## Audio Recording

### Recording Configuration

Enable recording by setting the environment variable:

```bash
ENABLE_RECORDING=true
```

### Recording Format

- **File Format:** WAV (stereo)
- **Sample Rate:** 24kHz
- **Bit Depth:** 16-bit PCM
- **Channels:** 2
  - Left Channel (0): User audio input
  - Right Channel (1): AI audio output
- **Location:** `packages/api/recordings/`
- **Filename Pattern:** `session-{timestamp}-{sessionId}.wav`

### Recording Lifecycle

1. Recording starts when first `audioInput` is received
2. Both user and AI audio are recorded in real-time
3. Recording is saved when:
   - Client emits `stopAudio`
   - Client disconnects
   - Server shuts down
4. Recordings older than 24 hours are automatically deleted

## REST Endpoints

While primarily a WebSocket API, the server also exposes several HTTP endpoints:

### `GET /health`

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-10-29T19:24:00.000Z"
}
```

### `GET /recordings`

List all available recordings or retrieve a specific recording.

**Query Parameters:**

- `id` (optional): Session ID to retrieve specific recording

**Response (without ID):**

```json
[
  {
    "filename": "session-2025-10-29T19-00-00-000Z-abc123.wav",
    "sessionId": "abc123",
    "path": "/path/to/recording.wav",
    "size": 1234567,
    "createdAt": "2025-10-29T19:00:00.000Z",
    "modifiedAt": "2025-10-29T19:05:00.000Z"
  }
]
```

**Response (with ID):**
Returns the WAV file as binary data.

### `GET /stats`

Get audio input statistics.

**Response:**

```json
{
  "audioInputEventLastMinute": [0, 5, 10, 8, ...]
}
```

Returns an array of 60 numbers representing audio input events per second for the last minute.

## Complete Usage Example

```javascript
// Initialize Socket.IO connection
const socket = io("http://localhost:3000");

// Set up event listeners
socket.on("connect", () => {
  console.log("Connected to server");

  // Start a new session
  socket.emit("sessionStart");

  // Configure the session
  socket.emit("systemPrompt", {
    text: "You are a helpful assistant.",
  });

  socket.emit("promptStart", { voiceId: "en-US-Neural2-A" });
  socket.emit("audioStart");
});

// Handle AI responses
socket.on("contentStart", (data) => {
  console.log("AI started responding");
});

socket.on("textOutput", (data) => {
  console.log("AI:", data.content);
});

socket.on("audioOutput", (data) => {
  // Decode and play audio
  const audioBuffer = Buffer.from(data.content, "base64");
  playAudioBuffer(audioBuffer);
});

socket.on("toolUse", (data) => {
  console.log("AI is using:", data.toolName);
});

socket.on("contentEnd", (data) => {
  console.log("Response complete:", data.stopReason);
});

// Handle errors
socket.on("error", (error) => {
  console.error("Error:", error.message);
});

// Stream audio input
function sendAudioChunk(audioBuffer) {
  const base64Audio = audioBuffer.toString("base64");
  socket.emit("audioInput", base64Audio);
}

// Stop the session
function stopSession() {
  socket.emit("stopAudio");
}

// Clean disconnect
socket.on("disconnect", () => {
  console.log("Disconnected from server");
});
```

## Best Practices

1. **Always start with `sessionStart`** before sending any other events
2. **Configure session settings** (system prompt, history) before streaming audio
3. **Handle errors gracefully** by listening to the `error` event
4. **Stop sessions properly** using `stopAudio` rather than abrupt disconnection
5. **Monitor `contentEnd`** to know when the AI has finished responding
6. **Respect audio format requirements** (16-bit PCM, 24kHz, base64-encoded)
7. **Implement reconnection logic** for production applications
8. **Handle tool use events** to provide user feedback when AI is performing actions

## Performance Considerations

- Audio input events are tracked and logged every 60 seconds
- Circular buffers are used for audio output to optimize memory usage
- Sessions automatically timeout after 5 minutes of inactivity
- Maximum concurrent streams: 10 (configurable)
- Recording cleanup runs hourly to prevent disk space issues

## Security Considerations

- AWS credentials are required (via IAM role or profile)
- No built-in authentication on WebSocket connections
- Consider implementing authentication before production deployment
- Audio recordings contain sensitive conversation data
- Recordings are stored on the server filesystem

## Environment Variables

- `PORT`: Server port (default: 3000)
- `AWS_PROFILE`: AWS profile name (default: "bedrock-test")
- `AWS_REGION`: AWS region (default: "us-east-1")
- `ENABLE_RECORDING`: Enable audio recording (default: false)
- `PROD`: Production mode flag (affects logging and timing)
