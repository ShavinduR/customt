import { useCallback, useEffect, useRef, useState } from 'react';

const LIMIT = 100;
const COALESCE_MS = 700;

/**
 * State with undo/redo.
 *
 * `set(next, { group })`: changes that share a `group` key and arrive within COALESCE_MS of each other
 * become ONE undo step. A drag fires dozens of moves, a slider dozens of values and typing one change per
 * key; with a group ("move:<layerId>", "size:<layerId>", …) each of those undoes in one press.
 * Changes without a group are always their own step.
 *
 * `reset(value)` replaces the state and clears the history (e.g. "Reset design").
 */
export default function useHistory(initial) {
  const [state, setState] = useState(() => ({ past: [], present: initial, future: [] }));
  const last = useRef({ group: null, at: 0 });

  const set = useCallback((next, { group } = {}) => {
    const now = Date.now();
    const merge = Boolean(group) && last.current.group === group && now - last.current.at < COALESCE_MS;
    last.current = { group: group || null, at: now };
    setState((h) => {
      const value = typeof next === 'function' ? next(h.present) : next;
      if (Object.is(value, h.present)) return h;
      if (merge) return { ...h, present: value, future: [] };
      return { past: [...h.past, h.present].slice(-LIMIT), present: value, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    last.current = { group: null, at: 0 };
    setState((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  }, []);

  const redo = useCallback(() => {
    last.current = { group: null, at: 0 };
    setState((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
  }, []);

  const reset = useCallback((value) => {
    last.current = { group: null, at: 0 };
    setState({ past: [], present: value, future: [] });
  }, []);

  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

/** Ctrl/⌘+Z = undo, Ctrl/⌘+Shift+Z or Ctrl+Y = redo. Text fields keep their own native undo. */
export function useUndoShortcuts(undo, redo, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        // Range sliders and colour pickers have no text to undo, so the shortcut still applies to the design.
        if (!(t.tagName === 'INPUT' && ['range', 'color', 'checkbox', 'radio', 'button'].includes(t.type))) return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.metaKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, enabled]);
}
