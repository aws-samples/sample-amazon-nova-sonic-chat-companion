import express, { Request, Response, Router } from "express";
import { MCPToolLoader } from "../tools/mcpToolLoader";
import { MCPToolRequest, MCPToolResponse } from "../types";
import { randomUUID } from "crypto";
import * as _logger from "../utils/logger";

const logger = process.env.PROD ? _logger : console;

const router: Router = express.Router();
const mcpLoader = MCPToolLoader.getInstance();

/**
 * GET /api/mcp/tools - List all MCP tool configurations
 */
router.get("/tools", async (req: Request, res: Response): Promise<void> => {
  try {
    logger.log("GET /api/mcp/tools - Fetching all MCP tools");

    const configService = mcpLoader.getConfigService();
    const configs = await configService.getAllConfigs();

    // Convert to response format (without clientSecret)
    // Ensure we always return an array, even if configs is null/undefined
    const response: MCPToolResponse[] = (configs || []).map((config) => ({
      id: config.id,
      name: config.name,
      description: config.description,
      endpoint: config.endpoint,
      clientId: config.clientId,
      enabled: config.enabled,
      additionalInstruction: config.additionalInstruction,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      status: config.enabled ? "active" : "disabled",
    }));

    res.json(response);
  } catch (error) {
    logger.error("Error fetching MCP tools:", error);
    res.status(500).json({
      error: "Failed to fetch MCP tools",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/mcp/tools/:id - Get a specific MCP tool configuration
 */
router.get("/tools/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    logger.log(`GET /api/mcp/tools/${id} - Fetching MCP tool`);

    const configService = mcpLoader.getConfigService();
    const config = await configService.getConfig(id);

    if (!config) {
      res.status(404).json({
        error: "MCP tool not found",
      });
      return;
    }

    const response: MCPToolResponse = {
      id: config.id,
      name: config.name,
      description: config.description,
      endpoint: config.endpoint,
      clientId: config.clientId,
      enabled: config.enabled,
      additionalInstruction: config.additionalInstruction,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      status: config.enabled ? "active" : "disabled",
    };

    res.json(response);
  } catch (error) {
    logger.error("Error fetching MCP tool %s", req.params.id, error);
    res.status(500).json({
      error: "Failed to fetch MCP tool",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/mcp/tools - Create a new MCP tool
 */
router.post("/tools", async (req: Request, res: Response): Promise<void> => {
  try {
    logger.log("POST /api/mcp/tools - Creating new MCP tool");

    const toolRequest: MCPToolRequest = req.body;

    // Validate required fields
    if (
      !toolRequest.name ||
      !toolRequest.endpoint ||
      !toolRequest.clientId ||
      !toolRequest.clientSecret
    ) {
      res.status(400).json({
        error: "Missing required fields",
        required: ["name", "endpoint", "clientId", "clientSecret"],
      });
      return;
    }

    const configService = mcpLoader.getConfigService();

    // Create configuration
    const toolId = randomUUID();
    const now = new Date().toISOString();

    const config = {
      id: toolId,
      name: toolRequest.name,
      description: toolRequest.description,
      endpoint: toolRequest.endpoint,
      clientId: toolRequest.clientId,
      enabled: toolRequest.enabled ?? true,
      additionalInstruction: toolRequest.additionalInstruction,
      createdAt: now,
      updatedAt: now,
    };

    // Save configuration
    await configService.addConfig(config);

    // Save client secret separately (encrypted)
    await configService.saveSecret(toolId, toolRequest.clientSecret);

    // Register the tool if enabled
    if (config.enabled) {
      try {
        await mcpLoader.registerMCPTool(config);
      } catch (error) {
        logger.error("Failed to register MCP tool %s:", toolId, error);
        // Tool is saved but not loaded - can be fixed by enabling/disabling
      }
    }

    logger.log(`Created MCP tool: ${config.name} (${toolId})`);

    // Return response (without clientSecret)
    const response: MCPToolResponse = {
      id: config.id,
      name: config.name,
      description: config.description,
      endpoint: config.endpoint,
      clientId: config.clientId,
      enabled: config.enabled,
      additionalInstruction: config.additionalInstruction,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      status: config.enabled ? "active" : "disabled",
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error("Error creating MCP tool:", error);
    res.status(500).json({
      error: "Failed to create MCP tool",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * PUT /api/mcp/tools/:id - Update an existing MCP tool
 */
router.put("/tools/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    logger.log(`PUT /api/mcp/tools/${id} - Updating MCP tool`);

    const updates: Partial<MCPToolRequest> = req.body;
    const configService = mcpLoader.getConfigService();

    // Check if tool exists
    const existingConfig = await configService.getConfig(id);
    if (!existingConfig) {
      res.status(404).json({
        error: "MCP tool not found",
      });
      return;
    }

    // Update configuration (excluding clientSecret which is handled separately)
    const configUpdates: any = {};

    if (updates.name !== undefined) configUpdates.name = updates.name;
    if (updates.description !== undefined)
      configUpdates.description = updates.description;
    if (updates.endpoint !== undefined)
      configUpdates.endpoint = updates.endpoint;
    if (updates.clientId !== undefined)
      configUpdates.clientId = updates.clientId;
    if (updates.enabled !== undefined) configUpdates.enabled = updates.enabled;
    if (updates.additionalInstruction !== undefined)
      configUpdates.additionalInstruction = updates.additionalInstruction;

    await configService.updateConfig(id, configUpdates);

    // Update client secret if provided
    if (updates.clientSecret) {
      await configService.saveSecret(id, updates.clientSecret);
    }

    // Reload the tool to apply changes
    try {
      await mcpLoader.reloadMCPTool(id);
    } catch (error) {
      logger.error("Failed to reload MCP tool %s:", id, error);
    }

    // Get updated config
    const updatedConfig = await configService.getConfig(id);
    if (!updatedConfig) {
      throw new Error("Failed to retrieve updated configuration");
    }

    logger.log(`Updated MCP tool: ${updatedConfig.name} (${id})`);

    const response: MCPToolResponse = {
      id: updatedConfig.id,
      name: updatedConfig.name,
      description: updatedConfig.description,
      endpoint: updatedConfig.endpoint,
      clientId: updatedConfig.clientId,
      enabled: updatedConfig.enabled,
      additionalInstruction: updatedConfig.additionalInstruction,
      createdAt: updatedConfig.createdAt,
      updatedAt: updatedConfig.updatedAt,
      status: updatedConfig.enabled ? "active" : "disabled",
    };

    res.json(response);
  } catch (error) {
    logger.error("Error updating MCP tool %s:", req.params.id, error);
    res.status(500).json({
      error: "Failed to update MCP tool",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * DELETE /api/mcp/tools/:id - Delete an MCP tool
 */
router.delete("/tools/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    logger.log(`DELETE /api/mcp/tools/${id} - Deleting MCP tool`);

    const configService = mcpLoader.getConfigService();

    // Unregister the tool first
    await mcpLoader.unregisterMCPTool(id);

    // Delete configuration and secret
    await configService.deleteConfig(id);

    logger.log(`Deleted MCP tool: ${id}`);

    res.status(204).send();
  } catch (error) {
    logger.error("Error deleting MCP tool %s:", req.params.id, error);
    res.status(500).json({
      error: "Failed to delete MCP tool",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/mcp/tools/:id/test - Test connection to an MCP tool
 */
router.post(
  "/tools/:id/test",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      logger.log(
        `POST /api/mcp/tools/${id}/test - Testing MCP tool connection`
      );

      const configService = mcpLoader.getConfigService();
      const oauthService = mcpLoader.getOAuthService();

      // Get tool configuration
      const config = await configService.getConfig(id);
      if (!config) {
        res.status(404).json({
          error: "MCP tool not found",
        });
        return;
      }

      // Try to get OAuth token
      try {
        await oauthService.getToken(id);

        res.json({
          success: true,
          message:
            "Successfully connected to MCP tool and obtained OAuth token",
        });
      } catch (error) {
        res.status(400).json({
          success: false,
          message: "Failed to connect to MCP tool",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      logger.error("Error testing MCP tool %s:", req.params.id, error);
      res.status(500).json({
        error: "Failed to test MCP tool",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * GET /api/mcp/status - Get MCP system status
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    logger.log("GET /api/mcp/status - Fetching MCP system status");

    const oauthService = mcpLoader.getOAuthService();
    const loadedTools = mcpLoader.getLoadedTools();
    const cacheStats = oauthService.getCacheStats();

    res.json({
      loadedTools: loadedTools.length,
      tools: loadedTools,
      tokenCache: cacheStats,
    });
  } catch (error) {
    logger.error("Error fetching MCP status:", error);
    res.status(500).json({
      error: "Failed to fetch MCP status",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
