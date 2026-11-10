import React from 'react';

interface AdPlacementBoxProps {
  slotId: string;
  label: string;
  className?: string;
  isVertical?: boolean;
}

export const AdPlacementBox: React.FC<AdPlacementBoxProps> = ({ slotId, label, className = '', isVertical = false }) => {
  return (
    <div
      data-testid={`ad-slot-${slotId}`}
      className={`rounded-xl border border-dashed border-slate-800 bg-[#0a0f1d]/60 p-3 flex flex-col items-center justify-center text-center text-slate-500 text-[11px] font-mono shrink-0 select-none shadow-inner ${
        isVertical ? 'w-[160px] lg:w-[200px] min-h-[450px]' : 'w-full min-h-[90px]'
      } ${className}`}
    >
      <div className="flex items-center gap-1.5 mb-1 text-slate-400">
        <span className="w-2 h-2 rounded-full bg-violet-500/60 animate-pulse" />
        <span className="font-bold uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-[10px] text-slate-600">Google AdSense Placement</span>
      <span className="text-[9px] text-slate-600 mt-0.5">Slot: {slotId} (Inactive pending unit ID)</span>
    </div>
  );
};
