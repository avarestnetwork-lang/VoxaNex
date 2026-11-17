import React, { useRef, useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../context/RouterContext';
import { Button } from '../components/ui/Button';
import { SEOHead } from '../components/common/SEOHead';

export const PasswordResetPage: React.FC = () => {
  const { passwordRecoveryStatus, passwordRecoveryError, completePasswordReset } = useAuth();
  const { navigate } = useRouter();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitInFlightRef.current || submitting) return;

    setFormError(null);

    if (!newPassword || newPassword.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match. Please enter the exact same password in both fields.');
      return;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);

    try {
      const res = await completePasswordReset(newPassword);
      if (!res.success) {
        setFormError(res.error || 'Unable to update your password. Please try again.');
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setFormError('An unexpected error occurred while updating your password. Please try again.');
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
      <SEOHead
        title="Reset Password – ChatLustora"
        description="Set a new password for your ChatLustora account."
        canonicalPath="/user/reset-password"
        noindex={true}
      />

      <div className="p-6 sm:p-8 rounded-2xl border border-slate-800 bg-[#0d1322] shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto flex items-center justify-center select-none">
            <img
              src="/logo.png"
              alt="ChatLustora Logo"
              className="w-12 h-12 object-contain drop-shadow-[0_2px_12px_rgba(236,72,153,0.4)]"
              width={48}
              height={48}
              loading="eager"
            />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Reset Your Password</h1>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
            Choose a strong new password for your registered ChatLustora member account.
          </p>
        </div>

        {(passwordRecoveryStatus === 'idle' || passwordRecoveryStatus === 'processing') && (
          <div className="p-6 rounded-xl bg-[#101728] border border-slate-800 text-center space-y-3">
            <div className="w-8 h-8 mx-auto rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            <p className="text-sm font-medium text-slate-200">Verifying your password reset link...</p>
            <p className="text-xs text-slate-400">
              Please wait while we validate your recovery session.
            </p>
          </div>
        )}

        {passwordRecoveryStatus === 'invalid' && (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-rose-200">Invalid or Expired Reset Link</h2>
                <p className="text-xs text-rose-300 leading-relaxed">
                  {passwordRecoveryError ||
                    'This password reset link is invalid or has expired. Please return to Member Sign In and request a new recovery link.'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => navigate('/user/login')}
              >
                <span>Go to Member Sign In</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => navigate('/')}
              >
                <span>Return Home</span>
              </Button>
            </div>
          </div>
        )}

        {passwordRecoveryStatus === 'completed' && (
          <div className="space-y-5 text-center">
            <div className="p-6 rounded-xl bg-emerald-950/30 border border-emerald-800/70 space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h2 className="text-base font-bold text-white">Password Updated Successfully</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your account password has been updated. Please sign in with your new password to access your dashboard and chat rooms.
              </p>
            </div>

            <Button
              type="button"
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => navigate('/user/login')}
            >
              <span>Sign In with New Password</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}

        {passwordRecoveryStatus === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-3 rounded-xl bg-[#101728] border border-slate-800 flex items-center gap-2.5 text-xs text-slate-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Recovery session verified. Password must be at least 6 characters long.</span>
            </div>

            <div>
              <label htmlFor="reset-new-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                New Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="reset-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  disabled={submitting}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="Enter new password (min 6 chars)"
                  className="w-full bg-[#101728] border border-slate-800 rounded-lg pl-9 pr-10 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  disabled={submitting}
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 cursor-pointer disabled:opacity-50"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reset-confirm-password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="reset-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  disabled={submitting}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="Re-enter new password"
                  className="w-full bg-[#101728] border border-slate-800 rounded-lg pl-9 pr-10 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  disabled={submitting}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 cursor-pointer disabled:opacity-50"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-xs text-rose-300">
                {formError}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting}>
              <span>{submitting ? 'Updating Password...' : 'Update Password'}</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};
