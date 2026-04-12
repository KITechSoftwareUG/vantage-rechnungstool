import { useCallback, useEffect, useRef, useState } from "react";

interface KeyboardNavigationCallbacks {
  /** Wird mit der ID der aktuell fokussierten Zeile aufgerufen */
  onConfirm?: (id: string) => void;
  onUnmatch?: (id: string) => void;
  onMarkNoMatch?: (id: string) => void;
}

interface UseKeyboardNavigationResult {
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  /** Anzahl der Items, die aktuell navigierbar sind */
  count: number;
}

/**
 * Tastatur-Navigation für Listen-UIs:
 *
 * - `j` / ↓        nächstes Item
 * - `k` / ↑        voriges Item
 * - `Enter` / `y`  bestätigen
 * - `Backspace`/`u` Zuordnung aufheben
 * - `n`            "keine Rechnung"
 * - `Esc`          Fokus aufheben
 *
 * Shortcuts werden ignoriert wenn ein Input/Textarea fokussiert ist
 * oder Modifier (Cmd/Ctrl) gedrückt sind — verhindert Konflikte mit
 * dem Suchfeld und Browser-Shortcuts.
 */
export function useKeyboardNavigation(
  itemIds: string[],
  callbacks: KeyboardNavigationCallbacks
): UseKeyboardNavigationResult {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Refs in einem Ref-Container, damit der Effect nicht jedes Mal neu
  // registriert wird wenn sich `itemIds` oder Callbacks ändern.
  const stateRef = useRef({ itemIds, callbacks, focusedId });
  stateRef.current = { itemIds, callbacks, focusedId };

  const handleKey = useCallback((event: KeyboardEvent) => {
    // Skip wenn der User gerade in ein Eingabefeld tippt
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
        return;
      }
    }

    // Skip Modifier-Kombinationen (Cmd+A, Ctrl+R, etc.)
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const { itemIds: ids, callbacks: cbs, focusedId: currentFocus } = stateRef.current;
    if (ids.length === 0) return;

    const currentIndex = currentFocus ? ids.indexOf(currentFocus) : -1;

    switch (event.key) {
      case "j":
      case "ArrowDown": {
        event.preventDefault();
        const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, ids.length - 1);
        setFocusedId(ids[next]);
        break;
      }
      case "k":
      case "ArrowUp": {
        event.preventDefault();
        const prev = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
        setFocusedId(ids[prev]);
        break;
      }
      case "Enter":
      case "y": {
        if (currentFocus && cbs.onConfirm) {
          event.preventDefault();
          cbs.onConfirm(currentFocus);
        }
        break;
      }
      case "u":
      case "Backspace": {
        if (currentFocus && cbs.onUnmatch) {
          event.preventDefault();
          cbs.onUnmatch(currentFocus);
        }
        break;
      }
      case "n": {
        if (currentFocus && cbs.onMarkNoMatch) {
          event.preventDefault();
          cbs.onMarkNoMatch(currentFocus);
        }
        break;
      }
      case "Escape": {
        event.preventDefault();
        setFocusedId(null);
        break;
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  return { focusedId, setFocusedId, count: itemIds.length };
}
