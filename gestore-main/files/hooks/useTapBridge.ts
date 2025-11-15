// hooks/useTapBridge.ts
// FIX: Import React to provide types for events.
import React, { useRef, useCallback } from 'react';

type Options = { slopPx?: number; tapMs?: number; };

/**
 * TapBridge: Evita il "primo tap a vuoto" e sopprime i doppi click
 * senza interferire con altri gesti come lo swipe.
 *
 * Funziona in fase di "capture" per essere più cooperativo.
 */
export function useTapBridge(opts: Options = {}) {
  const SLOP = opts.slopPx ?? 10;
  const TAP_MS = opts.tapMs ?? 350;

  const stateRef = useRef({
    id: null as number | null,
    t0: 0,
    x0: 0,
    y0: 0,
    moved: false,
    target: null as EventTarget | null,
    suppressNextClick: false,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Se un altro puntatore è già attivo, ignora.
    if (stateRef.current.id !== null && e.pointerId !== stateRef.current.id) return;
    
    const state = stateRef.current;
    state.id = e.pointerId;
    state.t0 = performance.now();
    state.x0 = e.clientX;
    state.y0 = e.clientY;
    state.moved = false;
    state.target = e.target;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id !== e.pointerId || state.moved) return;

    const dx = Math.abs(e.clientX - state.x0);
    const dy = Math.abs(e.clientY - state.y0);
    if (dx > SLOP || dy > SLOP) {
      state.moved = true;
    }
  }, [SLOP]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id !== e.pointerId) return;

    const isTap = !state.moved && (performance.now() - state.t0) < TAP_MS;
    const target = state.target as HTMLElement | null;

    // Resetta l'ID del puntatore per terminare il gesto per questo bridge
    state.id = null;

    if (isTap && target && !target.closest?.('[data-no-synthetic-click]')) {
      // Questo bridge sta gestendo il tap. Ferma la propagazione per evitare che i bridge parent facciano lo stesso.
      e.stopPropagation();

      state.suppressNextClick = true;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        if (document.activeElement !== target) {
          target.focus();
        }
      }

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      target.dispatchEvent(clickEvent);
    }
  }, [TAP_MS]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    const state = stateRef.current;
    
    if (state.suppressNextClick && e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
      state.suppressNextClick = false; // Consuma il flag
    }
  }, []);

  // FIX: Added onPointerCancel handler to reset gesture state when canceled.
  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id === e.pointerId) {
      // Reset the state to cancel the tap gesture
      state.id = null;
      state.moved = false;
      state.target = null;
      state.suppressNextClick = false;
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  };
}