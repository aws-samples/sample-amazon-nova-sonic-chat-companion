# Frontend MCP Tool Integration - Implementation Guide

## Overview

This document provides detailed implementation steps for completing the MCP tool integration in the frontend. The backend is fully implemented; these tasks will create the user interface for managing MCP tools.

## Remaining Tasks

### Task 1: Create MCP Tool Store (Zustand)

### Task 2: Create MCP Tool Management Panel Component

### Task 3: Integrate with Configuration Panel

---

## Task 1: Create MCP Tool Store

**File:** `packages/web/src/store/mcpToolStore.ts`

### Purpose

Create a Zustand store to manage MCP tool state, handle API calls, and provide reactive state updates.

### Implementation Steps

#### Step 1.1: Define Types

```typescript
// Add to the store file or create a separate types file
interface MCPTool {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  clientId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  status: "active" | "error" | "disabled";
  oauthConfig: {
    tokenEndpoint: string;
    scope?: string;
  };
}

interface MCPToolRequest {
  name: string;
  description?: string;
  endpoint: string;
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  oauthConfig: {
    tokenEndpoint: string;
    scope?: string;
  };
}

interface MCPToolStore {
  // State
  tools: MCPTool[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchTools: () => Promise<void>;
  createTool: (tool: MCPToolRequest) => Promise<void>;
  updateTool: (id: string, updates: Partial<MCPToolRequest>) => Promise<void>;
  deleteTool: (id: string) => Promise<void>;
  testTool: (id: string) => Promise<{ success: boolean; message: string }>;
  clearError: () => void;
}
```

#### Step 1.2: Implement Store

```typescript
import { create } from "zustand";

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

export const useMCPToolStore = create<MCPToolStore>((set, get) => ({
  // Initial state
  tools: [],
  loading: false,
  error: null,

  // Fetch all tools
  fetchTools: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/api/mcp/tools`);
      if (!response.ok) throw new Error("Failed to fetch tools");
      const tools = await response.json();
      set({ tools, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        loading: false,
      });
    }
  },

  // Create new tool
  createTool: async (tool: MCPToolRequest) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/api/mcp/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tool),
      });
      if (!response.ok) throw new Error("Failed to create tool");
      await get().fetchTools(); // Refresh list
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        loading: false,
      });
      throw error;
    }
  },

  // Update existing tool
  updateTool: async (id: string, updates: Partial<MCPToolRequest>) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/api/mcp/tools/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update tool");
      await get().fetchTools(); // Refresh list
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        loading: false,
      });
      throw error;
    }
  },

  // Delete tool
  deleteTool: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE_URL}/api/mcp/tools/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete tool");
      await get().fetchTools(); // Refresh list
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        loading: false,
      });
      throw error;
    }
  },

  // Test tool connection
  testTool: async (id: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/mcp/tools/${id}/test`, {
        method: "POST",
      });
      const result = await response.json();
      return result;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  // Clear error
  clearError: () => set({ error: null }),
}));
```

#### Step 1.3: Environment Configuration

Add to `.env` or `.env.local`:

```
VITE_API_URL=http://localhost:3000
```

For production, this should be set to the actual API URL.

---

## Task 2: Create MCP Tool Management Panel

**File:** `packages/web/src/components/MCPToolPanel.tsx`

### Purpose

Create a comprehensive UI for adding, editing, deleting, and testing MCP tools.

### Implementation Steps

#### Step 2.1: Basic Component Structure

```typescript
import { useState, useEffect } from "react";
import { useMCPToolStore } from "@/store/mcpToolStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Plus,
  Trash2,
  Edit,
  TestTube,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface MCPToolPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MCPToolPanel({ open, onOpenChange }: MCPToolPanelProps) {
  const { tools, loading, error, fetchTools, deleteTool, testTool } =
    useMCPToolStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchTools();
    }
  }, [open, fetchTools]);

  // Component implementation continues below...
}
```

#### Step 2.2: Tool Form Component

Create a separate component for the form:

```typescript
interface ToolFormProps {
  toolId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ToolForm({ toolId, onClose, onSuccess }: ToolFormProps) {
  const { tools, createTool, updateTool } = useMCPToolStore();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    endpoint: '',
    clientId: '',
    clientSecret: '',
    tokenEndpoint: '',
    scope: '',
    enabled: true,
  });
  const [submitting, setSubmitting] = useState(false);

  // Load existing tool data if editing
  useEffect(() => {
    if (toolId) {
      const tool = tools.find(t => t.id === toolId);
      if (tool) {
        setFormData({
          name: tool.name,
          description: tool.description || '',
          endpoint: tool.endpoint,
          clientId: tool.clientId,
          clientSecret: '', // Never pre-fill password
          tokenEndpoint: tool.oauthConfig.tokenEndpoint,
          scope: tool.oauthConfig.scope || '',
          enabled: tool.enabled,
        });
      }
    }
  }, [toolId, tools]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        name: formData.name,
        description: formData.description || undefined,
        endpoint: formData.endpoint,
        clientId: formData.clientId,
        clientSecret: formData.clientSecret,
        enabled: formData.enabled,
        oauthConfig: {
          tokenEndpoint: formData.tokenEndpoint,
          scope: formData.scope || undefined,
        },
      };

      if (toolId) {
        // Only include clientSecret if provided
        const updates = formData.clientSecret
          ? payload
          : { ...payload, clientSecret: undefined };
        await updateTool(toolId, updates);
      } else {
        await createTool(payload);
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Failed to save tool:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Tool Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Weather API"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="What does this tool do?"
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="endpoint">Tool Endpoint *</Label>
        <Input
          id="endpoint"
          type="url"
          value={formData.endpoint}
          onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
          placeholder="https://api.example.com/tool"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="clientId">Client ID *</Label>
        <Input
          id="clientId"
          value={formData.clientId}
          onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
          placeholder="OAuth Client ID"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="clientSecret">
          Client Secret {toolId && '(leave empty to keep existing)'}
        </Label>
        <Input
          id="clientSecret"
          type="password"
          value={formData.clientSecret}
          onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
          placeholder="OAuth Client Secret"
          required={!toolId}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tokenEndpoint">OAuth Token Endpoint *</Label>
        <Input
          id="tokenEndpoint"
          type="url"
          value={formData.tokenEndpoint}
          onChange={(e) => setFormData({ ...formData, tokenEndpoint: e.target.value })}
          placeholder="https://auth.example.com/oauth/token"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="scope">OAuth Scope (optional)</Label>
        <Input
          id="scope"
          value={formData.scope}
          onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
          placeholder="e.g., read:data"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="enabled"
          checked={formData.enabled}
          onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
        />
        <Label htmlFor="enabled">Enable tool</Label>
      </div>

      <div className="flex justify-end space-x-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : toolId ? 'Update Tool' : 'Create Tool'}
        </Button>
      </div>
    </form>
  );
}
```

#### Step 2.3: Tool List Component

```typescript
// Inside MCPToolPanel component

return (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center justify-between">
          <span>MCP Tools Management</span>
          <Button onClick={() => setIsFormOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Tool
          </Button>
        </DialogTitle>
      </DialogHeader>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-md">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading tools...</div>
      ) : tools.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No MCP tools configured. Add your first tool to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <Card key={tool.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {tool.name}
                      {tool.status === 'active' && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                      {tool.status === 'error' && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </CardTitle>
                    {tool.description && (
                      <CardDescription>{tool.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const result = await testTool(tool.id);
                        alert(result.message);
                      }}
                    >
                      <TestTube className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingTool(tool.id);
                        setIsFormOpen(true);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        if (confirm(`Delete tool "${tool.name}"?`)) {
                          await deleteTool(tool.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-1 text-muted-foreground">
                  <div><strong>Endpoint:</strong> {tool.endpoint}</div>
                  <div><strong>Client ID:</strong> {tool.clientId}</div>
                  <div><strong>Status:</strong> {tool.enabled ? 'Enabled' : 'Disabled'}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tool Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(open) => {
        setIsFormOpen(open);
        if (!open) setEditingTool(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTool ? 'Edit MCP Tool' : 'Add New MCP Tool'}
            </DialogTitle>
          </DialogHeader>
          <ToolForm
            toolId={editingTool || undefined}
            onClose={() => {
              setIsFormOpen(false);
              setEditingTool(null);
            }}
            onSuccess={fetchTools}
          />
        </DialogContent>
      </Dialog>
    </DialogContent>
  </Dialog>
);
```

---

## Task 3: Integrate with Configuration Panel

**File:** `packages/web/src/components/ConfigPanel.tsx`

### Purpose

Add access to MCP tool management from the existing configuration panel.

### Implementation Steps

#### Step 3.1: Import Required Components

Add to the top of `ConfigPanel.tsx`:

```typescript
import { MCPToolPanel } from "./MCPToolPanel";
import { Settings } from "lucide-react"; // Or appropriate icon
```

#### Step 3.2: Add State for MCP Panel

Add state inside the ConfigPanel component:

```typescript
const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
```

#### Step 3.3: Add MCP Tools Section

Add this section to the ConfigPanel UI (before or after other settings):

```typescript
<div className="space-y-2 pt-4 border-t">
  <Label className="text-base font-semibold">External Tools</Label>
  <p className="text-sm text-muted-foreground mb-3">
    Manage MCP (Model Context Protocol) tools that extend AI capabilities
  </p>
  <Button
    variant="outline"
    onClick={() => setMcpPanelOpen(true)}
    className="w-full"
  >
    <Settings className="h-4 w-4 mr-2" />
    Manage MCP Tools
  </Button>
</div>
```

#### Step 3.4: Add MCP Panel Component

Add before the closing of the Dialog:

```typescript
{/* MCP Tools Management Panel */}
<MCPToolPanel
  open={mcpPanelOpen}
  onOpenChange={setMcpPanelOpen}
/>
```

---

## Testing Checklist

### Store Testing

- [ ] Store initializes correctly
- [ ] `fetchTools()` retrieves tools from API
- [ ] `createTool()` creates new tools
- [ ] `updateTool()` updates existing tools
- [ ] `deleteTool()` removes tools
- [ ] `testTool()` tests tool connections
- [ ] Error states handled properly
- [ ] Loading states work correctly

### Component Testing

- [ ] Panel opens/closes correctly
- [ ] Tool list displays all tools
- [ ] Add tool form validates required fields
- [ ] Edit tool form pre-fills data
- [ ] Delete confirmation works
- [ ] Test connection button provides feedback
- [ ] Status indicators show correct states
- [ ] Forms submit successfully
- [ ] Error messages display properly

### Integration Testing

- [ ] MCP tools accessible from ConfigPanel
- [ ] Tools persist after page reload
- [ ] Tools appear in AI conversations
- [ ] OAuth tokens work correctly
- [ ] Tool execution succeeds

---

## Additional Enhancements (Optional)

### 1. Add Toast Notifications

Use the existing toast system for better feedback:

```typescript
import { useToast } from "@/hooks/use-toast";

// In component:
const { toast } = useToast();

// After successful operations:
toast({
  title: "Tool created",
  description: "MCP tool has been added successfully",
});

// After errors:
toast({
  title: "Error",
  description: error.message,
  variant: "destructive",
});
```

### 2. Add Search/Filter

Add search functionality to filter tools by name:

```typescript
const [searchQuery, setSearchQuery] = useState("");

const filteredTools = tools.filter((tool) =>
  tool.name.toLowerCase().includes(searchQuery.toLowerCase())
);
```

### 3. Add Tool Status Monitoring

Poll the status endpoint periodically:

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    if (open) fetchTools();
  }, 30000); // Every 30 seconds

  return () => clearInterval(interval);
}, [open]);
```

### 4. Add Import/Export

Allow users to export/import tool configurations:

```typescript
const exportTools = () => {
  const data = JSON.stringify(tools, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mcp-tools.json";
  a.click();
};
```

---

## Summary

After completing these three tasks, users will be able to:

1. ✅ View all configured MCP tools
2. ✅ Add new MCP tools with OAuth credentials
3. ✅ Edit existing tool configurations
4. ✅ Delete tools they no longer need
5. ✅ Test tool connections before using them
6. ✅ Enable/disable tools on demand
7. ✅ See tool status at a glance

The integration will be complete and production-ready!
