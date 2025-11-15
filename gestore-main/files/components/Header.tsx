
import React from 'react';
import { PhotoIcon } from './icons/PhotoIcon';
import { HomeNavIcon } from './icons/HomeNavIcon';
import { ArchiveBoxIcon } from './icons/ArchiveBoxIcon';
import { ArrowDownOnSquareIcon } from './icons/ArrowDownOnSquareIcon';

type NavView = 'home' | 'history';

interface HeaderProps {
    pendingSyncs: number;
    isOnline: boolean;
    activeView: NavView;
    onNavigate: (view: NavView) => void;
    onInstallClick: () => void;
    installPromptEvent: any;
}

const NavItem = ({ label, icon, isActive, onClick }: { label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }) => {
    const activeClasses = 'text-indigo-600 border-indigo-500';
    const inactiveClasses = 'text-slate-500 border-transparent hover:text-slate-800 hover:border-slate-300';

    return (
        <button
            onClick={onClick}
            className={`flex-1 flex items-center justify-center gap-2 py-3 border-b-2 font-semibold text-base transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-400 ${isActive ? activeClasses : inactiveClasses}`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
};


const Header: React.FC<HeaderProps> = ({ pendingSyncs, isOnline, activeView, onNavigate, onInstallClick, installPromptEvent }) => {
  return (
    <header className="bg-white shadow-md sticky top-0 z-20">
      <div>
        <div className="py-2 flex items-center justify-end gap-3 px-4 md:px-8">
          <div className="flex items-center gap-4">
              {!isOnline && (
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-600 bg-amber-100 px-3 py-1.5 rounded-full">
                      <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      <span>Offline</span>
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
                      <span>Installa</span>
                  </button>
              )}
          </div>
        </div>
        <div className="flex" role="navigation">
            <NavItem 
                label="Home"
                icon={<HomeNavIcon className="w-6 h-6" />}
                isActive={activeView === 'home'}
                onClick={() => onNavigate('home')}
            />
            <NavItem 
                label="Storico"
                icon={<ArchiveBoxIcon className="w-6 h-6" />}
                isActive={activeView === 'history'}
                onClick={() => onNavigate('history')}
            />
        </div>
      </div>
    </header>
  );
};

export default Header;