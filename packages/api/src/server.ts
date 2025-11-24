import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { fromIni, fromContainerMetadata } from "@aws-sdk/credential-providers";
import { S2SBidirectionalStreamClient } from "./client";
import { Buffer } from "node:buffer";
import * as _logger from "./utils/logger";
import fs from "fs-extra";
import { WaveFile } from "wavefile";
import { read, write } from "node:fs";
import { promises as fsPromises } from "fs";
import mcpRoutes from "./routes/mcpRoutes";
import { MCPToolLoader } from "./tools/mcpToolLoader";

const logger = process.env.PROD ? _logger : console;

// Create recordings directory if it doesn't exist
const RECORDINGS_DIR = path.join(__dirname, "../recordings");
fs.ensureDirSync(RECORDINGS_DIR);
logger.log(`Audio recordings will be saved to: ${RECORDINGS_DIR}`);

let tempCircularAudioOutBuffer: Buffer = Buffer.alloc(2000000, 0);
let readOffset = 0;
let writeEnd = 0;

// Audio recorder class to handle session recordings
class AudioRecorder {
  private sessionId: string;
  private inputChunks: Buffer[] = [];
  private outputChunks: Buffer[] = [];
  private recordingPath: string;
  private isRecording: boolean = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.recordingPath = path.join(
      RECORDINGS_DIR,
      `session-${timestamp}-${sessionId}.wav`
    );
    this.isRecording = process.env.ENABLE_RECORDING ? true : false;
    logger.log(`Created audio recorder for session ${sessionId}`);
  }

  // Record audio input (from user)
  recordInput(audioBuffer: Buffer): void {
    if (this.isRecording) {
      this.inputChunks.push(audioBuffer);
      const _output = tempCircularAudioOutBuffer.subarray(
        readOffset,
        readOffset + audioBuffer.length
      );
      const tempBuf = Buffer.alloc(_output.length, _output);
      this.outputChunks.push(tempBuf);
      _output.fill(0);
      readOffset += audioBuffer.length;
      if (readOffset >= writeEnd) {
        readOffset = 0;
        writeEnd = 0;
      }
    }
  }

  // Record audio output (from AI)
  recordOutput(audioBuffer: Buffer): void {
    if (this.isRecording) {
      this.outputChunks.push(audioBuffer);
    }
  }

  // Save the recording to a WAV file with 2 channels
  async saveRecording(): Promise<void> {
    if (
      !this.isRecording ||
      (this.inputChunks.length === 0 && this.outputChunks.length === 0)
    ) {
      logger.log(`No audio data to save for session ${this.sessionId}`);
      return;
    }

    try {
      // Create a new WAV file
      const wav = new WaveFile();

      // Process input chunks (16-bit PCM)
      let inputSamples: Int16Array | null = null;
      if (this.inputChunks.length > 0) {
        // Concatenate all input chunks
        const inputBuffer = Buffer.concat(this.inputChunks);

        // Convert to Int16Array (2 bytes per sample)
        inputSamples = new Int16Array(inputBuffer.length / 2);
        for (let i = 0; i < inputBuffer.length; i += 2) {
          // Little-endian conversion (LSB first)
          inputSamples[i / 2] = inputBuffer[i] | (inputBuffer[i + 1] << 8);
        }
      }

      // Process output chunks (also 16-bit PCM)
      let outputSamples: Int16Array | null = null;
      if (this.outputChunks.length > 0) {
        // Concatenate all output chunks
        const outputBuffer = Buffer.concat(this.outputChunks);

        // Convert to Int16Array (2 bytes per sample)
        outputSamples = new Int16Array(outputBuffer.length / 2);
        for (let i = 0; i < outputBuffer.length; i += 2) {
          // Little-endian conversion (LSB first)
          outputSamples[i / 2] = outputBuffer[i] | (outputBuffer[i + 1] << 8);
        }
      }

      // Determine the maximum length of both channels
      const inputLength = inputSamples ? inputSamples.length : 0;
      const outputLength = outputSamples ? outputSamples.length : 0;
      const maxLength = Math.max(inputLength, outputLength);

      // Create interleaved stereo samples
      const stereoSamples = new Int16Array(maxLength * 2);

      // Copy input audio to left channel (channel 0)
      if (inputSamples) {
        for (let i = 0; i < inputSamples.length; i++) {
          stereoSamples[i * 2] = inputSamples[i];
        }
      }

      // Copy output audio to right channel (channel 1)
      if (outputSamples) {
        for (let i = 0; i < outputSamples.length; i++) {
          stereoSamples[i * 2 + 1] = outputSamples[i];
        }
      }

      // Set up the WAV file format (16-bit PCM, 24000 Hz, 2 channels)
      wav.fromScratch(2, 24000, "16", stereoSamples);

      // Write the WAV file
      await fs.writeFile(this.recordingPath, Buffer.from(wav.toBuffer()));
      logger.log(
        `Saved audio recording for session ${this.sessionId} to ${this.recordingPath}`
      );

      // Clear the buffers
      this.inputChunks = [];
      this.outputChunks = [];
      this.isRecording = false;
    } catch (err) {
      logger.error(
        `Error saving audio recording for session ${this.sessionId}:`,
        err
      );
    }
  }

  // Stop recording
  stopRecording(): void {
    this.isRecording = false;
  }
}

// Map to store audio recorders for each session
const audioRecorders = new Map<string, AudioRecorder>();
// Configure AWS credentials

const AWS_PROFILE_NAME = process.env.AWS_PROFILE || "bedrock-test";

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

let audioInputEventLastMinute = new Array(60).fill(0);

const provider = process.env.PROD
  ? fromContainerMetadata()
  : fromIni({ profile: AWS_PROFILE_NAME });
// Create the AWS Bedrock client
const bedrockClient = new S2SBidirectionalStreamClient({
  requestHandlerConfig: {
    maxConcurrentStreams: 10,
  },
  clientConfig: {
    region: process.env.AWS_REGION || "us-east-1",
    credentials: provider,
  },
  inferenceConfig: {
    temperature: 0.7,
    maxTokens: 1024,
    topP: 0.9,
  },
});

setInterval(() => {
  audioInputEventLastMinute.shift();
  audioInputEventLastMinute.push(0);
}, 1000);

setInterval(() => {
  logger.debug(
    "Audio input events in the last 60 seconds: ",
    JSON.stringify(audioInputEventLastMinute)
  );
}, 60000);

// Function to clean up recordings older than 24 hours
async function cleanupOldRecordings(): Promise<void> {
  try {
    logger.log("Starting cleanup of old recordings...");

    // Get all files in the recordings directory
    const files = await fsPromises.readdir(RECORDINGS_DIR);
    const now = Date.now();
    const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    // Process each file
    for (const file of files) {
      if (!file.endsWith(".wav")) continue;

      const filePath = path.join(RECORDINGS_DIR, file);

      // Get file stats to check creation time
      const stats = await fsPromises.stat(filePath);
      const fileAge = now - stats.mtime.getTime();

      // If file is older than 24 hours, delete it
      if (fileAge > twentyFourHoursInMs) {
        await fsPromises.unlink(filePath);
        deletedCount++;
        logger.log(`Deleted old recording: ${file}`);
      }
    }

    logger.log(`Cleanup complete. Deleted ${deletedCount} old recordings.`);
  } catch (err) {
    logger.error("Error cleaning up old recordings:", err);
  }
}

// Periodically check for and close inactive sessions (every minute)
// Sessions with no activity for over 5 minutes will be force closed
setInterval(() => {
  logger.log("Session cleanup check");
  const now = Date.now();

  // Check all active sessions
  bedrockClient.getActiveSessions().forEach((sessionId) => {
    const lastActivity = bedrockClient.getLastActivityTime(sessionId);

    // If no activity for 5 minutes, force close
    if (now - lastActivity > 5 * 60 * 1000) {
      logger.log(
        `Closing inactive session after 5 minutes of inactivity`,
        sessionId
      );
      try {
        bedrockClient.forceCloseSession(sessionId);
      } catch (err) {
        logger.error(`Error force closing inactive session ${sessionId}:`, err);
      }
    }
  });
}, 60000);

// Run recording cleanup every hour
setInterval(cleanupOldRecordings, 60 * 60 * 1000);

setInterval(
  () => {
    const connectionCount = io.sockets.sockets.size;
    logger.log("Active socket connections", connectionCount);
  },
  process.env.PROD !== undefined ? 60000 : 10000
);

// Enable JSON body parsing for API routes
app.use(express.json());

// Mount MCP routes
app.use("/api/mcp", mcpRoutes);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../public")));

// Socket.IO connection handler
io.on("connection", (socket) => {
  logger.log("New client connected:", socket.id);

  // Create a unique session ID for this client
  const sessionId = socket.id;

  try {
    // Create session with the new API

    socket.on("sessionStart", () => {
      const session = bedrockClient.createStreamSession(sessionId);
      bedrockClient.initiateSession(sessionId);
      tempCircularAudioOutBuffer.fill(0);
      readOffset = 0;
      writeEnd = 0;
      // Set up event handlers
      session.onEvent("contentStart", (data) => {
        logger.debug("contentStart:", data);
        socket.emit("contentStart", data);
      });

      session.onEvent("textOutput", (data) => {
        logger.debug("Text output:", data.content.substring(0, 50) + "...");
        socket.emit("textOutput", data);
      });

      session.onEvent("audioOutput", (data) => {
        if (process.env.PROD === undefined) process.stdout.write("#");

        // Record the audio output
        const recorder = audioRecorders.get(sessionId);
        if (recorder && data.content) {
          try {
            // Convert base64 to buffer
            const audioBuffer = Buffer.from(data.content, "base64");

            // The base64 data is already in the correct format (16-bit PCM)
            // We can directly use it for recording
            // recorder.recordOutput(audioBuffer);
            audioBuffer.copy(tempCircularAudioOutBuffer, writeEnd);
            writeEnd += audioBuffer.length;
          } catch (err) {
            logger.error("Error processing AI audio for recording:", err);
          }
        }

        socket.emit("audioOutput", data);
      });

      session.onEvent("error", (data) => {
        logger.error("Error in session:", data);
        socket.emit("error", data);
      });

      session.onEvent("toolUse", (data) => {
        logger.log("Tool use detected:", data.toolName);
        socket.emit("toolUse", data);
      });

      session.onEvent("toolResult", (data) => {
        logger.log("Tool result received");
        socket.emit("toolResult", data);
      });

      session.onEvent("contentEnd", (data) => {
        logger.debug("Content end received");
        if (data.stopReason === "INTERRUPTED") {
          tempCircularAudioOutBuffer.fill(0);
          readOffset = 0;
          writeEnd = 0;
        }
        socket.emit("contentEnd", data);
      });

      session.onEvent("streamComplete", () => {
        logger.log("Stream completed for client:", socket.id);
        socket.emit("streamComplete");
      });

      socket.on("audioInput", async (audioData) => {
        try {
          // Convert base64 string to Buffer
          const audioBuffer =
            typeof audioData === "string"
              ? Buffer.from(audioData, "base64")
              : Buffer.from(audioData);

          audioInputEventLastMinute[audioInputEventLastMinute.length - 1] =
            audioInputEventLastMinute.at(-1) + 1;

          // Record the audio input
          if (!audioRecorders.has(sessionId)) {
            audioRecorders.set(sessionId, new AudioRecorder(sessionId));
          }

          const recorder = audioRecorders.get(sessionId);
          if (recorder) {
            recorder.recordInput(audioBuffer);
          }

          // Stream the audio
          await session.streamAudio(audioBuffer);
        } catch (err) {
          logger.error("Error processing audio:", err);
          socket.emit("error", {
            message: "Error processing audio",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      });

      socket.on("history", async (historyData) => {
        try {
          logger.log("History received", historyData);
          await session.setupHistoryData(undefined, historyData);
        } catch (err) {
          logger.error("Error processing audio:", err);
          socket.emit("error", {
            message: "Error processing audio",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      });

      socket.on("promptStart", async (params?: { voiceId?: string }) => {
        try {
          logger.log(
            `Prompt start received with voice ${params?.voiceId ?? "NONE"}`
          );
          await session.setupPromptStart(params?.voiceId);
        } catch (err) {
          logger.error("Error processing prompt start:", err);
          socket.emit("error", {
            message: "Error processing prompt start",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      });

      socket.on("systemPrompt", async (data) => {
        try {
          logger.log("System prompt received", data);
          await session.setupSystemPrompt(undefined, data);
        } catch (err) {
          logger.error("Error processing system prompt:", err);
          socket.emit("error", {
            message: "Error processing system prompt",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      });

      socket.on("audioStart", async (data) => {
        try {
          logger.log("Audio start received", data);
          await session.setupStartAudio();
        } catch (err) {
          logger.error("Error processing audio start:", err);
          socket.emit("error", {
            message: "Error processing audio start",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      });

      socket.on("stopAudio", async () => {
        try {
          logger.log(
            "Stop audio requested, beginning proper shutdown sequence"
          );

          // Save the audio recording
          const recorder = audioRecorders.get(sessionId);
          if (recorder) {
            await recorder.saveRecording();
          }

          // Chain the closing sequence
          await Promise.all([
            session
              .endAudioContent()
              .then(() => session.endPrompt())
              .then(() => session.close())
              .then(() => logger.log("Session cleanup complete")),
          ]);
        } catch (err) {
          logger.error("Error processing streaming end events:", err);
          socket.emit("error", {
            message: "Error processing streaming end events",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      });

      // Handle disconnection
      socket.on("disconnect", async () => {
        logger.log("Client disconnected abruptly:", socket.id);

        // Save the audio recording before cleanup
        const recorder = audioRecorders.get(sessionId);
        if (recorder) {
          await recorder.saveRecording();
          audioRecorders.delete(sessionId);
        }

        if (bedrockClient.isSessionActive(sessionId)) {
          try {
            logger.log(
              `Beginning cleanup for abruptly disconnected session: ${socket.id}`
            );

            // Add explicit timeouts to avoid hanging promises
            const cleanupPromise = Promise.race([
              (async () => {
                await session.endAudioContent();
                await session.endPrompt();
                await session.close();
              })(),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("Session cleanup timeout")),
                  3000
                )
              ),
            ]);

            await cleanupPromise;
            logger.log(
              `Successfully cleaned up session after abrupt disconnect: ${socket.id}`
            );
          } catch (err) {
            logger.error(
              `Error cleaning up session after disconnect: ${socket.id}`,
              err
            );
            try {
              bedrockClient.forceCloseSession(sessionId);
              logger.log(`Force closed session: ${sessionId}`);
            } catch (e) {
              logger.error(
                `Failed even force close for session: ${sessionId}`,
                e
              );
            }
          } finally {
            // Make sure socket is fully closed in all cases
            if (socket.connected) {
              socket.disconnect(true);
            }
          }
        }
      });
    });

    // Simplified audioInput handler without rate limiting
  } catch (err) {
    logger.error("Error creating session:", err);
    socket.emit("error", {
      message: "Failed to initialize session",
      details: err instanceof Error ? err.message : String(err),
    });
    socket.disconnect();
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Recordings endpoint - get all recordings or a specific one by session ID
app.get("/recordings", (req, res) => {
  try {
    const sessionId = req.query.id as string;

    // If session ID is provided, return that specific recording
    if (sessionId) {
      // List all files in the recordings directory
      const files = fs.readdirSync(RECORDINGS_DIR);

      // Find the recording file that contains the session ID
      const recordingFile = files.find((file) => file.includes(sessionId));

      if (!recordingFile) {
        res
          .status(404)
          .json({ error: "Recording not found for the specified session ID" });
      }

      const filePath = path.join(RECORDINGS_DIR, recordingFile!);
      res.sendFile(filePath);
      return;
    }

    // If no session ID provided, return a list of all recordings with metadata
    const files = fs.readdirSync(RECORDINGS_DIR);
    const recordings = files
      .filter((file) => file.endsWith(".wav") && !file.includes("/"))
      .map((file) => {
        const filePath = path.join(RECORDINGS_DIR, file);
        const stats = fs.statSync(filePath);

        // Extract session ID from filename
        // Format: session-timestamp-sessionId.wav
        const sessionIdMatch = file.match(/session-.*?-(.*?)\.wav$/);
        const extractedSessionId = sessionIdMatch
          ? sessionIdMatch[1]
          : "unknown";

        return {
          filename: file,
          sessionId: extractedSessionId,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
        };
      });
    res.status(200).json(recordings);
  } catch (err) {
    logger.error("Error handling recordings request:", err);
    res.status(500).json({ error: "Failed to retrieve recordings" });
  }
});

app.post("/oauth2/idpresponse", (req, res) => {
  logger.log("Received IDP response");
  res.redirect("/");
});

app.get("/oauth2/idpresponse", (req, res) => {
  logger.log("Received IDP response");
  res.redirect("/");
});

app.get("/oauth2/authorize", (req, res) => {
  logger.log("Received authorize request");
  res.redirect("/");
});

app.get("/stats", (req, res) => {
  res.status(200).json({ audioInputEventLastMinute });
});

// Start the server
const PORT = process.env.PORT || 3000;

// Initialize MCP tools on startup
const initializeServer = async () => {
  try {
    logger.log("Initializing server...");

    // Run initial cleanup
    await cleanupOldRecordings().catch((err) => {
      logger.error("Error during initial recordings cleanup:", err);
    });

    // Initialize MCP tools
    const mcpLoader = MCPToolLoader.getInstance();
    await mcpLoader.initializeMCPTools().catch((err) => {
      logger.error("Error initializing MCP tools:", err);
      // Don't fail server startup if MCP tools fail to load
    });

    logger.log("Server initialization complete");
  } catch (err) {
    logger.error("Error during server initialization:", err);
  }
};

// Start server and initialize
server.listen(PORT, async () => {
  logger.log(`Server listening on port ${PORT}`);
  logger.log(
    `Open http://localhost:${PORT} in your browser to access the application`
  );

  // Initialize after server starts
  await initializeServer();
});

const shutdown = async () => {
  logger.log("Shutting down server...");

  const forceExitTimer = setTimeout(() => {
    logger.error("Forcing server shutdown after timeout");
    process.exit(1);
  }, 5000);

  try {
    // Save all active recordings
    logger.log(`Saving ${audioRecorders.size} active recordings...`);
    await Promise.all(
      Array.from(audioRecorders.entries()).map(
        async ([sessionId, recorder]) => {
          try {
            await recorder.saveRecording();
            logger.log(
              `Saved recording for session ${sessionId} during shutdown`
            );
          } catch (err) {
            logger.error(
              `Error saving recording for session ${sessionId} during shutdown:`,
              err
            );
          }
        }
      )
    );
    audioRecorders.clear();

    // First close Socket.IO server which manages WebSocket connections
    await new Promise((resolve) => io.close(resolve));
    logger.log("Socket.IO server closed");

    // Then close all active sessions
    const activeSessions = bedrockClient.getActiveSessions();
    logger.log(`Closing ${activeSessions.length} active sessions...`);

    await Promise.all(
      activeSessions.map(async (sessionId) => {
        try {
          await bedrockClient.closeSession(sessionId);
          logger.log(`Closed session ${sessionId} during shutdown`);
        } catch (err) {
          logger.error(
            `Error closing session ${sessionId} during shutdown:`,
            err
          );
          bedrockClient.forceCloseSession(sessionId);
        }
      })
    );

    // Now close the HTTP server with a promise
    await new Promise((resolve) => server.close(resolve));
    clearTimeout(forceExitTimer);
    logger.log("Server shut down");
    process.exit(0);
  } catch (err) {
    logger.error("Error during server shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
