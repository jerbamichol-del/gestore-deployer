
import React from 'react';
import { PhotoIcon } from './icons/PhotoIcon';
import { ArrowDownOnSquareIcon } from './icons/ArrowDownOnSquareIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';

interface HeaderProps {
    pendingSyncs: number;
    isOnline: boolean;
    onInstallClick: () => void;
    installPromptEvent: any;
    onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({ pendingSyncs, isOnline, onInstallClick, installPromptEvent, onLogout }) => {
  return (
    <header className="bg-white shadow-md sticky top-0 z-20">
      <div>
        <div className="py-2 flex items-center justify-between gap-3 px-4 md:px-8 h-[58px]">
          <h1 className="text-xl font-bold text-slate-800">Gestore Spese</h1>
          <div className="flex items-center gap-4">
              {!isOnline && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-600 bg-amber-100 px-3 py-1.5 rounded-full">
                      <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      <span className="hidden sm:inline">Offline</span>
                  </div>
              )}
              {pendingSyncs > 0 && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-100 px-3 py-1.5 rounded-full" title={`${pendingSyncs} immagini in attesa di analisi`}>
                      <PhotoIcon className="w-5 h-5" />
                      <span>{pendingSyncs}</span>
                  </div>
              )}
              {installPromptEvent && (
                  <button
                      onClick={onInstallClick}
                      className="flex items-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-100 px-3 py-1.5 rounded-full hover:bg-indigo-200 transition-colors"
                      aria-label="Installa App"
                      title="Installa App"
                  >
                      <ArrowDownOnSquareIcon className="w-5 h-5" />
                      <span className="hidden sm:inline">Installa</span>
                  </button>
              )}
              <button
                  onClick={onLogout}
                  className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                  aria-label="Logout"
                  title="Logout"
              >
                  <LockClosedIcon className="w-6 h-6" />
              </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
