import { useEffect, useState, useRef } from "react";
import { useDebugStore } from "@/store/debugStore";
import { useConfigStore } from "@/store/configStore";
import { CircleOff, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function DebugPanel() {
  const { events, clearEvents } = useDebugStore();
  const { debug } = useConfigStore();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const lastItemRef = useRef<HTMLLIElement>(null);

  // Effect to scroll to the last item when events change
  useEffect(() => {
    if (lastItemRef.current && events.length > 0) {
      // Use setTimeout to ensure DOM is updated before scrolling
      setTimeout(() => {
        lastItemRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }, 0);
    }
  }, [events]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  if (!debug) {
    return null;
  }

  // Format timestamp to readable time
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  return (
    <div className="fixed top-2 left-2 z-50 h-[calc(100vh-20px)] bg-background border border-border rounded-tl-md shadow-lg max-w-md">
      <div
        className="flex w-full items-center justify-between p-2 bg-muted cursor-pointer"
        onClick={toggleCollapse}
      >
        <h3 className="text-sm font-medium">
          Debug Events {events.length > 0 && `(${events.length})`}
        </h3>
        <button
          className="p-1 hover:bg-background rounded"
          onClick={clearEvents}
        >
          <CircleOff className="h-4 w-4" />
        </button>
        <button className="p-1 hover:bg-background rounded">
          {isCollapsed ? "+" : <X className="h-4 w-4" />}
        </button>
      </div>

      {!isCollapsed && (
        <ScrollArea className="p-2 h-[calc(100vh-65px)]">
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">
              No events recorded
            </div>
          ) : (
            <ul className="space-y-1">
              {events.map((event, index) => (
                <li
                  key={`${event.role}-${event.type}-${index}`}
                  className="text-xs border-l-2 pl-2 py-1"
                  style={{
                    borderColor: event.role === "USER" ? "orange" : "#10b981",
                  }}
                  ref={index === events.length - 1 ? lastItemRef : null}
                >
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {event.role?.at(0) ?? "X"}: {event.type}{" "}
                      {event.stopReason ? `- ${event.stopReason}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {formatTime(event.timeStamp)}
                      {event.count > 1 && (
                        <span className="ml-1 px-1 bg-muted rounded-full">
                          {event.count}x
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
