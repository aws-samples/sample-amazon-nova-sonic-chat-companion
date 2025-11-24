import { create } from "zustand";

// Types
interface MCPTool {
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  clientId: string;
  enabled: boolean;
  additionalInstruction?: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "error" | "disabled";
}

interface MCPToolRequest {
  name: string;
  description?: string;
  endpoint: string;
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  additionalInstruction?: string;
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

export const useMCPToolStore = create<MCPToolStore>((set, get) => ({
  // Initial state
  tools: [],
  loading: false,
  error: null,

  // Fetch all tools
  fetchTools: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`/api/mcp/tools`);
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
      const response = await fetch(`/api/mcp/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tool),
      });
      if (!response.ok) throw new Error("Failed to create MCP");
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
      const response = await fetch(`/api/mcp/tools/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update MCP server");
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
      const response = await fetch(`/api/mcp/tools/${id}`, {
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
      const response = await fetch(`/api/mcp/tools/${id}/test`, {
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
