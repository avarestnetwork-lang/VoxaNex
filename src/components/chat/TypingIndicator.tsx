import React from 'react';

interface TypingIndicatorProps {
  typers: string[];
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ typers }) => {
  if (!typers || typers.length === 0) return null;

  const text =
    typers.length === 1
      ? `${typers[0]} is typing...`
      : typers.length === 2
      ? `${typers[0]} and ${typers[1]} are typing...`
      : `${typers[0]} and ${typers.length - 1} others are typing...`;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-400 font-mono animate-in fade-in">
      <div className="flex gap-1 items-center">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
      </div>
      <span className="text-[11px] text-slate-400">{text}</span>
    </div>
  );
};
