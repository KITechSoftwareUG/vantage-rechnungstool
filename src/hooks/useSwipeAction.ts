import { useCallback, useRef, useState } from "react";

interface UseSwipeActionOptions {
  /** Minimale Pixel bevor die Aktion auslöst (default: 100) */
  threshold?: number;
  /** Swipe nach links deaktivieren */
  disableLeft?: boolean;
  /** Swipe nach rechts deaktivieren */
  disableRight?: boolean;
}

export type SwipeDismissDirection = "left" | "right";

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
  /**
   * Wenn nicht null, wurde der Swipe losgelassen und die Dismiss-Richtung steht fest.
   * Die Komponente sollte jetzt die Slide-Out + Collapse-Animation abspielen
   * und am Ende `confirmDismiss()` aufrufen.
   */
  dismissing: SwipeDismissDirection | null;
  /** Aufrufen nach der Animation, um den State zurückzusetzen */
  confirmDismiss: () => void;
  /** Event-Handler — an das Container-Element binden */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Bidirektionaler Swipe-Hook mit mehrstufiger Dismiss-Animation.
 *
 * Nach Schwellen-Überschreitung wird `dismissing` gesetzt statt sofort
 * einen Callback auszuführen. Die Komponente spielt die Animation ab
 * und ruft am Ende `confirmDismiss()` auf → dort passiert das DB-Update.
 */
export function useSwipeAction({
  threshold = 100,
  disableLeft = false,
  disableRight = false,
}: UseSwipeActionOptions = {}): UseSwipeActionResult {
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [dismissing, setDismissing] = useState<SwipeDismissDirection | null>(null);

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
        if (finalOffset < 0 && !disableLeft) {
          setDismissing("left");
          return; // NICHT offset zurücksetzen — die Komponente animiert weiter
        }
        if (finalOffset > 0 && !disableRight) {
          setDismissing("right");
          return;
        }
      }
      setOffset(0);
    },
    [threshold, disableLeft, disableRight]
  );

  const confirmDismiss = useCallback(() => {
    setDismissing(null);
    setOffset(0);
  }, []);

  // --- Touch ---
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((disableLeft && disableRight) || dismissing) return;
      startX.current = e.touches[0].clientX;
      currentX.current = startX.current;
      setIsSwiping(true);
    },
    [disableLeft, disableRight, dismissing]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping || dismissing) return;
      currentX.current = e.touches[0].clientX;
      setOffset(clampOffset(currentX.current - startX.current));
    },
    [isSwiping, clampOffset, dismissing]
  );

  const onTouchEnd = useCallback(() => {
    if (dismissing) return;
    setIsSwiping(false);
    resolveSwipe(offset);
  }, [offset, resolveSwipe, dismissing]);

  // --- Mouse ---
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((disableLeft && disableRight) || dismissing) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "button, input, select, textarea, a, [role=menuitem], [role=option], [data-radix-collection-item]"
        )
      ) return;

      startX.current = e.clientX;
      currentX.current = e.clientX;
      setIsSwiping(true);

      const handleMouseMove = (me: MouseEvent) => {
        currentX.current = me.clientX;
        setOffset(clampOffset(currentX.current - startX.current));
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        const finalOffset = clampOffset(currentX.current - startX.current);
        setIsSwiping(false);
        resolveSwipe(finalOffset);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [disableLeft, disableRight, clampOffset, resolveSwipe, dismissing]
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
    dismissing,
    confirmDismiss,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onMouseDown },
  };
}
