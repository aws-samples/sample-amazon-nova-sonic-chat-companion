import { ToolRunner } from "./toolRunner";
import { MCPTool } from "./mcpTool";
import { MCPConfigService } from "../services/mcpConfigService";
import { MCPOAuthService } from "../services/mcpOAuthService";
import { MCPToolConfig } from "../types";
import * as _logger from "../utils/logger";

const logger = process.env.PROD ? _logger : console;

/**
 * MCP Tool Loader - Manages loading and registration of MCP tools
 */
export class MCPToolLoader {
  private static instance: MCPToolLoader;
  private configService: MCPConfigService;
  private oauthService: MCPOAuthService;
  private toolRunner: ToolRunner;
  private loadedTools: Map<string, MCPTool> = new Map();

  private constructor() {
    this.configService = new MCPConfigService();
    this.oauthService = new MCPOAuthService(this.configService);
    this.toolRunner = ToolRunner.getToolRunner();
  }

  static getInstance(): MCPToolLoader {
    if (!this.instance) {
      this.instance = new MCPToolLoader();
    }
    return this.instance;
  }

  /**
   * Initialize and load all enabled MCP tools from Parameter Store
   * This should be called on server startup
   */
  async initializeMCPTools(): Promise<void> {
    try {
      logger.log("Initializing MCP tools from Parameter Store...");

      // Load configurations
      const configs = await this.configService.getAllConfigs();
      const enabledConfigs = configs.filter((c) => c.enabled);

      logger.log(`Found ${enabledConfigs.length} enabled MCP tools`);

      // Preload OAuth tokens
      await this.oauthService.preloadTokens();

      // Register each enabled tool
      for (const config of enabledConfigs) {
        try {
          await this.registerMCPTool(config);
        } catch (error) {
          logger.error(
            "Failed to register MCP tool %s %s:",
            config.name,
            config.id,
            error
          );
        }
      }

      logger.log(
        `MCP tool initialization complete. Loaded ${this.loadedTools.size} tools`
      );
    } catch (error) {
      logger.error("Error initializing MCP tools:", error);
      throw error;
    }
  }

  /**
   * Register a single MCP tool
   */
  async registerMCPTool(config: MCPToolConfig): Promise<void> {
    try {
      logger.log(`Registering MCP tool: ${config.name} (${config.id})`);

      // Fetch tool schema from the MCP endpoint
      const schema = await this.fetchToolSchema(config);
      console.log(JSON.stringify(schema, undefined, 2));
      // Create MCP tool wrapper
      for (const tool of schema.result.tools) {
        const mcpTool = new MCPTool(
          config.id,
          tool.name,
          tool.description || config.description || "",
          config.endpoint,
          tool.inputSchema || {},
          this.oauthService,
          config.additionalInstruction ?? "" // answerInstructions can be added if needed
        );

        // Register with ToolRunner
        this.toolRunner.registerTool(mcpTool);

        // Keep track of loaded tools
        this.loadedTools.set(config.id, mcpTool);

        logger.log(
          `Successfully registered MCP tool: ${config.name} (${config.id})`
        );
      }
    } catch (error) {
      logger.error("Error registering MCP tool %s", config.id, error);
      throw error;
    }
  }

  /**
   * Fetch tool schema from MCP endpoint
   */
  private async fetchToolSchema(config: MCPToolConfig): Promise<{
    result: { tools: any[] };
  }> {
    try {
      // Get OAuth token
      const accessToken = await this.oauthService.getToken(config.id);

      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          })
        ),
      });

      if (!response.ok) {
        logger.warn(
          `Could not fetch schema for tool ${config.id}, using defaults`
        );
        return {
          result: { tools: [] },
        };
      }

      const schema = await response.json();
      return schema;
    } catch (error) {
      logger.warn(
        "Error fetching schema for tool %s, using defaults:",
        config.id,
        error
      );
      return {
        result: { tools: [] },
      };
    }
  }

  /**
   * Unregister an MCP tool by ID
   */
  async unregisterMCPTool(toolId: string): Promise<void> {
    try {
      const tool = this.loadedTools.get(toolId);
      if (!tool) {
        logger.warn(`MCP tool ${toolId} not found in loaded tools`);
        return;
      }

      logger.log(`Unregistering MCP tool: ${tool.name} (${toolId})`);

      // Note: ToolRunner doesn't have an unregister method, so we'd need to add one
      // For now, we just remove from our tracking
      this.loadedTools.delete(toolId);

      // Invalidate cached token
      this.oauthService.invalidateToken(toolId);

      logger.log(`Successfully unregistered MCP tool: ${toolId}`);
    } catch (error) {
      logger.error("Error unregistering MCP tool %s", toolId, error);
      throw error;
    }
  }

  /**
   * Reload a specific MCP tool (useful after config updates)
   */
  async reloadMCPTool(toolId: string): Promise<void> {
    try {
      logger.log(`Reloading MCP tool: ${toolId}`);

      // Get fresh configuration
      const config = await this.configService.getConfig(toolId);
      if (!config) {
        throw new Error(`Configuration not found for tool ${toolId}`);
      }

      // Unregister old version
      await this.unregisterMCPTool(toolId);

      // Register new version if enabled
      if (config.enabled) {
        await this.registerMCPTool(config);
      }

      logger.log(`Successfully reloaded MCP tool: ${toolId}`);
    } catch (error) {
      logger.error("Error reloading MCP tool %s:", toolId, error);
      throw error;
    }
  }

  /**
   * Reload all MCP tools
   */
  async reloadAllMCPTools(): Promise<void> {
    try {
      logger.log("Reloading all MCP tools...");

      // Clear all loaded tools
      const toolIds = Array.from(this.loadedTools.keys());
      for (const toolId of toolIds) {
        await this.unregisterMCPTool(toolId);
      }

      // Clear OAuth cache
      this.oauthService.clearAll();

      // Reinitialize
      await this.initializeMCPTools();

      logger.log("Successfully reloaded all MCP tools");
    } catch (error) {
      logger.error("Error reloading all MCP tools:", error);
      throw error;
    }
  }

  /**
   * Get list of loaded MCP tools
   */
  getLoadedTools(): Array<{ id: string; name: string; description: string }> {
    return Array.from(this.loadedTools.values()).map((tool) => ({
      id: tool.getToolId(),
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Get OAuth service instance (for direct access if needed)
   */
  getOAuthService(): MCPOAuthService {
    return this.oauthService;
  }

  /**
   * Get config service instance (for direct access if needed)
   */
  getConfigService(): MCPConfigService {
    return this.configService;
  }
}
