import React from 'react';

type Props = {
  onSubmit?: (email: string) => void;
};

const isValidEmail = (v: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export default function LoginEmail({ onSubmit }: Props) {
  const edRef = React.useRef<HTMLDivElement>(null);
  const hiddenRef = React.useRef<HTMLInputElement>(null);
  const [err, setErr] = React.useState<string>('');

  // evita salti in iframe/mobile: niente scroll sul form
  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    const email = (edRef.current?.textContent || '').trim();
    if (!isValidEmail(email)) {
      setErr('Inserisci un’email valida');
      return;
    }
    if (hiddenRef.current) hiddenRef.current.value = email;
    setErr('');
    onSubmit?.(email);
    // fai il tuo login qui
    console.log('LOGIN email:', email);
  };

  const plainPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = e.clipboardData?.getData('text') || '';
    document.execCommand('insertText', false, t);
  };

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      data-lpignore="true"
      data-form-type="other"
      style={{ overflow: 'visible' }}
    >
      {/* decoy: assorbe eventuali heuristics di autofill */}
      <input
        type="text"
        autoComplete="off"
        tabIndex={-1}
        readOnly
        aria-hidden="true"
        style={{ position: 'absolute', left: -9999, top: -9999, height: 0, width: 0, opacity: 0 }}
      />

      {/* hidden “vero” per compatibilità con eventuale lettura DOM */}
      <input ref={hiddenRef} type="hidden" name="email" />

      <label htmlFor="ed-email" className="block text-sm font-medium text-slate-700 mb-2">
        Email
      </label>

      {/* Campo VISIBILE senza autofill del browser */}
      <div
        id="ed-email"
        ref={edRef}
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        inputMode="email"
        aria-label="Email"
        spellCheck={false}
        // evita autocompletamento/auto-capitalize
        // (non servono su contenteditable ma non fanno male)
        // @ts-ignore
        autoCapitalize="off"
        autoCorrect="off"
        onPaste={plainPaste}
        onKeyDown={(e) => {
          // invia con Enter
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget.closest('form') as HTMLFormElement)?.requestSubmit();
          }
        }}
        style={{
          display: 'block',
          width: '100%',
          minHeight: 44,
          fontSize: 16,
          padding: '10px 12px',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          outline: 'none',
          background: '#fff',
          color: '#0f172a',
          // evita formattazione ricca su mobile webkit
          WebkitUserModify: 'read-write-plaintext-only' as any,
        }}
        // placeholder “soft”
        data-placeholder="nome@dominio.it"
        onFocus={(e) => {
          // scroll “pulito” senza transform (se servisse)
          e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
      />

      {/* placeholder CSS per contenteditable */}
      <style>{`
        #ed-email:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8; /* slate-400 */
        }
      `}</style>

      {err && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</p>}

      <button
        type="submit"
        style={{
          marginTop: 16,
          width: '100%',
          minHeight: 44,
          borderRadius: 10,
          border: '1px solid #4f46e5',
          background: '#4f46e5',
          color: '#fff',
          fontWeight: 600,
        }}
      >
        Continua
      </button>

      {/* Note di sicurezza UI: niente transform/overflow sugli antenati */}
    </form>
  );
}