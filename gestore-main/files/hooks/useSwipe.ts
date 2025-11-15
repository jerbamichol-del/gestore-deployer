import * as React from 'react';

type SwipeOpts = {
  enabled?: boolean;
  slop?: number;
  threshold?: number;
  ignoreSelector?: string;
  disableDrag?: (intent: 'left' | 'right') => boolean;
};

export function useSwipe(
  ref: React.RefObject<HTMLElement>,
  handlers: { onSwipeLeft?: () => void; onSwipeRight?: () => void },
  opts: SwipeOpts = {}
) {
  const {
    enabled = true,
    slop = 10,
    threshold = 32,
    ignoreSelector,
    disableDrag,
  } = opts;

  const state = React.useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    dx: 0,
    armed: false,
    intent: null as null | 'left' | 'right',
  }).current;

  const [progress, setProgress] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);

  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  const resetState = React.useCallback(() => {
    state.pointerId = null;
    state.armed = false;
    state.intent = null;
    state.dx = 0;
    setIsSwiping(false);
    setProgress(0);
  }, [state]);

  React.useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) {
      // If the hook is disabled (e.g., modal is closed), ensure we reset
      // the internal state. This prevents an interrupted gesture from leaving
      // the state "dirty", which would block future swipes.
      resetState();
      return;
    }

    const onDown = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        state.pointerId !== null ||
        (ignoreSelector && (e.target as HTMLElement).closest(ignoreSelector))
      ) {
        return;
      }
      state.pointerId = e.pointerId;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.dx = 0;
      state.armed = false;
      state.intent = null;
    };

    const onMove = (e: PointerEvent) => {
      if (state.pointerId !== e.pointerId) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (!state.armed) {
        if (Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy) * 2) {
          state.armed = true;
          setIsSwiping(true);
          state.intent = dx < 0 ? 'left' : 'right';
          try {
            root.setPointerCapture(e.pointerId);
          } catch {}
        } else if (Math.abs(dy) > slop) {
          state.pointerId = null; // It's a vertical scroll, release
        }
        if (!state.armed) return;
      }

      state.dx = dx;
      const hasHandler =
        (state.intent === 'left' && handlersRef.current.onSwipeLeft) ||
        (state.intent === 'right' && handlersRef.current.onSwipeRight);
      
      if (!hasHandler) return;

      const screenWidth = root.offsetWidth;
      if (screenWidth > 0) {
        const p = Math.max(-1, Math.min(1, dx / screenWidth));
        if (state.intent && disableDrag?.(state.intent)) {
          setProgress(0);
        } else {
          setProgress(p);
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      if (state.pointerId !== e.pointerId) return;

      if (state.armed) {
        try {
          root.releasePointerCapture(e.pointerId);
        } catch {}

        if (Math.abs(state.dx) >= threshold) {
          if (state.intent === 'left' && handlersRef.current.onSwipeLeft) {
            handlersRef.current.onSwipeLeft();
          } else if (state.intent === 'right' && handlersRef.current.onSwipeRight) {
            handlersRef.current.onSwipeRight();
          }
        }
      }
      
      resetState();
    };

    const onCancel = (e: PointerEvent) => {
      if (state.pointerId !== e.pointerId) return;
      if (state.armed) {
        try {
          root.releasePointerCapture(e.pointerId);
        } catch {}
      }
      resetState();
    };

    root.addEventListener('pointerdown', onDown, { passive: true });
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerup', onUp, { passive: true });
    root.addEventListener('pointercancel', onCancel, { passive: true });

    return () => {
      root.removeEventListener('pointerdown', onDown as any);
      root.removeEventListener('pointermove', onMove as any);
      root.removeEventListener('pointerup', onUp as any);
      root.removeEventListener('pointercancel', onCancel as any);
    };
  }, [ref, enabled, slop, threshold, ignoreSelector, disableDrag, resetState, state]);

  return { progress, isSwiping };
}
