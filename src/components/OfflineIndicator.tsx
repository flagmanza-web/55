import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 sm:bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-stone-900/95 px-3 py-2 text-xs font-medium text-amber-300 shadow-lg backdrop-blur-sm"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>Офлайн-режим — работают сохранённые данные</span>
    </div>
  );
};
