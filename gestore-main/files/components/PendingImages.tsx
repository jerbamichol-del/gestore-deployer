import React, { useState } from 'react';
import { OfflineImage } from '../utils/db';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { useTapBridge } from '../hooks/useTapBridge';

interface PendingImagesProps {
  images: OfflineImage[];
  onAnalyze: (image: OfflineImage) => void;
  onDelete: (id: string) => void;
  isOnline: boolean;
  syncingImageId: string | null;
}

const PendingImages: React.FC<PendingImagesProps> = ({ images, onAnalyze, onDelete, isOnline, syncingImageId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tapBridge = useTapBridge();

  if (images.length === 0) {
    return null;
  }
  
  const isAnalyzing = !!syncingImageId;

  return (
    <div className="bg-white rounded-2xl shadow-lg">
      <button 
        className="w-full flex items-center justify-between p-6 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded-2xl"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        {...tapBridge}
      >
        <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-700">Immagini in Attesa</h2>
            <span className="flex items-center justify-center min-w-[24px] h-6 px-2 text-sm font-semibold text-white bg-indigo-500 rounded-full">
                {images.length}
            </span>
        </div>
        <ChevronDownIcon className={`w-6 h-6 text-slate-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="px-6 pb-6 animate-fade-in-up" style={{animationDuration: '300ms'}}>
          <p className="text-sm text-slate-500 mb-6 border-t border-slate-200 pt-6">
            Queste immagini sono state salvate mentre eri offline. Clicca su "Analizza" per processarle ora che sei online.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {images.map(image => (
              <div key={image.id} className="border border-slate-200 shadow-sm flex flex-col group rounded-lg">
                <div className="relative">
                  <img
                    src={`data:${image.mimeType};base64,${image.base64Image}`}
                    alt="Anteprima spesa offline"
                    className="w-full h-24 object-cover bg-slate-100 rounded-t-lg"
                  />
                  {syncingImageId === image.id && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-t-lg">
                      <SpinnerIcon className="w-8 h-8 text-indigo-600" />
                      <span className="sr-only">Analisi in corso...</span>
                    </div>
                  )}
                </div>
                <div className="p-2 mt-auto flex items-center justify-center gap-2 bg-slate-50 rounded-b-lg">
                    <button
                      onClick={() => onAnalyze(image)}
                      disabled={!isOnline || isAnalyzing}
                      className="flex-1 px-2 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-indigo-400 disabled:cursor-not-allowed"
                      title={!isOnline ? "Connettiti a internet per analizzare" : "Analizza immagine"}
                      {...tapBridge}
                    >
                      Analizza
                    </button>
                    <button
                      onClick={() => onDelete(image.id)}
                      disabled={isAnalyzing}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Elimina immagine in attesa"
                      {...tapBridge}
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingImages;