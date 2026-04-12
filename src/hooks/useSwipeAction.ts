import { useCallback, useRef, useState } from "react";

interface UseSwipeActionOptions {
  /** Minimale Pixel die gezogen werden müssen, damit die Aktion auslöst (default: 120) */
  threshold?: number;
  /** Callback wenn der Swipe die Schwelle überschreitet und losgelassen wird */
  onSwipeLeft?: () => void;
  /** Verhindert den Swipe (z.B. wenn die Zeile gerade bearbeitet wird) */
  disabled?: boolean;
}

interface UseSwipeActionResult {
  /** CSS-translateX-Offset in Pixeln (immer ≤ 0) */
  offset: number;
  /** True solange der User aktiv zieht */
  isSwiping: boolean;
  /** True wenn der Swipe die Schwelle überschritten hat (für visuelles Feedback) */
  isPastThreshold: boolean;
  /** Event-Handler — an das äußere Container-Element binden */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Hook für eine Swipe-nach-links-Geste auf einem Element.
 *
 * Touch: touchstart/touchmove/touchend
 * Mouse: mousedown → globale mousemove/mouseup (damit man außerhalb des Elements loslassen kann)
 *
 * Der Offset ist immer ≤ 0 (nur nach links ziehen).
 * Beim Loslassen: wenn |offset| ≥ threshold → onSwipeLeft() aufrufen.
 * Sonst: animiert zurück auf 0 (über CSS transition im Consumer).
 */
export function useSwipeAction({
  threshold = 120,
  onSwipeLeft,
  disabled = false,
}: UseSwipeActionOptions = {}): UseSwipeActionResult {
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const startX = useRef(0);
  const currentX = useRef(0);

  // --- Touch handlers ---

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      startX.current = e.touches[0].clientX;
      currentX.current = startX.current;
      setIsSwiping(true);
    },
    [disabled]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping || disabled) return;
      currentX.current = e.touches[0].clientX;
      const delta = Math.min(0, currentX.current - startX.current);
      setOffset(delta);
    },
    [isSwiping, disabled]
  );

  const finishSwipe = useCallback(() => {
    setIsSwiping(false);
    if (Math.abs(offset) >= threshold && onSwipeLeft) {
      onSwipeLeft();
    }
    setOffset(0);
  }, [offset, threshold, onSwipeLeft]);

  const onTouchEnd = useCallback(() => {
    finishSwipe();
  }, [finishSwipe]);

  // --- Mouse handlers ---

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      // Nur linke Maustaste
      if (e.button !== 0) return;
      // Nicht auslösen wenn auf einem interaktiven Element geklickt (Button, Input, etc.)
      const target = e.target as HTMLElement;
      if (target.closest("button, input, select, textarea, [role=menuitem], [role=option], [data-radix-collection-item]")) {
        return;
      }

      startX.current = e.clientX;
      currentX.current = e.clientX;
      setIsSwiping(true);

      const handleMouseMove = (me: MouseEvent) => {
        currentX.current = me.clientX;
        const delta = Math.min(0, currentX.current - startX.current);
        setOffset(delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        // finishSwipe() braucht den aktuellen offset — den lesen wir aus der Ref
        const finalDelta = Math.abs(Math.min(0, currentX.current - startX.current));
        setIsSwiping(false);
        if (finalDelta >= threshold && onSwipeLeft) {
          onSwipeLeft();
        }
        setOffset(0);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [disabled, threshold, onSwipeLeft]
  );

  return {
    offset,
    isSwiping,
    isPastThreshold: Math.abs(offset) >= threshold,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onMouseDown,
    },
  };
}
