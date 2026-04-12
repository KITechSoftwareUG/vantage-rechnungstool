import { useCallback, useRef, useState } from "react";

interface UseSwipeActionOptions {
  /** Minimale Pixel bevor die Aktion auslöst (default: 120) */
  threshold?: number;
  /** Callback bei Swipe nach links (z.B. "als Laufende Kosten markieren") */
  onSwipeLeft?: () => void;
  /** Callback bei Swipe nach rechts (z.B. "zurück auf offen setzen") */
  onSwipeRight?: () => void;
  /** Swipe nach links deaktivieren */
  disableLeft?: boolean;
  /** Swipe nach rechts deaktivieren */
  disableRight?: boolean;
}

interface UseSwipeActionResult {
  /** CSS-translateX-Offset in Pixeln (negativ = links, positiv = rechts) */
  offset: number;
  /** True solange der User aktiv zieht */
  isSwiping: boolean;
  /** True wenn der Swipe die Schwelle überschritten hat */
  isPastThreshold: boolean;
  /** Richtung des aktuellen Swipes */
  direction: "left" | "right" | null;
  /** Fortschritt 0→1 bis zur Schwelle (für Animationen) */
  progress: number;
  /** Event-Handler — an das Container-Element binden */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Bidirektionaler Swipe-Hook für Listen-Items.
 *
 * Links-Swipe und Rechts-Swipe können unabhängig aktiviert werden.
 * Der Hook liefert `offset`, `progress` (0→1) und `isPastThreshold`
 * für granulare visuelle Animationen im Consumer.
 */
export function useSwipeAction({
  threshold = 120,
  onSwipeLeft,
  onSwipeRight,
  disableLeft = false,
  disableRight = false,
}: UseSwipeActionOptions = {}): UseSwipeActionResult {
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const startX = useRef(0);
  const currentX = useRef(0);

  const clampOffset = useCallback(
    (raw: number): number => {
      if (raw < 0 && disableLeft) return 0;
      if (raw > 0 && disableRight) return 0;
      return raw;
    },
    [disableLeft, disableRight]
  );

  const resolveSwipe = useCallback(
    (finalOffset: number) => {
      const abs = Math.abs(finalOffset);
      if (abs >= threshold) {
        if (finalOffset < 0 && onSwipeLeft && !disableLeft) {
          onSwipeLeft();
        } else if (finalOffset > 0 && onSwipeRight && !disableRight) {
          onSwipeRight();
        }
      }
    },
    [threshold, onSwipeLeft, onSwipeRight, disableLeft, disableRight]
  );

  // --- Touch ---

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disableLeft && disableRight) return;
      startX.current = e.touches[0].clientX;
      currentX.current = startX.current;
      setIsSwiping(true);
    },
    [disableLeft, disableRight]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping) return;
      currentX.current = e.touches[0].clientX;
      const raw = currentX.current - startX.current;
      setOffset(clampOffset(raw));
    },
    [isSwiping, clampOffset]
  );

  const onTouchEnd = useCallback(() => {
    setIsSwiping(false);
    resolveSwipe(offset);
    setOffset(0);
  }, [offset, resolveSwipe]);

  // --- Mouse ---

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disableLeft && disableRight) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "button, input, select, textarea, a, [role=menuitem], [role=option], [data-radix-collection-item]"
        )
      ) {
        return;
      }

      startX.current = e.clientX;
      currentX.current = e.clientX;
      setIsSwiping(true);

      const handleMouseMove = (me: MouseEvent) => {
        currentX.current = me.clientX;
        const raw = currentX.current - startX.current;
        setOffset(clampOffset(raw));
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        const finalOffset = clampOffset(currentX.current - startX.current);
        setIsSwiping(false);
        resolveSwipe(finalOffset);
        setOffset(0);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [disableLeft, disableRight, clampOffset, resolveSwipe]
  );

  const absOffset = Math.abs(offset);
  const direction: "left" | "right" | null =
    offset < -5 ? "left" : offset > 5 ? "right" : null;

  return {
    offset,
    isSwiping,
    isPastThreshold: absOffset >= threshold,
    direction,
    progress: Math.min(1, absOffset / threshold),
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onMouseDown },
  };
}
