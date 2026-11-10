import React, { useState, useEffect } from 'react';
import { useRouter } from '../../context/RouterContext';
import { ShieldCheck, Lock, Loader2 } from 'lucide-react';

interface ModeratorRouteGuardProps {
  children: React.ReactNode;
}

export const ModeratorRouteGuard: React.FC<ModeratorRouteGuardProps> = ({ children }) => {
  const { navigate } = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const verifyModeratorSession = async () => {
      try {
        const res = await fetch('/api/admin/me');
        if (!isMounted) return;

        if (res.ok) {
          const data = (await res.json()) as { success?: boolean; user?: { role?: string } };
          if (data.success && (data.user?.role === 'moderator' || data.user?.role === 'admin')) {
            setAuthorized(true);
          } else {
            setAuthorized(false);
            navigate('/moderator/login');
          }
        } else {
          setAuthorized(false);
          if (res.status === 401 || res.status === 403) {
            navigate('/moderator/login');
          } else {
            setErrorMsg('Unable to verify moderator session.');
          }
        }
      } catch {
        if (!isMounted) return;
        setAuthorized(false);
        setErrorMsg('Network error while verifying staff credentials.');
      } finally {
        if (isMounted) {
          setChecking(false);
        }
      }
    };

    verifyModeratorSession();
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-100">
        <div className="flex items-center gap-3 p-6 bg-[#0c1222] border border-slate-800 rounded-2xl shadow-xl">
          <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
          <span className="text-xs font-mono font-medium text-slate-300">
            Verifying Moderator Staff Session...
          </span>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 bg-slate-950 text-slate-100">
        <div className="max-w-md w-full p-8 bg-[#0c1222] border border-indigo-900/60 rounded-2xl shadow-2xl text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-indigo-950 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-800">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Access Denied</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {errorMsg || 'You must be authenticated as an authorized moderator or staff member to access this panel.'}
          </p>
          <div className="pt-2">
            <button
              onClick={() => navigate('/moderator/login')}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-lg shadow-indigo-600/20"
            >
              Go to Moderator Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
