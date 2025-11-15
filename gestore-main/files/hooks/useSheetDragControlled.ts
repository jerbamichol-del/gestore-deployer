import { RefObject, useEffect, useRef, useState } from 'react';

type Options = {
  triggerPercent?: number;      // frazione H() oltre cui chiudere (solo su release)
  elastic?: number;             // 0..1, 1 = senza attrito
  closeSpeedPxMs?: number;      // velocità “percepita” di chiusura
  openSpeedPxMs?: number;       // velocità “percepita” di ritorno
  topGuardPx?: number;          // tolleranza per considerare scrollTop “in cima”
  scrollableSelector?: string;  // selettore per l’area scrollabile interna
};

type Handlers = { onClose: () => void };

function findScrollable(root: HTMLElement | null, selector?: string): HTMLElement | null {
  if (!root) return null;
  if (selector) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  const q: HTMLElement[] = [root];
  while (q.length) {
    const n = q.shift()!;
    if (n !== root) {
      const s = getComputedStyle(n);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    q.push(...(Array.from(n.children) as HTMLElement[]));
  }
  return null;
}

export function useSheetDragControlled<T extends HTMLElement>(
  sheetRef: RefObject<T>,
  { onClose }: Handlers,
  opts: Options = {}
) {
  const {
    triggerPercent = 0.25,
    elastic = 0.92,
    closeSpeedPxMs = 2.2,   // più alto = più veloce
    openSpeedPxMs = 2.8,
    topGuardPx = 2,
    scrollableSelector,
  } = opts;

  const [dragY, setDragY] = useState(0);
  const [transitionMs, setTransitionMs] = useState(0);
  const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  const g = useRef({
    active: false,
    tookOver: false,
    startX: 0,
    startY: 0,
    lastY: 0,
    lastT: 0,
    vy: 0, // Velocity in px/ms
    scroller: null as HTMLElement | null,
    closing: false,
    isLocked: false, // For gesture direction
  }).current;

  const H = () => (sheetRef.current?.clientHeight || 1);

  const animate = (from: number, to: number, speedPxMs: number, closing: boolean) => {
    const dist = Math.max(1, Math.abs(to - from));
    const ms = Math.max(100, Math.min(420, Math.round(dist / speedPxMs)));
    g.closing = closing;
    setTransitionMs(0);
    setDragY(from);
    requestAnimationFrame(() => {
      setTransitionMs(ms);
      setDragY(to);
    });
  };

  const handleTransitionEnd = (e?: TransitionEvent) => {
    if (e && e.propertyName && e.propertyName !== 'transform') return;
    if (g.closing) {
      g.closing = false;
      setTransitionMs(0);
      setDragY(0);
      onClose();
    } else {
      setTransitionMs(0);
    }
  };

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const onStart = (x: number, y: number) => {
      g.active = true;
      g.tookOver = false;
      g.isLocked = false;
      g.startX = x;
      g.startY = y;
      g.lastY = y;
      g.lastT = performance.now();
      g.vy = 0;
      g.scroller = findScrollable(sheet, scrollableSelector);
    };

    const onMove = (x: number, y: number, e: Event) => {
      if (!g.active) return;
      
      const t = performance.now();
      const dt = t - g.lastT;
      const dyInstant = y - g.lastY;

      if (dt > 1) { // Sample to avoid noisy data
        const velocity = dyInstant / dt;
        g.vy = g.vy * 0.8 + velocity * 0.2; // EMA smoothing
      }
      g.lastY = y;
      g.lastT = t;
      
      const dx = x - g.startX;
      const dy = y - g.startY;

      if (!g.isLocked) {
        const SLOP = 10;
        if (Math.abs(dx) <= SLOP && Math.abs(dy) <= SLOP) return;

        const isVertical = Math.abs(dy) > Math.abs(dx);
        if (!isVertical) {
            // Horizontal gesture, bail out.
            g.active = false;
            return;
        }
        g.isLocked = true; // Lock to vertical gesture
      }


      const atTop = !g.scroller || g.scroller.scrollTop <= topGuardPx;
      const movingDown = dy > 0;

      if (!g.tookOver && movingDown && atTop) {
        g.tookOver = true;
      }

      if (g.tookOver) {
        if ('preventDefault' in e && (e as any).cancelable) e.preventDefault();
        setTransitionMs(0); // segue il dito 1:1 (con elastic)
        const current = Math.max(0, dy) * elastic;
        setDragY(Math.min(current, H() * 0.98));
      }
    };

    const onEnd = () => {
      if (!g.active) return;
      g.active = false;

      if (g.tookOver) {
        const h = H();
        const currentY = dragY;

        // Check velocity for "flick" gesture
        const FLICK_VELOCITY_THRESHOLD = 0.3; // px/ms; adjusted to be more sensitive
        const isFlickDown = g.vy > FLICK_VELOCITY_THRESHOLD;

        const draggedFarEnough = currentY >= h * triggerPercent;

        const shouldClose = draggedFarEnough || isFlickDown;

        if (shouldClose) {
          const speed = isFlickDown ? closeSpeedPxMs * 1.5 : closeSpeedPxMs;
          animate(currentY, h, speed, true);  // Close
        } else {
          animate(currentY, 0, openSpeedPxMs, false);  // Return to top
        }
      }
    };

    // Prefer TOUCH events for reliability
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!g.active || e.touches.length !== 1) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY, e);
    };
    const onTouchEnd = () => onEnd();
    const onTouchCancel = () => onEnd();

    // Pointer fallback
    const onPointerDown = (e: PointerEvent) => onStart(e.clientX, e.clientY);
    const onPointerMove = (e: PointerEvent) => onMove(e.clientX, e.clientY, e);
    const onPointerUp = () => onEnd();
    const onPointerCancel = () => onEnd();

    // Listeners
    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('touchend', onTouchEnd, { passive: true });
    sheet.addEventListener('touchcancel', onTouchCancel, { passive: true });

    sheet.addEventListener('pointerdown', onPointerDown, { passive: true });
    sheet.addEventListener('pointermove', onPointerMove, { passive: false });
    sheet.addEventListener('pointerup', onPointerUp, { passive: true });
    sheet.addEventListener('pointercancel', onPointerCancel, { passive: true });

    return () => {
      sheet.removeEventListener('touchstart', onTouchStart as any);
      sheet.removeEventListener('touchmove', onTouchMove as any);
      sheet.removeEventListener('touchend', onTouchEnd as any);
      sheet.removeEventListener('touchcancel', onTouchCancel as any);

      sheet.removeEventListener('pointerdown', onPointerDown as any);
      sheet.removeEventListener('pointermove', onPointerMove as any);
      sheet.removeEventListener('pointerup', onPointerUp as any);
      sheet.removeEventListener('pointercancel', onPointerCancel as any);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetRef, onClose, triggerPercent, elastic, topGuardPx, scrollableSelector, dragY, closeSpeedPxMs, openSpeedPxMs]);

  return { dragY, transitionMs, easing, handleTransitionEnd };
}