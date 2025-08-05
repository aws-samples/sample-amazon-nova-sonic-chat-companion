import React, { useRef, useEffect } from "react";
import { useThemeStore } from "@/store/themeStore";

export interface VoiceSpectrumBarsProps {
  /**
   * Web Audio API AnalyserNode to visualize
   */
  analyser?: AnalyserNode;

  /**
   * Whether audio is currently playing
   */
  isPlaying: boolean;

  /**
   * Number of frequency bins to display (default: 32)
   */
  bins?: number;

  /**
   * Color scheme for the visualization
   */
  colorScheme?: "default" | "rainbow" | "monochrome" | "fire";

  /**
   * Custom class name for the container
   */
  className?: string;

  /**
   * Custom styles for the container
   */
  style?: React.CSSProperties;
}

/**
 * A React component that visualizes audio frequency data as a circular spectrum analyzer
 */
const VoiceSpectrumBars = ({
  analyser,
  isPlaying,
  bins = 32,
  className,
}: VoiceSpectrumBarsProps) => {
  // Get the current theme to trigger re-renders when theme changes
  const { theme } = useThemeStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  // Audio data
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const bufferLengthRef = useRef<number>(0);
  // Animation time tracking for ripple effect
  const timeRef = useRef<number>(0);

  // Resize canvas to fit container
  const resizeCanvas = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = canvas.parentElement as HTMLElement;

    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
  };

  // Set up resize listener and start/stop animation based on isPlaying
  useEffect(() => {
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, []);

  // Update canvas when it's created
  useEffect(() => {
    resizeCanvas();
  }, [canvasRef]);

  // Start or stop visualization based on analyser availability
  useEffect(() => {
    if (!animationRef.current) {
      startAnimation();
    }

    // Cleanup on unmount
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [analyser, theme, isPlaying]);

  const startAnimation = () => {
    animationRef.current = requestAnimationFrame(startAnimation);
    if (!canvasRef.current || (isPlaying && !analyser)) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Initialize data array if not already done

    if (isPlaying && analyser) {
      // Get frequency data
      if (!dataArrayRef.current) {
        bufferLengthRef.current = analyser.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(bufferLengthRef.current);
      }
      analyser.getByteFrequencyData(dataArrayRef.current);
    } else {
      // Generate ripple effect data
      bufferLengthRef.current = 128;
      dataArrayRef.current = new Uint8Array(bufferLengthRef.current);
      timeRef.current += 0.05;

      // Create a gentle wave pattern for the ripple effect
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        // Use sine waves with different frequencies to create a natural ripple
        const wave1 = Math.sin(timeRef.current * 0.5 + i * 0.1) * 20;
        const wave2 = Math.sin(timeRef.current * 0.3 - i * 0.05) * 15;
        const wave3 = Math.sin(timeRef.current * 0.7 + i * 0.02) * 10;

        // Combine waves and normalize to the 0-255 range used by frequency data
        dataArrayRef.current[i] = 128 + wave1 + wave2 + wave3;
      }
    }

    const usefulLength = 32;
    const lowestIndex = 10;

    // Clear canvas
    ctx?.clearRect(0, 0, canvas.width, canvas.height);

    const binBuffer = new Uint8Array(bins);

    // Reduce the buffer to the bin buffer
    for (let i = 0; i < bins; i++) {
      let sum = 0;
      for (let j = lowestIndex; j < lowestIndex + usefulLength / bins; j++) {
        sum += dataArrayRef.current[i * (usefulLength / bins) + j];
      }
      binBuffer[i] = sum / (usefulLength / bins);
    }

    // Clear canvas
    ctx?.clearRect(0, 0, canvas.width, canvas.height);

    // Draw time window histogram (SoundCloud style)
    const barWidth = Math.max(2, (canvas.width * 0.8) / binBuffer.length);
    const spacing = Math.max(2, barWidth * 0.2);
    const totalBarWidth = barWidth + spacing;

    for (let i = 0; i < binBuffer.length; i++) {
      // Normalize data value to canvas height
      const amplitude = Math.abs(binBuffer[i]);
      const barHeight = Math.max(
        2,
        ((amplitude - 128) / 128) * (canvas.height - 10)
      );
      // Calculate the x position for this bar

      // Get the theme-aware color from CSS variables
      const fillColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--spectrum-bar-fill-color")
        .trim();

      if (ctx) ctx.fillStyle = fillColor || "#000000";
      ctx?.fillRect(
        i * totalBarWidth,
        canvas.height / 2 - barHeight,
        barWidth,
        barHeight * 2
      );
    }
    ctx?.stroke();
  };

  return (
    <div className={className}>
      <canvas ref={canvasRef} className="w-full h-full aspect-square"></canvas>
    </div>
  );
};

export default VoiceSpectrumBars;
