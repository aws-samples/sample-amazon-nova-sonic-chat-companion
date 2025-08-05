import { useEffect, useState } from "react";
import { ChevronRight, MessageSquare } from "lucide-react";
import { useSidebarStore } from "@/store/sidebarStore";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

export function SwipeIndicator() {
  const { isChatVisible, toggleChat } = useSidebarStore();
  const [isVisible, setIsVisible] = useState(true);
  const [isMediumScreen, setIsMediumScreen] = useState(false);

  // Check if we're on the client side and set initial screen size
  useEffect(() => {
    // Set initial screen size
    setIsMediumScreen(window.innerWidth >= 768);

    // Handle screen size changes
    const handleResize = () => {
      const isNowMedium = window.innerWidth >= 768;
      setIsMediumScreen(isNowMedium);

      // Update visibility based on screen size
      if (isNowMedium) {
        setIsVisible(true);
      } else if (!isChatVisible) {
        // On small screens, show briefly then hide
        setIsVisible(true);
        const timer = setTimeout(() => {
          setIsVisible(false);
        }, 5000);
        return () => clearTimeout(timer);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isChatVisible]);

  if (!isVisible) return null;

  return (
    <>
      {isMediumScreen ? (
        <div
          className={cn(
            "fixed right-0 top-1/2 transform -translate-y-1/2 bg-background",
            "border-t borber-b border-l border-2 rounded-l-lg",
            "transition-all duration-300 cursor-pointer hover:border-primary/40 hover:text-primary/40 text-primary/20",
            isChatVisible
              ? "-translate-x-[445px] z-0"
              : "translate-x-[1px] z-10"
          )}
          onClick={() => {
            if (useChatStore.getState().history.length > 0) toggleChat();
          }}
        >
          <div className="flex flex-col h-8 justify-center items-center gap-1 m-2">
            {isChatVisible ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <MessageSquare className="h-5 w-5" />
            )}
          </div>
        </div>
      ) : (
        <></>
      )}
    </>
  );
}
