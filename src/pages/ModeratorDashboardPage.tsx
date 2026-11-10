import React, { useState, useEffect } from 'react';
import { useRouter } from '../context/RouterContext';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import {
  SafetyReport,
  UserRestrictionRecord,
  ModerationAppeal,
} from '../types';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  UserX,
  Scale,
  LogOut,
} from 'lucide-react';

export const ModeratorDashboardPage: React.FC = () => {
  const { navigate } = useRouter();
  const [activeTab, setActiveTab] = useState<'triage' | 'restrictions' | 'appeals'>('triage');
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [restrictions, setRestrictions] = useState<UserRestrictionRecord[]>([]);
  const [appeals, setAppeals] = useState<ModerationAppeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Form states
  const [imposingUser, setImposingUser] = useState<string>('');
  const [imposingType, setImposingType] = useState<UserRestrictionRecord['type']>('warning');
  const [imposingReason, setImposingReason] = useState<string>('');
  const [imposingModalOpen, setImposingModalOpen] = useState(false);
  const [moderatorNotes, setModeratorNotes] = useState<Record<string, string>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [reps, restrs, apps] = await Promise.all([
        safetyService.fetchAdminReports('moderator'),
        safetyService.fetchAdminRestrictions('moderator'),
        safetyService.fetchAdminAppeals('moderator'),
      ]);

      setReports(reps);
      setRestrictions(restrs);
      setAppeals(apps);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateReport = async (
    reportId: string,
    status: SafetyReport['status'],
    actionTaken?: SafetyReport['actionTaken']
  ) => {
    const notes = moderatorNotes[reportId] || '';
    const success = await safetyService.updateAdminReportStatus(
      reportId,
      status,
      actionTaken,
      notes,
      'Moderator'
    );
    if (success) {
      setActionFeedback(`Report ${reportId} updated to ${status}.`);
      loadData();
      setTimeout(() => setActionFeedback(null), 2500);
    }
  };

  const handleLiftRestriction = async (userId: string) => {
    const success = await safetyService.liftRestriction(userId, 'Sanction lifted after moderator review', 'Moderator');
    if (success) {
      setActionFeedback(`Restriction lifted for user ${userId}.`);
      loadData();
      setTimeout(() => setActionFeedback(null), 2500);
    }
  };

  const handleReviewAppeal = async (appealId: string, status: 'accepted' | 'rejected') => {
    const success = await safetyService.reviewAppeal(appealId, status, 'Reviewed in moderator console', 'Moderator');
    if (success) {
      setActionFeedback(`Appeal ${appealId} set to ${status}.`);
      loadData();
      setTimeout(() => setActionFeedback(null), 2500);
    }
  };

  const handleImposeRestriction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imposingUser.trim() || !imposingReason.trim()) return;

    const res = await safetyService.imposeRestriction({
      userId: imposingUser.trim(),
      userNickname: imposingUser.trim(),
      type: imposingType,
      reason: imposingReason.trim(),
      role: 'moderator',
    });

    if (res.success) {
      setActionFeedback(`Restriction ${imposingType} imposed on user ${imposingUser}.`);
      setImposingModalOpen(false);
      setImposingUser('');
      setImposingReason('');
      loadData();
      setTimeout(() => setActionFeedback(null), 2500);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/moderator/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    navigate('/moderator/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-[#0c1222] border border-indigo-900/60 rounded-2xl shadow-2xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl font-bold tracking-tight text-white">Community Moderator Console</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-950 border border-indigo-700 text-indigo-300">
              Role: Moderator
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Real-time report triage, user restrictions, and moderation appeals enforcement.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={loadData}
            disabled={loading}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="danger"
            onClick={handleLogout}
            className="bg-rose-950 border border-rose-800 text-rose-300 hover:bg-rose-900"
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5" />
            Logout
          </Button>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-4 rounded-xl bg-indigo-950/60 border border-indigo-700 text-indigo-200 text-xs flex items-center justify-between">
          <span>{actionFeedback}</span>
          <CheckCircle2 className="w-4 h-4 text-indigo-400" />
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('triage')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'triage'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
              : 'text-slate-400 hover:bg-slate-900 hover:text-white'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Safety Reports Queue ({reports.filter((r) => r.status === 'received' || r.status === 'investigating').length})</span>
        </button>

        <button
          onClick={() => setActiveTab('restrictions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'restrictions'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
              : 'text-slate-400 hover:bg-slate-900 hover:text-white'
          }`}
        >
          <UserX className="w-4 h-4" />
          <span>User Restrictions ({restrictions.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('appeals')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'appeals'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
              : 'text-slate-400 hover:bg-slate-900 hover:text-white'
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>Appeals Review ({appeals.filter((a) => a.status === 'pending').length})</span>
        </button>
      </div>

      {/* Tab 1: Safety Triage Queue */}
      {activeTab === 'triage' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Pending & Actioned Safety Reports
            </h2>
          </div>

          {reports.length === 0 ? (
            <div className="p-8 text-center bg-[#0c1222] border border-slate-800 rounded-2xl text-slate-500 text-xs">
              No safety reports found in queue.
            </div>
          ) : (
            <div className="grid gap-4">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="p-5 bg-[#0c1222] border border-slate-800 rounded-2xl space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          report.status === 'received' || report.status === 'investigating'
                            ? 'bg-amber-950 border border-amber-700 text-amber-300'
                            : report.status === 'action_taken' || report.status === 'resolved'
                            ? 'bg-emerald-950 border border-emerald-700 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {report.status}
                      </span>
                      <span className="text-xs font-bold text-white">{report.category}</span>
                      <span className="text-[11px] text-slate-500">• Target: {report.targetType} ({report.targetId})</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">
                      {new Date(report.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                    "{report.reasonText}"
                  </p>

                  {(report.status === 'received' || report.status === 'investigating') && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                      <input
                        type="text"
                        placeholder="Add moderator notes..."
                        value={moderatorNotes[report.id] || ''}
                        onChange={(e) =>
                          setModeratorNotes({ ...moderatorNotes, [report.id]: e.target.value })
                        }
                        className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUpdateReport(report.id, 'dismissed')}
                          className="text-xs border-slate-700 hover:bg-slate-800"
                        >
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleUpdateReport(report.id, 'action_taken', 'warned')}
                          className="text-xs bg-amber-600 hover:bg-amber-500 text-white"
                        >
                          Issue Warning
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleUpdateReport(report.id, 'action_taken', 'banned_permanent')}
                          className="text-xs bg-rose-600 hover:bg-rose-500 text-white"
                        >
                          Ban User
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: User Restrictions */}
      {activeTab === 'restrictions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Enforced Sanctions & Restrictions
            </h2>
            <Button
              size="sm"
              onClick={() => setImposingModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
            >
              Impose New Restriction
            </Button>
          </div>

          {restrictions.length === 0 ? (
            <div className="p-8 text-center bg-[#0c1222] border border-slate-800 rounded-2xl text-slate-500 text-xs">
              No active restrictions on record.
            </div>
          ) : (
            <div className="grid gap-3">
              {restrictions.map((restr) => (
                <div
                  key={restr.id}
                  className="p-4 bg-[#0c1222] border border-slate-800 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-white">{restr.userNickname || restr.userId}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-rose-950 border border-rose-800 text-rose-300">
                        {restr.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{restr.reason}</p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleLiftRestriction(restr.userId)}
                    className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs shrink-0"
                  >
                    Lift Sanction
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Appeals Review */}
      {activeTab === 'appeals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              User Moderation Appeals
            </h2>
          </div>

          {appeals.length === 0 ? (
            <div className="p-8 text-center bg-[#0c1222] border border-slate-800 rounded-2xl text-slate-500 text-xs">
              No moderation appeals pending review.
            </div>
          ) : (
            <div className="grid gap-4">
              {appeals.map((appeal) => (
                <div key={appeal.id} className="p-5 bg-[#0c1222] border border-slate-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="text-xs font-bold text-white">Appeal by {appeal.userNickname || appeal.userId}</span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      {appeal.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 bg-slate-900/50 p-3 rounded-xl border border-slate-800">
                    "{appeal.statement}"
                  </p>

                  {appeal.status === 'pending' && (
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReviewAppeal(appeal.id, 'rejected')}
                        className="text-xs border-slate-700 hover:bg-slate-800"
                      >
                        Reject Appeal
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleReviewAppeal(appeal.id, 'accepted')}
                        className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        Accept & Overturn
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Impose Restriction Modal */}
      <Modal
        isOpen={imposingModalOpen}
        onClose={() => setImposingModalOpen(false)}
        title="Impose Moderator Restriction"
      >
        <form onSubmit={handleImposeRestriction} className="space-y-4 p-4 text-slate-100">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-slate-300">Target User ID / Username</label>
            <input
              type="text"
              required
              value={imposingUser}
              onChange={(e) => setImposingUser(e.target.value)}
              placeholder="e.g. user-123 or guest_456"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-slate-300">Restriction Type</label>
            <select
              value={imposingType}
              onChange={(e) => setImposingType(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white"
            >
              <option value="warning">Official Warning</option>
              <option value="mute">Mute (Public & Private Chat)</option>
              <option value="temp_ban">Temporary Suspension</option>
              <option value="perm_ban">Permanent Ban</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-slate-300">Reason & Policy Citation</label>
            <textarea
              required
              rows={3}
              value={imposingReason}
              onChange={(e) => setImposingReason(e.target.value)}
              placeholder="State clear reasons for restriction..."
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" type="button" onClick={() => setImposingModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold">
              Impose Restriction
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
