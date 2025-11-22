import * as React from 'react';

type SwipeOpts = {
  enabled?: boolean;
  slop?: number;
  threshold?: number;
  ignoreSelector?: string;
  disableDrag?: (intent: 'left' | 'right') => boolean;
};

type SwipeState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  isSwiping: boolean;
  dir: 'left' | 'right' | null;
  blockedByIgnore: boolean;
  blockedByDisable: boolean;
};

export function useSwipe(
  ref: React.RefObject<HTMLElement>,
  handlers: { onSwipeLeft?: () => void; onSwipeRight?: () => void },
  opts: SwipeOpts = {}
) {
  const {
    enabled = true,
    slop = 10,
    threshold = 80,
    ignoreSelector,
    disableDrag,
  } = opts;

  const [progress, setProgress] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);

  const stateRef = React.useRef<SwipeState>({
    pointerId: null,
    startX: 0,
    startY: 0,
    isSwiping: false,
    dir: null,
    blockedByIgnore: false,
    blockedByDisable: false,
  });

  const resetState = React.useCallback(() => {
    const s = stateRef.current;
    s.pointerId = null;
    s.startX = 0;
    s.startY = 0;
    s.isSwiping = false;
    s.dir = null;
    s.blockedByIgnore = false;
    s.blockedByDisable = false;
    setProgress(0);
    setIsSwiping(false);
  }, []);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;

    if (!enabled) {
      resetState();
      return;
    }

    const onDown = (ev: PointerEvent) => {
      if (!enabled) return;

      const s = stateRef.current;
      if (s.pointerId !== null) return; // already a gesture in progress

      const target = ev.target as HTMLElement | null;
      if (ignoreSelector && target && target.closest(ignoreSelector)) {
        s.pointerId = ev.pointerId;
        s.blockedByIgnore = true;
        s.blockedByDisable = false;
        s.isSwiping = false;
        s.dir = null;
        return;
      }

      s.pointerId = ev.pointerId;
      s.startX = ev.clientX;
      s.startY = ev.clientY;
      s.isSwiping = false;
      s.dir = null;
      s.blockedByIgnore = false;
      s.blockedByDisable = false;
    };

    const onMove = (ev: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== ev.pointerId) return;
      if (s.blockedByIgnore || s.blockedByDisable) return;
      if (!enabled) return;

      const dx = ev.clientX - s.startX;
      const dy = ev.clientY - s.startY;

      if (!s.isSwiping) {
        const dist = Math.hypot(dx, dy);
        if (dist < slop) return;

        // If vertical movement is dominant, let the browser handle scrolling
        if (Math.abs(dy) > Math.abs(dx) * 2) {
          resetState();
          return;
        }

        const intent: 'left' | 'right' = dx < 0 ? 'left' : 'right';

        if (disableDrag && disableDrag(intent)) {
          s.blockedByDisable = true;
          resetState();
          return;
        }

        s.isSwiping = true;
        s.dir = intent;
        setIsSwiping(true);
      }

      if (!s.isSwiping) return;
      
      const containerWidth = ref.current?.offsetWidth || window.innerWidth;
      if (containerWidth > 0) {
        const currentDx = ev.clientX - s.startX;
        const progressValue = currentDx / containerWidth;
        setProgress(progressValue);
      }
    };

    const onUp = (ev: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== ev.pointerId) return;

      const canTrigger =
        s.isSwiping && !s.blockedByIgnore && !s.blockedByDisable;

      if (canTrigger) {
        const dx = ev.clientX - s.startX;
        if (Math.abs(dx) >= threshold) {
            if (dx < 0 && handlers.onSwipeLeft) {
                handlers.onSwipeLeft();
            } else if (dx > 0 && handlers.onSwipeRight) {
                handlers.onSwipeRight();
            }
        }
      }

      resetState();
    };

    const onCancel = (ev: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== ev.pointerId) return;
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
  }, [
    ref,
    enabled,
    slop,
    threshold,
    ignoreSelector,
    disableDrag,
    handlers.onSwipeLeft,
    handlers.onSwipeRight,
    resetState,
  ]);

  return { progress, isSwiping };
}
