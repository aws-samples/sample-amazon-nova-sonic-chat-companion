import { Tool } from "./toolBase";
import { MCPConfigService } from "../services/mcpConfigService";
import { MCPOAuthService } from "../services/mcpOAuthService";
import * as _logger from "../utils/logger";
import { randomUUID } from "node:crypto";

const logger = process.env.PROD ? _logger : console;

/**
 * MCP Tool Wrapper - Adapts MCP tools to the existing Tool interface
 */
export class MCPTool implements Tool {
  name: string;
  description: string;
  answerInstructions?: string;

  private toolId: string;
  private endpoint: string;
  private oauthService: MCPOAuthService;
  private inputSchema: object;

  constructor(
    toolId: string,
    name: string,
    description: string,
    endpoint: string,
    inputSchema: object,
    oauthService: MCPOAuthService,
    answerInstructions?: string
  ) {
    this.toolId = toolId;
    this.name = name;
    this.description = description;
    this.endpoint = endpoint;
    this.inputSchema = inputSchema;
    this.oauthService = oauthService;
    this.answerInstructions = answerInstructions;
  }

  /**
   * Execute the MCP tool by calling its endpoint with OAuth authentication
   */
  async run(params: object): Promise<unknown> {
    try {
      logger.log(`Executing MCP tool ${this.name} (${this.toolId})`);
      logger.debug(`MCP tool params:`, params);

      // Get OAuth token
      const accessToken = await this.oauthService.getToken(this.toolId);

      // Call the MCP endpoint
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "tools/call",
          params: {
            name: this.name,
            arguments: params,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `MCP tool ${this.name} request failed: ${response.status} ${errorText}`
        );
        return {
          error: `MCP tool request failed: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      logger.log(`MCP tool ${this.name} executed successfully`);
      logger.debug(`MCP tool result:`, result);

      // Add answer instructions if provided
      if (this.answerInstructions) {
        return {
          ...result.result.content[0],
          answerInstructions: this.answerInstructions,
        };
      }

      return result.result.content[0];
    } catch (error) {
      logger.error(`Error executing MCP tool ${this.name}:`, error);
      return {
        error: `Error executing MCP tool: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Return the tool specification in the format expected by Bedrock
   */
  spec(): { [key: string]: unknown } {
    console.log(this.inputSchema);
    return {
      toolSpec: {
        name: this.name,
        description: this.description,
        inputSchema: {
          json: JSON.stringify(this.inputSchema),
        },
      },
    };
  }

  /**
   * Get the tool ID
   */
  getToolId(): string {
    return this.toolId;
  }
}
