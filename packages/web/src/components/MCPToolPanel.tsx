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
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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

interface ToolFormProps {
  toolId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ToolForm({ toolId, onClose, onSuccess }: ToolFormProps) {
  const { tools, createTool, updateTool } = useMCPToolStore();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    endpoint: "",
    clientId: "",
    clientSecret: "",
    additionalInstruction: "",
    enabled: true,
  });
  const [submitting, setSubmitting] = useState(false);

  // Load existing tool data if editing
  useEffect(() => {
    if (toolId) {
      const tool = tools.find((t) => t.id === toolId);
      if (tool) {
        setFormData({
          name: tool.name,
          description: tool.description || "",
          endpoint: tool.endpoint,
          clientId: tool.clientId,
          clientSecret: "", // Never pre-fill password
          additionalInstruction: tool.additionalInstruction || "",
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
        additionalInstruction: formData.additionalInstruction || undefined,
        enabled: formData.enabled,
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
      console.error("Failed to save tool:", error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Server Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e: any) =>
            setFormData({ ...formData, name: e.target.value })
          }
          placeholder="e.g., Weather API"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="endpoint">Server Endpoint *</Label>
        <Input
          id="endpoint"
          type="url"
          value={formData.endpoint}
          onChange={(e: any) =>
            setFormData({ ...formData, endpoint: e.target.value })
          }
          placeholder="https://api.example.com/tool"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="clientId">Client ID *</Label>
        <Input
          id="clientId"
          value={formData.clientId}
          onChange={(e: any) =>
            setFormData({ ...formData, clientId: e.target.value })
          }
          placeholder="OAuth Client ID"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="clientSecret">
          Client Secret {toolId && "(leave empty to keep existing)"}
        </Label>
        <Input
          id="clientSecret"
          type="password"
          value={formData.clientSecret}
          onChange={(e) =>
            setFormData({ ...formData, clientSecret: e.target.value })
          }
          placeholder="OAuth Client Secret"
          required={!toolId}
        />
        <p className="text-sm text-muted-foreground">
          OAuth configuration will be automatically discovered from the server
          endpoint.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="additionalInstruction">Additional Instruction</Label>
        <Textarea
          id="additionalInstruction"
          value={formData.additionalInstruction}
          onChange={(e) =>
            setFormData({ ...formData, additionalInstruction: e.target.value })
          }
          placeholder="Optional instructions or context for this MCP server"
          rows={3}
        />
        <p className="text-sm text-muted-foreground">
          Provide additional context or instructions for how this MCP server
          should be used.
        </p>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="enabled"
          checked={formData.enabled}
          onCheckedChange={(checked) =>
            setFormData({ ...formData, enabled: checked })
          }
        />
        <Label htmlFor="enabled">Enable tool</Label>
      </div>

      <div className="flex justify-end space-x-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : toolId ? "Update Tool" : "Create Tool"}
        </Button>
      </div>
    </form>
  );
}

export function MCPToolPanel({ open, onOpenChange }: MCPToolPanelProps) {
  const { tools, loading, error, fetchTools, deleteTool, testTool } =
    useMCPToolStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{ [key: string]: boolean }>({});
  useEffect(() => {
    if (open) {
      fetchTools();
    }
  }, [open, fetchTools]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>MCP Servers</span>
              <Button onClick={() => setIsFormOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Server
              </Button>
            </DialogTitle>
          </DialogHeader>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md">{error}</div>
          )}

          {loading ? (
            <div className="text-center py-8">Loading tools...</div>
          ) : tools.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No MCP tools configured
            </div>
          ) : (
            <div className="space-y-3 py-3">
              {tools.map((tool) => (
                <Card key={tool.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          {tool.name}
                          {tool.status === "active" && (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                          {tool.status === "error" && (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </CardTitle>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className={
                            testStatus[tool.name]
                              ? "text-green-500"
                              : testStatus[tool.name] === undefined
                                ? ""
                                : "text-red-500"
                          }
                          variant="outline"
                          onClick={async () => {
                            const result = await testTool(tool.id);
                            testStatus[tool.name] = result.success;
                            setTestStatus({
                              ...testStatus,
                            });
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
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Tool Form Dialog */}
      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditingTool(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTool ? "Edit MCP Server" : "Add New MCP Server"}
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
    </>
  );
}
