import {
  BedrockRuntimeClient,
  BedrockRuntimeClientConfig,
  InvokeModelWithBidirectionalStreamCommand,
  InvokeModelWithBidirectionalStreamInput,
} from "@aws-sdk/client-bedrock-runtime";
import {
  NodeHttp2Handler,
  NodeHttp2HandlerOptions,
} from "@smithy/node-http-handler";
import { Provider } from "@smithy/types";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { InferenceConfig } from "./types";
import { Subject } from "rxjs";
import { take } from "rxjs/operators";
import { firstValueFrom } from "rxjs";
import {
  DefaultAudioInputConfiguration,
  DefaultAudioOutputConfiguration,
  DefaultSystemPrompt,
  DefaultTextConfiguration,
} from "./consts";
import { ToolRunner } from "./tools/toolRunner";
export interface S2SBidirectionalStreamClientConfig {
  requestHandlerConfig?:
    | NodeHttp2HandlerOptions
    | Provider<NodeHttp2HandlerOptions | void>;
  clientConfig: Partial<BedrockRuntimeClientConfig>;
  inferenceConfig?: InferenceConfig;
}

import * as _logger from "./utils/logger";

const logger = process.env.PROD ? _logger : console;

export class StreamSession {
  private audioBufferQueue: Buffer[] = [];
  private maxQueueSize = 200; // Maximum number of audio chunks to queue
  private isProcessingAudio = false;
  private isActive = true;

  constructor(
    private sessionId: string,
    private client: S2SBidirectionalStreamClient
  ) {}

  // Register event handlers for this specific session
  public onEvent(
    eventType: string,
    handler: (data: any) => void
  ): StreamSession {
    this.client.registerEventHandler(this.sessionId, eventType, handler);
    return this; // For chaining
  }

  public async setupPromptStart(voiceId?: string): Promise<void> {
    this.client.setupPromptStartEvent(this.sessionId, voiceId);
  }

  public async setupSystemPrompt(
    textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
    systemPromptContent: string = DefaultSystemPrompt
  ): Promise<void> {
    this.client.setupSystemPromptEvent(
      this.sessionId,
      textConfig,
      systemPromptContent
    );
  }

  public async setupHistoryData(
    textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
    historyData: { role: string; message: string }[]
  ) {
    this.client.setupHistoryEvent(this.sessionId, textConfig, historyData);
  }

  public async setupStartAudio(
    audioConfig: typeof DefaultAudioInputConfiguration = DefaultAudioInputConfiguration
  ): Promise<void> {
    this.client.setupStartAudioEvent(this.sessionId, audioConfig);
  }

  // Stream audio for this session
  public async streamAudio(audioData: Buffer): Promise<void> {
    // Check queue size to avoid memory issues
    if (this.audioBufferQueue.length >= this.maxQueueSize) {
      // Queue is full, drop oldest chunk
      this.audioBufferQueue.shift();
      logger.log("Audio queue full, dropping oldest chunk");
    }

    // Queue the audio chunk for streaming
    this.audioBufferQueue.push(audioData);
    this.processAudioQueue();
  }

  // Process audio queue for continuous streaming
  private async processAudioQueue() {
    if (
      this.isProcessingAudio ||
      this.audioBufferQueue.length === 0 ||
      !this.isActive
    )
      return;

    this.isProcessingAudio = true;
    try {
      // Process all chunks in the queue, up to a reasonable limit
      let processedChunks = 0;
      const maxChunksPerBatch = 5; // Process max 5 chunks at a time to avoid overload

      while (
        this.audioBufferQueue.length > 0 &&
        processedChunks < maxChunksPerBatch &&
        this.isActive
      ) {
        const audioChunk = this.audioBufferQueue.shift();
        if (audioChunk) {
          await this.client.streamAudioChunk(this.sessionId, audioChunk);
          processedChunks++;
        }
      }
    } finally {
      this.isProcessingAudio = false;

      // If there are still items in the queue, schedule the next processing using setTimeout
      if (this.audioBufferQueue.length > 0 && this.isActive) {
        setTimeout(() => this.processAudioQueue(), 0);
      }
    }
  }
  // Get session ID
  public getSessionId(): string {
    return this.sessionId;
  }

  public async endAudioContent(): Promise<void> {
    if (!this.isActive) return;
    await this.client.sendContentEnd(this.sessionId);
  }

  public async endPrompt(): Promise<void> {
    if (!this.isActive) return;
    await this.client.sendPromptEnd(this.sessionId);
  }

  public async close(): Promise<void> {
    if (!this.isActive) return;

    this.isActive = false;
    this.audioBufferQueue = []; // Clear any pending audio

    await this.client.sendSessionEnd(this.sessionId);
    logger.log(`Session ${this.sessionId} close completed`);
  }
}

// Session data type
interface SessionData {
  queue: Array<any>;
  queueSignal: Subject<void>;
  closeSignal: Subject<void>;
  responseSubject: Subject<any>;
  toolUseContent: any;
  toolUseId: string;
  toolName: string;
  responseHandlers: Map<string, (data: any) => void>;
  promptName: string;
  inferenceConfig: InferenceConfig;
  isActive: boolean;
  isPromptStartSent: boolean;
  isAudioContentStartSent: boolean;
  audioContentId: string;
}

export class S2SBidirectionalStreamClient {
  private bedrockRuntimeClient: BedrockRuntimeClient;
  private inferenceConfig: InferenceConfig;
  private activeSessions: Map<string, SessionData> = new Map();
  private sessionLastActivity: Map<string, number> = new Map();
  private sessionCleanupInProgress = new Set<string>();

  constructor(config: S2SBidirectionalStreamClientConfig) {
    const http2Client = new NodeHttp2Handler({
      requestTimeout: 300000,
      sessionTimeout: 300000,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 20,
      ...config.requestHandlerConfig,
    });

    if (!config.clientConfig.credentials) {
      throw new Error("No credentials provided");
    }

    this.bedrockRuntimeClient = new BedrockRuntimeClient({
      ...config.clientConfig,
      credentials: config.clientConfig.credentials,
      region: config.clientConfig.region || "us-east-1",
      requestHandler: http2Client,
    });

    this.inferenceConfig = config.inferenceConfig ?? {
      maxTokens: 1024,
      topP: 0.9,
      temperature: 0.7,
    };
  }

  public isSessionActive(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    return !!session && session.isActive;
  }

  public getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  public getLastActivityTime(sessionId: string): number {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  private updateSessionActivity(sessionId: string): void {
    this.sessionLastActivity.set(sessionId, Date.now());
  }

  public isCleanupInProgress(sessionId: string): boolean {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  // Create a new streaming session
  public createStreamSession(
    sessionId: string = randomUUID(),
    config?: S2SBidirectionalStreamClientConfig
  ): StreamSession {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Stream session with ID ${sessionId} already exists`);
    }

    const session: SessionData = {
      queue: [],
      queueSignal: new Subject<void>(),
      closeSignal: new Subject<void>(),
      responseSubject: new Subject<any>(),
      toolUseContent: null,
      toolUseId: "",
      toolName: "",
      responseHandlers: new Map(),
      promptName: randomUUID(),
      inferenceConfig: config?.inferenceConfig ?? this.inferenceConfig,
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: randomUUID(),
    };

    this.activeSessions.set(sessionId, session);

    return new StreamSession(sessionId, this);
  }

  private async processToolUse(
    toolName: string,
    input: string
  ): Promise<Object> {
    const res = await ToolRunner.getToolRunner().runTool(
      toolName.toLowerCase(),
      JSON.parse(input) ?? {}
    );
    logger.log("Tool result:", res);
    return res as Object;
  }

  // Stream audio for a specific session
  public async initiateSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Stream session ${sessionId} not found`);
    }

    try {
      // Set up initial events for this session
      this.setupSessionStartEvent(sessionId);

      // Create the bidirectional stream with session-specific async iterator
      const asyncIterable = this.createSessionAsyncIterable(sessionId);

      logger.log(`Starting bidirectional stream for session ${sessionId}...`);

      const response = await this.bedrockRuntimeClient.send(
        new InvokeModelWithBidirectionalStreamCommand({
          modelId: "amazon.nova-sonic-v1:0",
          body: asyncIterable,
        })
      );

      logger.log(
        `Stream established for session ${sessionId}, processing responses...`
      );

      // Process responses for this session
      await this.processResponseStream(sessionId, response);
    } catch (error) {
      logger.error(`Error in session ${sessionId}:`, error);
      this.dispatchEventForSession(sessionId, "error", {
        source: "bidirectionalStream",
        error,
      });

      // Make sure to clean up if there's an error
      if (session.isActive) {
        this.closeSession(sessionId);
      }
    }
  }

  // Dispatch events to handlers for a specific session
  private dispatchEventForSession(
    sessionId: string,
    eventType: string,
    data: any
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(data);
      } catch (e) {
        logger.error(
          `Error in ${eventType} handler for session ${sessionId}:`,
          e
        );
      }
    }

    // Also dispatch to "any" handlers
    const anyHandler = session.responseHandlers.get("any");
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data });
      } catch (e) {
        logger.error(`Error in 'any' handler for session ${sessionId}:`, e);
      }
    }
  }

  private createSessionAsyncIterable(
    sessionId: string
  ): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
    if (!this.isSessionActive(sessionId)) {
      logger.log(
        `Cannot create async iterable: Session ${sessionId} not active`
      );
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ value: undefined, done: true }),
        }),
      };
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(
        `Cannot create async iterable: Session ${sessionId} not found`
      );
    }

    let eventCount = 0;

    return {
      [Symbol.asyncIterator]: () => {
        logger.log(`AsyncIterable iterator requested for session ${sessionId}`);

        return {
          next: async (): Promise<
            IteratorResult<InvokeModelWithBidirectionalStreamInput>
          > => {
            try {
              // Check if session is still active
              if (!session.isActive || !this.activeSessions.has(sessionId)) {
                logger.log(
                  `Iterator closing for session ${sessionId}, done=true`
                );
                return { value: undefined, done: true };
              }
              // Wait for items in the queue or close signal
              if (session.queue.length === 0) {
                try {
                  await Promise.race([
                    firstValueFrom(session.queueSignal.pipe(take(1))),
                    firstValueFrom(session.closeSignal.pipe(take(1))).then(
                      () => {
                        throw new Error("Stream closed");
                      }
                    ),
                  ]);
                } catch (error) {
                  if (error instanceof Error) {
                    if (
                      error.message === "Stream closed" ||
                      !session.isActive
                    ) {
                      // This is an expected condition when closing the session
                      if (this.activeSessions.has(sessionId)) {
                        logger.log(`Session \${sessionId} closed during wait`);
                      }
                      return { value: undefined, done: true };
                    }
                  } else {
                    logger.error(`Error on event close`, error);
                  }
                }
              }

              // If queue is still empty or session is inactive, we're done
              if (session.queue.length === 0 || !session.isActive) {
                logger.log(`Queue empty or session inactive: ${sessionId}`);
                return { value: undefined, done: true };
              }

              // Get next item from the session's queue
              const nextEvent = session.queue.shift();
              eventCount++;
              if (nextEvent.event.audioInput) {
                //if (process.env.PROD === undefined) process.stdout.write(".");
              } else {
                logger.log(
                  `Sending event #${eventCount} for session ${sessionId}: ${JSON.stringify(
                    nextEvent
                  ).substring(0, 100)}...`
                );
              }

              return {
                value: {
                  chunk: {
                    bytes: new TextEncoder().encode(JSON.stringify(nextEvent)),
                  },
                },
                done: false,
              };
            } catch (error) {
              logger.error(`Error in session ${sessionId} iterator:`, error);
              session.isActive = false;
              return { value: undefined, done: true };
            }
          },

          return: async (): Promise<
            IteratorResult<InvokeModelWithBidirectionalStreamInput>
          > => {
            logger.debug(`Iterator return() called for session ${sessionId}`);
            session.isActive = false;
            return { value: undefined, done: true };
          },

          throw: async (
            error: any
          ): Promise<
            IteratorResult<InvokeModelWithBidirectionalStreamInput>
          > => {
            logger.error(
              `Iterator throw() called for session ${sessionId} with error:`,
              error
            );
            session.isActive = false;
            throw error;
          },
        };
      },
    };
  }

  // Process the response stream from AWS Bedrock
  private async processResponseStream(
    sessionId: string,
    response: any
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      for await (const event of response.body) {
        if (!session.isActive) {
          logger.log(
            `Session ${sessionId} is no longer active, stopping response processing`
          );
          break;
        }

        if (event.chunk?.bytes) {
          try {
            this.updateSessionActivity(sessionId);
            const textResponse = new TextDecoder().decode(event.chunk.bytes);

            try {
              const jsonResponse = JSON.parse(textResponse);
              if (jsonResponse.event?.contentStart) {
                this.dispatchEvent(
                  sessionId,
                  "contentStart",
                  jsonResponse.event.contentStart
                );
              } else if (jsonResponse.event?.textOutput) {
                this.dispatchEvent(
                  sessionId,
                  "textOutput",
                  jsonResponse.event.textOutput
                );
              } else if (jsonResponse.event?.audioOutput) {
                this.dispatchEvent(
                  sessionId,
                  "audioOutput",
                  jsonResponse.event.audioOutput
                );
              } else if (jsonResponse.event?.toolUse) {
                this.dispatchEvent(
                  sessionId,
                  "toolUse",
                  jsonResponse.event.toolUse
                );
                logger.debug(
                  `Tool use detected for session ${sessionId}:`,
                  jsonResponse.event
                );
                // Store tool use information for later
                session.toolUseContent = jsonResponse.event.toolUse;
                session.toolUseId = jsonResponse.event.toolUse.toolUseId;
                session.toolName = jsonResponse.event.toolUse.toolName;
              } else if (
                jsonResponse.event?.contentEnd &&
                jsonResponse.event?.contentEnd?.type === "TOOL"
              ) {
                // Process tool use
                logger.debug(
                  `Processing tool use for session ${sessionId}`,
                  session.toolUseContent
                );

                this.dispatchEvent(sessionId, "toolEnd", {
                  toolUseContent: session.toolUseContent,
                  toolUseId: session.toolUseId,
                  toolName: session.toolName,
                });

                logger.debug("calling tooluse");
                // Call external model
                const externalModelResult = await this.processToolUse(
                  session.toolName,
                  session.toolUseContent.content
                );

                // Send tool result
                this.sendToolResult(
                  sessionId,
                  session.toolUseId,
                  externalModelResult
                );

                // Also dispatch event about tool result
                this.dispatchEvent(sessionId, "toolResult", {
                  toolUseId: session.toolUseId,
                  result: externalModelResult,
                });
              } else {
                // Handle other events
                const eventKeys = Object.keys(jsonResponse.event || {});
                logger.debug(`Event keys for session ${sessionId}:`, eventKeys);
                logger.debug(`Handling other events`);
                if (eventKeys.length > 0) {
                  this.dispatchEvent(
                    sessionId,
                    eventKeys[0],
                    jsonResponse.event[eventKeys[0]]
                  );
                } else if (Object.keys(jsonResponse).length > 0) {
                  this.dispatchEvent(sessionId, "unknown", jsonResponse);
                }
              }
            } catch (e) {
              logger.error(
                `Raw text response for session ${sessionId} (parse error):`,
                textResponse
              );
            }
          } catch (e) {
            logger.error(
              `Error processing response chunk for session ${sessionId}:`,
              e
            );
          }
        } else if (event.modelStreamErrorException) {
          logger.error(
            `Model stream error for session ${sessionId}:`,
            event.modelStreamErrorException
          );
          this.dispatchEvent(sessionId, "error", {
            type: "modelStreamErrorException",
            details: event.modelStreamErrorException,
          });
        } else if (event.internalServerException) {
          logger.error(
            `Internal server error for session ${sessionId}:`,
            event.internalServerException
          );
          this.dispatchEvent(sessionId, "error", {
            type: "internalServerException",
            details: event.internalServerException,
          });
        }
      }

      logger.debug(
        `Response stream processing complete for session ${sessionId}`
      );
      this.dispatchEvent(sessionId, "streamComplete", {
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        `Error processing response stream for session ${sessionId}:`,
        error
      );
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        logger.error(`Session ${sessionId} not found -likely already closed`);
        return;
      }
      this.dispatchEvent(sessionId, "error", {
        source: "responseStream",
        message: "Error processing response stream",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Add an event to a session's queue
  private addEventToSessionQueue(sessionId: string, event: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    this.updateSessionActivity(sessionId);
    session.queue.push(event);
    session.queueSignal.next();
  }

  // Set up initial events for a session
  private setupSessionStartEvent(sessionId: string): void {
    logger.debug(`Setting up initial events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Session start event
    this.addEventToSessionQueue(sessionId, {
      event: {
        sessionStart: {
          inferenceConfiguration: session.inferenceConfig,
        },
      },
    });
  }
  public setupPromptStartEvent(sessionId: string, voiceId?: string): void {
    logger.debug(`Setting up prompt start event for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    // Prompt start event
    this.addEventToSessionQueue(sessionId, {
      event: {
        promptStart: {
          promptName: session.promptName,
          textOutputConfiguration: {
            mediaType: "text/plain",
          },
          audioOutputConfiguration: {
            ...DefaultAudioOutputConfiguration,
            voiceId,
          },
          toolUseOutputConfiguration: {
            mediaType: "application/json",
          },
          toolConfiguration: {
            tools: ToolRunner.getToolRunner().getSpecs(),
          },
        },
      },
    });
    session.isPromptStartSent = true;
  }

  public setupHistoryEvent(
    sessionId: string,
    textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
    historyContent: { role: string; message: string }[]
  ) {
    logger.debug(`Setting up systemPrompt events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    // Text content start
    historyContent.forEach((m) => {
      const textPromptID = randomUUID();
      this.addEventToSessionQueue(sessionId, {
        event: {
          contentStart: {
            promptName: session.promptName,
            contentName: textPromptID,
            type: "TEXT",
            role: m.role,
            interactive: true,
            textInputConfiguration: textConfig,
          },
        },
      });

      // Text input content
      this.addEventToSessionQueue(sessionId, {
        event: {
          textInput: {
            promptName: session.promptName,
            contentName: textPromptID,
            content: m.message,
          },
        },
      });

      // Text content end
      this.addEventToSessionQueue(sessionId, {
        event: {
          contentEnd: {
            promptName: session.promptName,
            contentName: textPromptID,
          },
        },
      });
    });
  }

  public setupSystemPromptEvent(
    sessionId: string,
    textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
    systemPromptContent: string = DefaultSystemPrompt
  ): void {
    logger.debug(`Setting up systemPrompt events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    // Text content start
    const textPromptID = randomUUID();
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: session.promptName,
          contentName: textPromptID,
          type: "TEXT",
          role: "SYSTEM",
          interactive: true,
          textInputConfiguration: textConfig,
        },
      },
    });

    // Text input content
    this.addEventToSessionQueue(sessionId, {
      event: {
        textInput: {
          promptName: session.promptName,
          contentName: textPromptID,
          content: systemPromptContent,
        },
      },
    });

    // Text content end
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: session.promptName,
          contentName: textPromptID,
        },
      },
    });
  }

  public setupStartAudioEvent(
    sessionId: string,
    audioConfig: typeof DefaultAudioInputConfiguration = DefaultAudioInputConfiguration
  ): void {
    logger.debug(
      `Setting up startAudioContent event for session ${sessionId}...`
    );
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    logger.debug(`Using audio content ID: ${session.audioContentId}`);
    // Audio content start
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: session.promptName,
          contentName: session.audioContentId,
          type: "AUDIO",
          role: "USER",
          interactive: true,
          audioInputConfiguration: audioConfig,
        },
      },
    });
    session.isAudioContentStartSent = true;
    logger.debug(`Initial events setup complete for session ${sessionId}`);
  }

  // Stream an audio chunk for a session
  public async streamAudioChunk(
    sessionId: string,
    audioData: Buffer
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive || !session.audioContentId) {
      throw new Error(`Invalid session ${sessionId} for audio streaming`);
    }
    // Convert audio to base64
    const base64Data = audioData.toString("base64");

    this.addEventToSessionQueue(sessionId, {
      event: {
        audioInput: {
          promptName: session.promptName,
          contentName: session.audioContentId,
          content: base64Data,
        },
      },
    });
  }

  // Send tool result back to the model
  private async sendToolResult(
    sessionId: string,
    toolUseId: string,
    result: any
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    logger.debug("inside tool result");
    if (!session || !session.isActive) return;

    logger.debug(
      `Sending tool result for session ${sessionId}, tool use ID: ${toolUseId}`
    );
    const contentId = randomUUID();

    // Tool content start
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentStart: {
          promptName: session.promptName,
          contentName: contentId,
          interactive: false,
          type: "TOOL",
          role: "TOOL",
          toolResultInputConfiguration: {
            toolUseId: toolUseId,
            type: "TEXT",
            textInputConfiguration: {
              mediaType: "text/plain",
            },
          },
        },
      },
    });

    // Tool content input
    const resultContent =
      typeof result === "string" ? result : JSON.stringify(result);
    this.addEventToSessionQueue(sessionId, {
      event: {
        toolResult: {
          promptName: session.promptName,
          contentName: contentId,
          content: resultContent,
        },
      },
    });

    // Tool content end
    this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: session.promptName,
          contentName: contentId,
        },
      },
    });

    logger.debug(`Tool result sent for session ${sessionId}`);
  }

  public async sendContentEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isAudioContentStartSent) return;

    await this.addEventToSessionQueue(sessionId, {
      event: {
        contentEnd: {
          promptName: session.promptName,
          contentName: session.audioContentId,
        },
      },
    });

    // Wait to ensure it's processed
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  public async sendPromptEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isPromptStartSent) return;

    await this.addEventToSessionQueue(sessionId, {
      event: {
        promptEnd: {
          promptName: session.promptName,
        },
      },
    });

    // Wait to ensure it's processed
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  public async sendSessionEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await this.addEventToSessionQueue(sessionId, {
      event: {
        sessionEnd: {},
      },
    });

    // Wait to ensure it's processed
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Now it's safe to clean up
    session.isActive = false;
    session.closeSignal.next();
    session.closeSignal.complete();
    this.activeSessions.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
    logger.debug(
      `Session ${sessionId} closed and removed from active sessions`
    );
  }

  // Register an event handler for a session
  public registerEventHandler(
    sessionId: string,
    eventType: string,
    handler: (data: any) => void
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.responseHandlers.set(eventType, handler);
  }

  // Dispatch an event to registered handlers
  private dispatchEvent(sessionId: string, eventType: string, data: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(data);
      } catch (e) {
        logger.error(
          `Error in ${eventType} handler for session ${sessionId}:`,
          e
        );
      }
    }

    // Also dispatch to "any" handlers
    const anyHandler = session.responseHandlers.get("any");
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data });
      } catch (e) {
        logger.error(`Error in 'any' handler for session ${sessionId}:`, e);
      }
    }
  }

  public async closeSession(sessionId: string): Promise<void> {
    if (this.sessionCleanupInProgress.has(sessionId)) {
      logger.debug(
        `Cleanup already in progress for session ${sessionId}, skipping`
      );
      return;
    }
    this.sessionCleanupInProgress.add(sessionId);
    try {
      logger.log(`Starting close process for session ${sessionId}`);
      await this.sendContentEnd(sessionId);
      await this.sendPromptEnd(sessionId);
      await this.sendSessionEnd(sessionId);
      logger.log(`Session ${sessionId} cleanup complete`);
    } catch (error) {
      logger.error(
        `Error during closing sequence for session ${sessionId}:`,
        error
      );

      // Ensure cleanup happens even if there's an error
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.isActive = false;
        this.activeSessions.delete(sessionId);
        this.sessionLastActivity.delete(sessionId);
      }
    } finally {
      // Always clean up the tracking set
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }

  // Same for forceCloseSession:
  public forceCloseSession(sessionId: string): void {
    if (
      this.sessionCleanupInProgress.has(sessionId) ||
      !this.activeSessions.has(sessionId)
    ) {
      logger.log(`Session ${sessionId} already being cleaned up or not active`);
      return;
    }

    this.sessionCleanupInProgress.add(sessionId);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) return;

      logger.log(`Force closing session ${sessionId}`);

      // Immediately mark as inactive and clean up resources
      session.isActive = false;
      session.closeSignal.next();
      session.closeSignal.complete();
      this.activeSessions.delete(sessionId);
      this.sessionLastActivity.delete(sessionId);

      logger.log(`Session ${sessionId} force closed`);
    } finally {
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }
}
