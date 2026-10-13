import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080c15] disabled:opacity-50 disabled:cursor-not-allowed select-none rounded-lg cursor-pointer';

  const sizeStyles = {
    sm: 'text-xs py-1.5 px-3 min-h-[36px]',
    md: 'text-sm py-2 px-4 min-h-[42px]',
    lg: 'text-base py-2.5 px-6 min-h-[48px]',
  };

  const variantStyles = {
    primary:
      'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-violet-900/30 hover:shadow-violet-900/50 active:scale-[0.98]',
    secondary:
      'bg-[#161f33] hover:bg-[#1e2a45] text-slate-200 border border-slate-700/60 active:scale-[0.98]',
    accent:
      'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold shadow-md shadow-cyan-950/40 active:scale-[0.98]',
    danger:
      'bg-rose-600/90 hover:bg-rose-600 text-white shadow-sm hover:shadow-rose-900/40 active:scale-[0.98]',
    ghost:
      'text-slate-300 hover:text-white hover:bg-slate-800/60 active:scale-[0.98]',
    outline:
      'border border-slate-700 text-slate-200 hover:border-violet-500/80 hover:bg-violet-950/20 active:scale-[0.98]',
  };

  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${widthStyle} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
