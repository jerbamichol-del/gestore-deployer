import React from 'react';
import { AppLogoIcon } from '../icons/AppLogoIcon';

interface AuthLayoutProps {
  children: React.ReactNode;
}

/** Imposta --vh per altezze corrette su mobile e in iframe */
const useStableViewportHeight = () => {
  React.useEffect(() => {
    const setVH = () => {
      const h = (window.visualViewport?.height ?? window.innerHeight) * 0.01;
      document.documentElement.style.setProperty('--vh', `${h}px`);
    };
    setVH();
    addEventListener('resize', setVH);
    addEventListener('orientationchange', setVH);
    window.visualViewport?.addEventListener('resize', setVH);
    return () => {
      removeEventListener('resize', setVH);
      removeEventListener('orientationchange', setVH);
      window.visualViewport?.removeEventListener('resize', setVH);
    };
  }, []);
};

/** Rileva se siamo in iframe (AI Studio). Forzabile via ?studio=1 o window.__FORCE_STUDIO__ */
const useIsStudio = () => {
  const [isStudio, setIsStudio] = React.useState<boolean>(false);
  React.useEffect(() => {
    let forced =
      (typeof (window as any).__FORCE_STUDIO__ === 'boolean' && (window as any).__FORCE_STUDIO__) ||
      new URLSearchParams(location.search).has('studio');

    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true; // cross-origin → presumiamo iframe
    }
    setIsStudio(forced || inIframe);
  }, []);
  return isStudio;
};

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      background: '#fff',
      padding: 24,
      borderRadius: 16,
      boxShadow: '0 12px 28px rgba(0,0,0,0.12)',
      position: 'relative',
      overflow: 'visible', // niente clipping → autofill può estendersi
      opacity: 1,          // niente transform (no translate/scale)
    }}
  >
    {children}
  </div>
);

const Header: React.FC = () => (
  <div style={{ textAlign: 'center' }}>
    <div
      style={{
        margin: '0 auto 12px',
        width: 64,
        height: 64,
      }}
    >
      <AppLogoIcon
          style={{ width: '100%', height: '100%' }}
          aria-label="Logo Gestore Spese"
        />
    </div>
    <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: 0 }}>
      Gestore Spese
    </h1>
  </div>
);

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  useStableViewportHeight();
  const isStudio = useIsStudio();

  const mainContainerStyle: React.CSSProperties = {
    minHeight: 'calc(var(--vh, 1vh) * 100)',
    height: '100dvh',
    background: '#f1f5f9',
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif',
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    flexDirection: 'column',
    padding: 16,
    overflow: 'auto', // Allow scrolling on small viewports
  };
  
  if (isStudio) {
    // FIX: Use type assertion as 'position' and 'inset' might not be recognized
    // by the version of TypeScript or React types used in this environment.
    (mainContainerStyle as any).position = 'fixed';
    (mainContainerStyle as any).inset = 0;
  }

  // ===== Layout unificato e centrato =====
  return (
    <div
      style={mainContainerStyle}
    >
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center', // Centrato verticalmente
          justifyContent: 'center',
          overflow: 'visible',
          position: 'relative',
        }}
      >
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginBottom: 32,
            }}
          >
            <Header />
          </div>
          <Card>{children}</Card>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
