
import React, { useRef, useCallback } from 'react';

type Options = {
  slopPx?: number; // quanto puoi muoverti (in px) e restare un tap
  tapMs?: number;  // durata massima del tap
};

/**
 * TapBridge: gestisce i TAP (tocchi singoli)
 * - Evita il "primo tap a vuoto"
 * - Sopprime il doppio click nativo
 * - Gestisce il "Ghost Click" intercettando il click nativo successivo a livello globale
 */
export function useTapBridge(opts: Options = {}) {
  const SLOP = opts.slopPx ?? 10;
  const TAP_MS = opts.tapMs ?? 350;

  const stateRef = useRef({
    id: null as number | null,
    t0: 0,
    x0: 0,
    y0: 0,
    target: null as EventTarget | null,
  });

  // Strategia "Ghost Click Buster": intercetta il prossimo click nativo fidato e lo uccide.
  const preventGhostClick = useCallback(() => {
    const handler = (e: Event) => {
      // Interrompiamo solo i click "fidati" (generati dal browser/utente),
      // lasciando passare quelli sintetici (che non sono trusted).
      if (e.isTrusted) {
        e.stopPropagation();
        e.preventDefault();
        window.removeEventListener('click', handler, true);
      }
    };

    // Usa capture: true per intercettare l'evento prima che scenda nel DOM
    window.addEventListener('click', handler, { capture: true, once: false });

    // Rimuovi il listener dopo un tempo sufficiente a coprire il ritardo del browser (circa 300-400ms)
    setTimeout(() => {
      window.removeEventListener('click', handler, true);
    }, 600);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;

    if (state.id !== null && e.pointerId !== state.id) return;

    state.id = e.pointerId;
    state.t0 = performance.now();
    state.x0 = e.clientX;
    state.y0 = e.clientY;
    state.target = e.target;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id !== e.pointerId) return;
    // NON facciamo nulla qui: gli swipe restano liberi
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const state = stateRef.current;
      if (state.id !== e.pointerId) return;

      const dt = performance.now() - state.t0;
      const dx = Math.abs(e.clientX - state.x0);
      const dy = Math.abs(e.clientY - state.y0);
      const target = state.target as HTMLElement | null;

      state.id = null;

      const isTap = dt < TAP_MS && dx <= SLOP && dy <= SLOP;

      if (isTap && target && !target.closest?.('[data-no-synthetic-click]')) {
        // 1. Previeni il comportamento predefinito se possibile (aiuta a sopprimere click e focus nativi indesiderati)
        if (e.cancelable) e.preventDefault();

        // 2. Attiva il buster globale per uccidere il click nativo ritardato che il browser potrebbe comunque generare
        preventGhostClick();

        // 3. Gestione Focus manuale per input
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target as any).isContentEditable
        ) {
          if (document.activeElement !== target) {
            target.focus();
          }
        }

        // 4. Dispatch evento Click Sintetico immediato
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        target.dispatchEvent(clickEvent);
      }

      state.target = null;
    },
    [SLOP, TAP_MS, preventGhostClick],
  );

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    if (state.id === e.pointerId) {
      state.id = null;
      state.target = null;
    }
  }, []);

  // onClickCapture non è più strettamente necessario con il buster globale,
  // ma lo lasciamo vuoto per mantenere l'interfaccia del hook.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    // No-op
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  };
}
