import React, { useState, useEffect } from 'react';
import { useRouter } from '../../context/RouterContext';
import { ShieldAlert, Lock, Loader2 } from 'lucide-react';

interface AdminRouteGuardProps {
  children: React.ReactNode;
}

export const AdminRouteGuard: React.FC<AdminRouteGuardProps> = ({ children }) => {
  const { navigate } = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const verifyAdminSession = async () => {
      try {
        const res = await fetch('/api/admin/me');
        if (!isMounted) return;

        if (res.ok) {
          const data = await res.json();
          if (data.success && (data.user?.role === 'admin' || data.user?.role === 'moderator')) {
            setAuthorized(true);
          } else {
            setAuthorized(false);
            navigate('/admin/login');
          }
        } else {
          setAuthorized(false);
          if (res.status === 401 || res.status === 403) {
            navigate('/admin/login');
          } else {
            setErrorMsg('Unable to verify administrator session.');
          }
        }
      } catch (err) {
        if (!isMounted) return;
        setAuthorized(false);
        setErrorMsg('Network error while checking authorization status.');
      } finally {
        if (isMounted) {
          setChecking(false);
        }
      }
    };

    verifyAdminSession();
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-100">
        <div className="flex items-center gap-3 p-6 bg-[#0c1222] border border-slate-800 rounded-2xl shadow-xl">
          <Loader2 className="w-5 h-5 text-rose-500 animate-spin" />
          <span className="text-xs font-mono font-medium text-slate-300">
            Verifying Cryptographic Admin Session...
          </span>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 bg-slate-950 text-slate-100">
        <div className="max-w-md w-full p-8 bg-[#0c1222] border border-rose-900/60 rounded-2xl shadow-2xl text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-950 text-rose-400 flex items-center justify-center mx-auto border border-rose-800">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Access Denied</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {errorMsg || 'You must be authenticated as an authorized administrator or staff member to view this console.'}
          </p>
          <div className="pt-2">
            <button
              onClick={() => navigate('/admin/login')}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-lg shadow-rose-600/20"
            >
              Go to Admin Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
