import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
  DeleteParameterCommand,
  ParameterType,
} from "@aws-sdk/client-ssm";
import { MCPToolConfig } from "../types";
import * as _logger from "../utils/logger";

const logger = process.env.PROD ? _logger : console;

export class MCPConfigService {
  private ssmClient: SSMClient;
  private configParameterName: string;
  private toolSecretPrefix: string;

  constructor(region: string = process.env.AWS_REGION || "us-east-1") {
    this.ssmClient = new SSMClient({ region });

    const apiName = process.env.API_NAME || "sonic-chat";
    this.configParameterName = `/${apiName}/mcp/config`;
    this.toolSecretPrefix = `/${apiName}/mcp/tools`;
  }

  /**
   * Get all MCP tool configurations from Parameter Store
   */
  async getAllConfigs(): Promise<MCPToolConfig[]> {
    try {
      const command = new GetParameterCommand({
        Name: this.configParameterName,
      });

      const response = await this.ssmClient.send(command);

      if (!response.Parameter?.Value) {
        logger.log("No MCP configurations found, returning empty array");
        return [];
      }

      const configs = JSON.parse(response.Parameter.Value) as MCPToolConfig[];
      logger.log(`Loaded ${configs.length} MCP tool configurations`);
      return configs;
    } catch (error: any) {
      if (error.name === "ParameterNotFound") {
        logger.log("MCP config parameter not found, returning empty array");
        return [];
      }
      logger.error("Error loading MCP configurations:", error);
      throw error;
    }
  }

  /**
   * Save all MCP tool configurations to Parameter Store
   */
  async saveAllConfigs(configs: MCPToolConfig[]): Promise<void> {
    try {
      const command = new PutParameterCommand({
        Name: this.configParameterName,
        Value: JSON.stringify(configs),
        Type: ParameterType.STRING,
        Overwrite: true,
        Description: "MCP tool configurations",
      });

      await this.ssmClient.send(command);
      logger.log(`Saved ${configs.length} MCP tool configurations`);
    } catch (error) {
      logger.error("Error saving MCP configurations:", error);
      throw error;
    }
  }

  /**
   * Get a specific tool configuration by ID
   */
  async getConfig(toolId: string): Promise<MCPToolConfig | null> {
    const configs = await this.getAllConfigs();
    return configs.find((c) => c.id === toolId) || null;
  }

  /**
   * Add a new MCP tool configuration
   */
  async addConfig(config: MCPToolConfig): Promise<void> {
    const configs = await this.getAllConfigs();

    // Check for duplicate ID
    if (configs.some((c) => c.id === config.id)) {
      throw new Error(`MCP tool with ID ${config.id} already exists`);
    }

    configs.push(config);
    await this.saveAllConfigs(configs);
  }

  /**
   * Update an existing MCP tool configuration
   */
  async updateConfig(
    toolId: string,
    updates: Partial<MCPToolConfig>
  ): Promise<void> {
    const configs = await this.getAllConfigs();
    const index = configs.findIndex((c) => c.id === toolId);

    if (index === -1) {
      throw new Error(`MCP tool with ID ${toolId} not found`);
    }

    configs[index] = {
      ...configs[index],
      ...updates,
      id: toolId, // Prevent ID changes
      updatedAt: new Date().toISOString(),
    };

    await this.saveAllConfigs(configs);
  }

  /**
   * Delete an MCP tool configuration
   */
  async deleteConfig(toolId: string): Promise<void> {
    const configs = await this.getAllConfigs();
    const filteredConfigs = configs.filter((c) => c.id !== toolId);

    if (filteredConfigs.length === configs.length) {
      throw new Error(`MCP tool with ID ${toolId} not found`);
    }

    await this.saveAllConfigs(filteredConfigs);

    // Also delete the associated secret
    try {
      await this.deleteSecret(toolId);
    } catch (error) {
      logger.warn("Error deleting secret for tool %s:", toolId, error);
    }
  }

  /**
   * Get the client secret for a specific tool (SecureString)
   */
  async getSecret(toolId: string): Promise<string | null> {
    try {
      const command = new GetParameterCommand({
        Name: `${this.toolSecretPrefix}/${toolId}/secret`,
        WithDecryption: true,
      });

      const response = await this.ssmClient.send(command);
      return response.Parameter?.Value || null;
    } catch (error: any) {
      if (error.name === "ParameterNotFound") {
        logger.warn(`Secret not found for tool ${toolId}`);
        return null;
      }
      logger.error("Error getting secret for tool %s:", toolId, error);
      throw error;
    }
  }

  /**
   * Save the client secret for a specific tool (SecureString with KMS encryption)
   */
  async saveSecret(toolId: string, clientSecret: string): Promise<void> {
    try {
      const command = new PutParameterCommand({
        Name: `${this.toolSecretPrefix}/${toolId}/secret`,
        Value: clientSecret,
        Type: ParameterType.SECURE_STRING,
        Overwrite: true,
        Description: `Client secret for MCP tool ${toolId}`,
      });

      await this.ssmClient.send(command);
      logger.log(`Saved secret for tool ${toolId}`);
    } catch (error) {
      logger.error("Error saving secret for tool %s:", toolId, error);
      throw error;
    }
  }

  /**
   * Delete the client secret for a specific tool
   */
  async deleteSecret(toolId: string): Promise<void> {
    try {
      const command = new DeleteParameterCommand({
        Name: `${this.toolSecretPrefix}/${toolId}/secret`,
      });

      await this.ssmClient.send(command);
      logger.log(`Deleted secret for tool ${toolId}`);
    } catch (error: any) {
      if (error.name === "ParameterNotFound") {
        logger.warn(`Secret not found for tool ${toolId}, nothing to delete`);
        return;
      }
      logger.error("Error deleting secret for tool %s:", toolId, error);
      throw error;
    }
  }
}
