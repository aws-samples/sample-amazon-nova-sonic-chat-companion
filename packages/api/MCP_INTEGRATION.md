# MCP Tool Integration Documentation

## Overview

This document describes the Model Context Protocol (MCP) tool integration implemented in the Sonic Chat API. The integration allows users to dynamically add external MCP tools through the frontend, which are then available for use in AI conversations.

## Architecture

### Components

1. **Parameter Store Service** (`src/services/mcpConfigService.ts`)

   - Manages MCP tool configurations in AWS Parameter Store
   - Stores tool metadata as JSON in `/{apiName}/mcp/config`
   - Stores client secrets as encrypted SecureStrings in `/{apiName}/mcp/tools/{toolId}/secret`

2. **OAuth Service** (`src/services/mcpOAuthService.ts`)

   - Manages OAuth token lifecycle with in-memory caching
   - Automatically refreshes tokens 5 minutes before expiration
   - Supports client credentials grant flow

3. **MCP Tool Wrapper** (`src/tools/mcpTool.ts`)

   - Adapts MCP tools to the existing Tool interface
   - Handles OAuth authentication for tool calls
   - Forwards requests to MCP endpoints

4. **MCP Tool Loader** (`src/tools/mcpToolLoader.ts`)

   - Initializes MCP tools on server startup
   - Dynamically loads/unloads tools at runtime
   - Manages tool registration with ToolRunner

5. **API Routes** (`src/routes/mcpRoutes.ts`)
   - REST API for managing MCP tools
   - Endpoints for CRUD operations
   - Tool testing and status monitoring

## Data Flow

```
User adds MCP tool in frontend
  ↓
POST /api/mcp/tools (with credentials)
  ↓
Config saved to Parameter Store
Secret saved as SecureString
  ↓
OAuth token fetched and cached in memory
  ↓
Tool registered with ToolRunner
  ↓
Tool available for AI conversations
```

## API Endpoints

### List All MCP Tools

```
GET /api/mcp/tools
Response: Array of MCPToolResponse
```

### Get Specific Tool

```
GET /api/mcp/tools/:id
Response: MCPToolResponse
```

### Create New Tool

```
POST /api/mcp/tools
Body: MCPToolRequest
{
  "name": "string",
  "description": "string (optional)",
  "endpoint": "string",
  "clientId": "string",
  "clientSecret": "string",
  "enabled": boolean,
  "oauthConfig": {
    "tokenEndpoint": "string",
    "scope": "string (optional)"
  }
}
Response: MCPToolResponse (201)
```

### Update Tool

```
PUT /api/mcp/tools/:id
Body: Partial<MCPToolRequest>
Response: MCPToolResponse
```

### Delete Tool

```
DELETE /api/mcp/tools/:id
Response: 204 No Content
```

### Test Tool Connection

```
POST /api/mcp/tools/:id/test
Response: { success: boolean, message: string }
```

### Get System Status

```
GET /api/mcp/status
Response: {
  loadedTools: number,
  tools: Array<{id, name, description}>,
  tokenCache: {
    cachedTokens: number,
    activeRefreshTimers: number,
    tokens: Array<{toolId, expiresAt, hasRefreshToken}>
  }
}
```

## Storage Structure

### Parameter Store

```
/{apiName}/mcp/config
  Type: String
  Content: JSON array of all MCP tool configurations

/{apiName}/mcp/tools/{toolId}/secret
  Type: SecureString (KMS encrypted)
  Content: clientSecret for the tool
```

### In-Memory Cache

```
Token Cache:
  - Map<toolId, CachedToken>
  - Automatically refreshed before expiration
  - Cleared on server restart

Loaded Tools:
  - Map<toolId, MCPTool>
  - Registered with ToolRunner
  - Available for AI to use
```

## Security Features

1. **Encrypted Secrets**

   - Client secrets stored as SecureString in Parameter Store
   - Encrypted at rest with KMS
   - Only decrypted when needed

2. **In-Memory Token Cache**

   - Tokens never persisted to disk
   - Automatic refresh before expiration
   - Cleared on server restart

3. **IAM Permissions**

   - ECS task role has minimal required permissions
   - Limited to `/{apiName}/mcp/*` resources
   - KMS access restricted via service condition

4. **OAuth Flow**
   - Client credentials grant only
   - Tokens fetched securely from OAuth endpoints
   - Support for custom scopes

## MCP Tool Requirements

MCP tools must support:

1. **OAuth 2.0 Client Credentials Grant**

   - Token endpoint that accepts client_id and client_secret
   - Returns access_token and expires_in

2. **POST Endpoint**

   - Accepts JSON body with tool parameters
   - Requires Bearer token authentication
   - Returns JSON response

3. **Schema Endpoint (Optional)**
   - GET /{endpoint}/schema
   - Returns tool description and input schema
   - Falls back to defaults if not available

## Example MCP Tool Format

```json
{
  "id": "uuid",
  "name": "weatherAPI",
  "description": "Get weather information",
  "endpoint": "https://api.example.com/weather",
  "clientId": "your-client-id",
  "enabled": true,
  "oauthConfig": {
    "tokenEndpoint": "https://auth.example.com/oauth/token",
    "scope": "weather:read"
  }
}
```

## Initialization

MCP tools are initialized on server startup:

1. Server starts and listens on port
2. `initializeServer()` is called
3. MCP configurations loaded from Parameter Store
4. OAuth tokens preloaded for enabled tools
5. Tools registered with ToolRunner
6. Tools available for use

## Error Handling

- Configuration errors logged but don't prevent server startup
- Tool registration failures logged, tool marked as unavailable
- OAuth failures cause tool to be unavailable until fixed
- Failed tools can be tested/reloaded via API

## Monitoring

Use the status endpoint to monitor:

- Number of loaded tools
- Token cache statistics
- Tool availability
- Token expiration times

## Future Frontend Tasks

The following tasks remain for complete integration:

1. **Create MCP Tool Store** (packages/web/src/store/mcpToolStore.ts)

   - Zustand store for managing MCP tool state
   - CRUD operations calling backend API
   - Tool list and status tracking

2. **Create MCP Tool Management Panel** (packages/web/src/components/MCPToolPanel.tsx)

   - UI for adding/editing/deleting MCP tools
   - Form inputs for all required fields
   - Test connection button
   - Tool status indicators

3. **Integrate with ConfigPanel** (packages/web/src/components/ConfigPanel.tsx)

   - Add MCP tools section to existing config panel
   - OR create separate MCP management dialog
   - Link to MCP tool management

4. **Add Rate Limiting** (Optional)
   - Implement rate limiting for MCP endpoint calls
   - Prevent abuse of external APIs
   - Configurable limits per tool

## Testing

To test MCP integration:

1. Deploy infrastructure with updated CDK stack
2. Use API endpoints to create an MCP tool
3. Verify tool appears in `/api/mcp/status`
4. Test OAuth flow with `/api/mcp/tools/:id/test`
5. Trigger tool usage in AI conversation
6. Verify tool execution in logs

## Troubleshooting

**Tool not loading:**

- Check Parameter Store for configuration
- Verify IAM permissions
- Check server logs for errors

**OAuth failures:**

- Verify token endpoint URL
- Check client credentials
- Verify scope requirements

**Tool not executing:**

- Check tool endpoint is accessible
- Verify Bearer token is valid
- Check endpoint returns expected format
