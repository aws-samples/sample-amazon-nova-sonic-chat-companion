import { useEffect, useRef } from "react";

interface SwipeOptions {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  threshold?: number; // Minimum distance required for a swipe (in pixels)
}

export function useSwipeGesture(
  ref: React.RefObject<HTMLElement>,
  { onSwipeRight, onSwipeLeft, threshold = 50 }: SwipeOptions
) {
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.targetTouches[0].clientX;
    };

    const handleTouchMove = (e: TouchEvent) => {
      touchEndX.current = e.targetTouches[0].clientX;
    };

    const handleTouchEnd = () => {
      if (!touchStartX.current || !touchEndX.current) return;

      const distance = touchEndX.current - touchStartX.current;
      const isSwipe = Math.abs(distance) > threshold;

      if (isSwipe) {
        if (distance > 0 && onSwipeRight) {
          // Swiped right
          onSwipeRight();
        } else if (distance < 0 && onSwipeLeft) {
          // Swiped left
          onSwipeLeft();
        }
      }

      // Reset values
      touchStartX.current = null;
      touchEndX.current = null;
    };

    element.addEventListener("touchstart", handleTouchStart);
    element.addEventListener("touchmove", handleTouchMove);
    element.addEventListener("touchend", handleTouchEnd);

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
    };
  }, [ref, onSwipeRight, onSwipeLeft, threshold]);
}
