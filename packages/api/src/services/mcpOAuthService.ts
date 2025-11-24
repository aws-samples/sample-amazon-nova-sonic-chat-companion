import { CachedToken } from "../types";
import { MCPConfigService } from "./mcpConfigService";
import * as _logger from "../utils/logger";

const logger = process.env.PROD ? _logger : console;

interface TokenRefreshTimer {
  timerId: NodeJS.Timeout;
  expiresAt: number;
}

export class MCPOAuthService {
  private tokenCache: Map<string, CachedToken> = new Map();
  private refreshTimers: Map<string, TokenRefreshTimer> = new Map();
  private configService: MCPConfigService;

  // Refresh tokens 5 minutes before expiration
  private readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  constructor(configService: MCPConfigService) {
    this.configService = configService;
  }

  /**
   * Get a valid access token for a tool, fetching or refreshing as needed
   */
  async getToken(toolId: string): Promise<string> {
    const cached = this.tokenCache.get(toolId);

    // Check if we have a valid cached token
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug(`Using cached token for tool ${toolId}`);
      return cached.accessToken;
    }

    // Token expired or missing, fetch new one
    logger.log(`Fetching new token for tool ${toolId}`);
    return await this.fetchAndCacheToken(toolId);
  }

  /**
   * Discover OAuth token endpoint from MCP endpoint
   */
  private async discoverTokenEndpoint(
    mcpEndpoint: string
  ): Promise<{ token_endpoint: string; scopes_supported: string[] }> {
    try {
      logger.log(`Discovering OAuth endpoint from ${mcpEndpoint}`);

      // Step 1: Make unauthenticated request to get WWW-Authenticate header
      const response = await fetch(mcpEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });

      // Expect 401 with WWW-Authenticate header
      if (response.status !== 401) {
        throw new Error(`Expected 401 response, got ${response.status}`);
      }

      const wwwAuthenticate = response.headers.get("www-authenticate");
      if (!wwwAuthenticate) {
        throw new Error("WWW-Authenticate header not found in 401 response");
      }

      logger.log(`WWW-Authenticate header: ${wwwAuthenticate}`);

      // Step 2: Parse resource_metadata URL from WWW-Authenticate header
      // Format: Bearer resource_metadata="https://..."
      const metadataUrlMatch = wwwAuthenticate.match(
        /resource_metadata="([^"]+)"/
      );
      if (!metadataUrlMatch) {
        throw new Error(
          "resource_metadata not found in WWW-Authenticate header"
        );
      }

      const metadataUrl = metadataUrlMatch[1];
      logger.log(`Found resource metadata URL: ${metadataUrl}`);

      // Step 3: Fetch OAuth configuration from metadata URL
      const metadataResponse = await fetch(metadataUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!metadataResponse.ok) {
        throw new Error(
          `Failed to fetch OAuth metadata: ${metadataResponse.status} ${metadataResponse.statusText}`
        );
      }

      const metadata = await metadataResponse.json();
      logger.log(`OAuth metadata:`, metadata);

      // Step 4: Extract auth endpoint from metadata
      const authServers = metadata.authorization_servers;
      if (!authServers) {
        throw new Error("token_endpoint not found in OAuth metadata");
      }

      logger.log(`Discovered auth endpoint: ${authServers[0]}`);

      for (const path of [
        ".well-known/openid-configuration",
        ".well-known/oauth-authorization-server",
      ]) {
        const wellKnown = await fetch(`${authServers[0]}/${path}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });
        if (wellKnown.status === 200) {
          const metadata = await wellKnown.json();
          console.log(metadata);
          return metadata; //.authorization_endpoint;
        }
      }
      throw new Error(`Error discovering auth endpoint from ${mcpEndpoint}:`);
    } catch (error) {
      logger.error(
        "Error discovering auth endpoint from %s:",
        mcpEndpoint,
        error
      );
      throw error;
    }
  }

  /**
   * Fetch a new token from the OAuth endpoint and cache it
   */
  private async fetchAndCacheToken(toolId: string): Promise<string> {
    try {
      // Get tool configuration
      const config = await this.configService.getConfig(toolId);
      if (!config) {
        throw new Error(`Tool configuration not found for ${toolId}`);
      }

      // Get client secret
      const clientSecret = await this.configService.getSecret(toolId);
      if (!clientSecret) {
        throw new Error(`Client secret not found for tool ${toolId}`);
      }

      // Discover token endpoint from MCP endpoint
      const authEndpoint = await this.discoverTokenEndpoint(config.endpoint);

      // Prepare OAuth request
      console.log({ clientId: config.clientId, clientSecret });
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: clientSecret,
        scopes: authEndpoint.scopes_supported.join(" "),
      });

      // Request token from OAuth endpoint
      const response = await fetch(authEndpoint.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OAuth token request failed: ${response.status} ${errorText}`
        );
      }

      const tokenData = await response.json();

      if (!tokenData.access_token) {
        throw new Error("OAuth response missing access_token");
      }

      // Calculate expiration time (default to 1 hour if not provided)
      const expiresIn = tokenData.expires_in || 3600;
      const expiresAt = Date.now() + expiresIn * 1000;

      // Cache the token
      const cachedToken: CachedToken = {
        accessToken: tokenData.access_token,
        expiresAt,
        refreshToken: tokenData.refresh_token,
      };

      this.tokenCache.set(toolId, cachedToken);
      logger.log(
        `Cached token for tool ${toolId}, expires at ${new Date(expiresAt).toISOString()}`
      );

      // Schedule automatic refresh
      this.scheduleTokenRefresh(toolId, expiresAt);

      return cachedToken.accessToken;
    } catch (error) {
      logger.error("Error fetching token for tool %s:", toolId, error);
      throw error;
    }
  }

  /**
   * Schedule automatic token refresh before expiration
   */
  private scheduleTokenRefresh(toolId: string, expiresAt: number): void {
    // Clear existing timer if any
    this.clearRefreshTimer(toolId);

    // Calculate when to refresh (5 minutes before expiration)
    const refreshAt = expiresAt - this.REFRESH_BUFFER_MS;
    const delay = refreshAt - Date.now();

    // Only schedule if we have enough time before expiration
    if (delay > 0) {
      const timerId = setTimeout(async () => {
        logger.log(`Auto-refreshing token for tool ${toolId}`);
        try {
          await this.fetchAndCacheToken(toolId);
        } catch (error) {
          logger.error(
            `Error auto-refreshing token for tool ${toolId}:`,
            error
          );
          // Clear the cached token on error so next request will retry
          this.tokenCache.delete(toolId);
        }
      }, delay);

      this.refreshTimers.set(toolId, { timerId, expiresAt });
      logger.debug(
        `Scheduled token refresh for tool ${toolId} in ${delay / 1000}s`
      );
    }
  }

  /**
   * Clear the refresh timer for a tool
   */
  private clearRefreshTimer(toolId: string): void {
    const timer = this.refreshTimers.get(toolId);
    if (timer) {
      clearTimeout(timer.timerId);
      this.refreshTimers.delete(toolId);
    }
  }

  /**
   * Invalidate cached token for a tool
   */
  invalidateToken(toolId: string): void {
    logger.log(`Invalidating token for tool ${toolId}`);
    this.tokenCache.delete(toolId);
    this.clearRefreshTimer(toolId);
  }

  /**
   * Preload tokens for all enabled tools
   */
  async preloadTokens(): Promise<void> {
    try {
      const configs = await this.configService.getAllConfigs();
      const enabledConfigs = configs.filter((c) => c.enabled);

      logger.log(
        `Preloading tokens for ${enabledConfigs.length} enabled MCP tools`
      );

      await Promise.allSettled(
        enabledConfigs.map(async (config) => {
          try {
            await this.getToken(config.id);
            logger.log(`Successfully preloaded token for tool ${config.id}`);
          } catch (error) {
            logger.error(
              "Failed to preload token for tool %s:",
              config.id,
              error
            );
          }
        })
      );
    } catch (error) {
      logger.error("Error preloading tokens:", error);
    }
  }

  /**
   * Clear all cached tokens and timers
   */
  clearAll(): void {
    logger.log("Clearing all cached tokens and refresh timers");
    this.tokenCache.clear();
    this.refreshTimers.forEach((timer) => clearTimeout(timer.timerId));
    this.refreshTimers.clear();
  }

  /**
   * Get cache statistics (for monitoring/debugging)
   */
  getCacheStats(): {
    cachedTokens: number;
    activeRefreshTimers: number;
    tokens: Array<{
      toolId: string;
      expiresAt: string;
      hasRefreshToken: boolean;
    }>;
  } {
    return {
      cachedTokens: this.tokenCache.size,
      activeRefreshTimers: this.refreshTimers.size,
      tokens: Array.from(this.tokenCache.entries()).map(([toolId, token]) => ({
        toolId,
        expiresAt: new Date(token.expiresAt).toISOString(),
        hasRefreshToken: !!token.refreshToken,
      })),
    };
  }
}
