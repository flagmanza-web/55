import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-stone-950 shadow-sm shadow-amber-500/20 transition"
        title="Установить приложение на устройство"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Установить</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition"
          title="Установить на iPhone / iPad"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden xs:inline">На экран</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-stone-700 bg-stone-900 p-5 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-bold text-white">Установка на iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="text-stone-400 hover:text-white"
                  aria-label="Закрыть"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-stone-300 list-decimal list-inside">
                <li>
                  Нажмите кнопку <strong className="text-amber-400 inline-flex items-center gap-1">Поделиться <Share className="w-3.5 h-3.5" /></strong> внизу панели Safari.
                </li>
                <li>
                  Пролистайте вниз и выберите <strong className="text-white">На экран «Домой»</strong>.
                </li>
                <li>
                  Нажмите <strong className="text-amber-400">Добавить</strong> — иконка САЛАТиКо появится на рабочем столе.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-amber-500 hover:bg-amber-400 py-2.5 text-sm font-semibold text-stone-950 transition"
              >
                Понятно
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
