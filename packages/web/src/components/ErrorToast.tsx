import { useEffect, useState } from "react";
import { useErrorStore, type ErrorMessage } from "@/store/errorStore";
import { useToast } from "@/hooks/use-toast";

export function ErrorToast() {
  const { errors, dismissError } = useErrorStore();
  const { toast } = useToast();
  // Keep track of which error IDs we've already processed
  const [processedErrorIds, setProcessedErrorIds] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    // Process only errors that haven't been processed yet
    const newErrors = errors.filter(
      (error) => !processedErrorIds.has(error.id)
    );

    if (newErrors.length === 0) return;

    // Mark these errors as processed
    const newProcessedIds = new Set(processedErrorIds);
    newErrors.forEach((error) => {
      // Show a toast for each new error
      toast({
        title: getErrorTitle(error),
        description: error.message,
        variant: getVariant(error.type),
        duration: error.timeout,
        count: error.count,
      });

      newProcessedIds.add(error.id);

      // Auto-dismiss from the error store after timeout
      if (error.timeout) {
        console.log("dismiss timeout", error.timeout);
        setTimeout(() => {
          dismissError(error.id);
        }, error.timeout);
      }
    });

    setProcessedErrorIds(newProcessedIds);
  }, [errors, toast, dismissError, processedErrorIds]);

  // Clean up processed IDs when they're no longer in the errors array
  useEffect(() => {
    setProcessedErrorIds((prev) => {
      const currentErrorIds = new Set(errors.map((e) => e.id));
      const updatedProcessedIds = new Set<string>();

      // Only keep IDs that are still in the errors array
      prev.forEach((id) => {
        if (currentErrorIds.has(id)) {
          updatedProcessedIds.add(id);
        }
      });

      return updatedProcessedIds;
    });
  }, [errors]);

  return null; // This is a utility component, it doesn't render anything
}

function getErrorTitle(error: ErrorMessage): string {
  switch (error.type) {
    case "error":
      return "Error";
    case "warning":
      return "Warning";
    case "info":
      return "Information";
    case "success":
      return "Success";
    default:
      return "Notification";
  }
}

function getVariant(
  type: ErrorMessage["type"]
): "default" | "destructive" | "success" | "warning" | "info" {
  switch (type) {
    case "error":
      return "destructive";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "success":
      return "success";
    default:
      return "default";
  }
}
