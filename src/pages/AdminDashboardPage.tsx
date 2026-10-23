import React, { useState, useEffect } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { ROOMS_CONFIG, AGE_ASSURANCE_CONFIG } from '../config/voxanexConfig';
import { safetyService } from '../services/safetyService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import {
  SafetyReport,
  UserRestrictionRecord,
  ModerationAppeal,
  ModerationAuditLog,
  AdminPlatformSettings,
} from '../types';
import {
  Terminal,
  Activity,
  ShieldAlert,
  Sliders,
  Database,
  Radio,
  CheckCircle2,
  Clock,
  Layers,
  FileCode,
  AlertTriangle,
  RefreshCw,
  UserX,
  FileText,
  Lock,
  Eye,
  History,
  Check,
  X,
  Scale,
  Ban,
  ShieldCheck,
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();

  const [activeTab, setActiveTab] = useState<
    'health' | 'triage' | 'restrictions' | 'appeals' | 'moderators' | 'age_assurance' | 'audit' | 'channels' | 'supabase'
  >('health');

  // Server state
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [restrictions, setRestrictions] = useState<UserRestrictionRecord[]>([]);
  const [appeals, setAppeals] = useState<ModerationAppeal[]>([]);
  const [auditLogs, setAuditLogs] = useState<ModerationAuditLog[]>([]);
  const [moderators, setModerators] = useState<any[]>([]);
  const [settings, setSettings] = useState<AdminPlatformSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Moderator Form State
  const [modRoomId, setModRoomId] = useState<string>('room-bangla-main');
  const [modUserId, setModUserId] = useState<string>('');
  const [modUsername, setModUsername] = useState<string>('');
  const [modGender, setModGender] = useState<'male' | 'female' | 'other'>('female');

  // Modals & form state
  const [imposingUser, setImposingUser] = useState<string>('');
  const [imposingType, setImposingType] = useState<UserRestrictionRecord['type']>('warning');
  const [imposingReason, setImposingReason] = useState<string>('');
  const [imposingModalOpen, setImposingModalOpen] = useState(false);
  const [moderatorNotes, setModeratorNotes] = useState<Record<string, string>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [reps, restrs, apps, logs, settsRes, modsRes] = await Promise.all([
        safetyService.fetchAdminReports('admin'),
        safetyService.fetchAdminRestrictions('admin'),
        safetyService.fetchAdminAppeals('admin'),
        safetyService.fetchAuditLogs('admin'),
        fetch('/api/admin/settings').then((r) => r.json()),
        fetch('/api/admin/moderators').then((r) => r.json()),
      ]);

      setReports(reps);
      setRestrictions(restrs);
      setAppeals(apps);
      setAuditLogs(logs);
      if (settsRes?.settings) {
        setSettings(settsRes.settings);
      }
      if (modsRes?.moderators) {
        setModerators(modsRes.moderators);
      }
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
      'VoxaNex_Admin'
    );
    if (success) {
      setActionFeedback(`Report ${reportId} updated to ${status}.`);
      loadData();
      setTimeout(() => setActionFeedback(null), 2500);
    }
  };

  const handleLiftRestriction = async (userId: string) => {
    const success = await safetyService.liftRestriction(userId, 'Sanction overturned by admin review', 'VoxaNex_Admin');
    if (success) {
      setActionFeedback(`Restriction lifted for ${userId}.`);
      loadData();
      setTimeout(() => setActionFeedback(null), 2500);
    }
  };

  const handleReviewAppeal = async (appealId: string, status: 'accepted' | 'rejected') => {
    const success = await safetyService.reviewAppeal(appealId, status, 'Reviewed in admin console', 'VoxaNex_Admin');
    if (success) {
      setActionFeedback(`Appeal ${appealId} marked as ${status}.`);
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
      role: 'admin',
    });

    if (res.success) {
      setImposingModalOpen(false);
      setImposingUser('');
      setImposingReason('');
      setActionFeedback(`Imposed ${imposingType} on ${imposingUser}.`);
      loadData();
      setTimeout(() => setActionFeedback(null), 2500);
    }
  };

  const handleToggleSetting = async (key: keyof AdminPlatformSettings['featureFlags']) => {
    if (!settings) return;
    const updatedFlags = {
      ...settings.featureFlags,
      [key]: !settings.featureFlags[key],
    };

    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      body: JSON.stringify({ featureFlags: updatedFlags }),
    });
    const data = await res.json();
    if (data.settings) {
      setSettings(data.settings);
      setActionFeedback(`Feature flag ${key} updated.`);
      setTimeout(() => setActionFeedback(null), 2000);
    }
  };

  const handleAssignModerator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modUserId.trim() || !modUsername.trim()) return;

    try {
      const res = await fetch('/api/admin/moderators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: modRoomId,
          userId: modUserId.trim(),
          username: modUsername.trim(),
          gender: modGender,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setActionFeedback(`Assigned ${modUsername} as ${modGender} moderator for ${modRoomId}.`);
        setModUserId('');
        setModUsername('');
        loadData();
        setTimeout(() => setActionFeedback(null), 2500);
      } else {
        setActionFeedback(data.error || 'Failed to assign moderator.');
      }
    } catch {
      setActionFeedback('Connection error while assigning moderator.');
    }
  };

  const handleRevokeModerator = async (assignmentId: string) => {
    try {
      const res = await fetch(`/api/admin/moderators/${assignmentId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionFeedback(`Revoked moderator assignment ${assignmentId}.`);
        loadData();
        setTimeout(() => setActionFeedback(null), 2500);
      } else {
        setActionFeedback(data.error || 'Failed to revoke moderator assignment.');
      }
    } catch {
      setActionFeedback('Connection error while revoking moderator assignment.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">
            <Terminal className="w-4 h-4" />
            <span>Phase 1 Admin Auth & Moderator Management</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {t.admin.title}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            {t.admin.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Live Data</span>
          </Button>

          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-950/20 px-3 py-1.5 rounded-lg border border-emerald-800/40">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Safety Engine: Live</span>
          </div>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-[#0c1222] rounded-xl border border-slate-800 overflow-x-auto">
        {[
          { id: 'health', label: 'System & Metrics', icon: Activity },
          { id: 'triage', label: `Reports Queue (${reports.filter((r) => r.status === 'received' || r.status === 'investigating').length})`, icon: ShieldAlert },
          { id: 'restrictions', label: `Active Sanctions (${restrictions.filter((r) => r.active).length})`, icon: UserX },
          { id: 'appeals', label: `Appeals (${appeals.filter((a) => a.status === 'pending').length})`, icon: Scale },
          { id: 'moderators', label: `Room Moderators (${moderators.length})`, icon: ShieldCheck },
          { id: 'age_assurance', label: 'Age Assurance & Laws', icon: Lock },
          { id: 'audit', label: `Audit Trail (${auditLogs.length})`, icon: History },
          { id: 'channels', label: 'Room Catalog', icon: Sliders },
          { id: 'supabase', label: 'Postgres & SQL', icon: Database },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: System Health & Metrics */}
      {activeTab === 'health' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl border border-slate-800 bg-[#0c1220]">
              <div className="text-xs text-slate-400 mb-1">Open Reports</div>
              <div className="text-2xl font-bold text-rose-400">
                {reports.filter((r) => r.status === 'received' || r.status === 'investigating').length}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Requiring moderator review</p>
            </div>
            <div className="p-5 rounded-xl border border-slate-800 bg-[#0c1220]">
              <div className="text-xs text-slate-400 mb-1">Active Sanctions</div>
              <div className="text-2xl font-bold text-amber-400">
                {restrictions.filter((r) => r.active).length}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Mutes, suspensions & bans</p>
            </div>
            <div className="p-5 rounded-xl border border-slate-800 bg-[#0c1220]">
              <div className="text-xs text-slate-400 mb-1">Pending Appeals</div>
              <div className="text-2xl font-bold text-cyan-400">
                {appeals.filter((a) => a.status === 'pending').length}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Awaiting adjudication</p>
            </div>
            <div className="p-5 rounded-xl border border-slate-800 bg-[#0c1220]">
              <div className="text-xs text-slate-400 mb-1">Audited Operations</div>
              <div className="text-2xl font-bold text-emerald-400">{auditLogs.length}</div>
              <p className="text-[11px] text-slate-500 mt-1">Immutable security records</p>
            </div>
          </div>

          {/* Feature Flags Controller */}
          {settings && (
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>Feature Flags & Legal Toggles (Emergency Circuit Breakers)</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(settings.featureFlags).map(([key, enabled]) => (
                  <div
                    key={key}
                    className="p-3.5 rounded-xl border border-slate-800 bg-[#101729] flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold text-white font-mono">{key}</div>
                      <div className="text-[10px] text-slate-400">
                        {enabled ? 'Active / Enabled' : 'Disabled / Suspended'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleSetting(key as any)}
                      className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                        enabled ? 'bg-violet-600' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                          enabled ? 'right-1' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Incident Triage Queue */}
      {activeTab === 'triage' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white">Actionable Safety Reports Triage</h3>
              <p className="text-xs text-slate-400">
                Review complaints with attached incident evidence. Submissions are protected; reporter handles are hidden from peers.
              </p>
            </div>
            <span className="text-xs text-slate-400 font-mono">{reports.length} total logged</span>
          </div>

          <div className="space-y-4">
            {reports.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 rounded-xl bg-[#090e18] border border-slate-800">
                No reports submitted yet.
              </div>
            ) : (
              reports.map((report) => {
                const isResolved = report.status === 'resolved' || report.status === 'dismissed';
                return (
                  <div
                    key={report.id}
                    className={`p-4 rounded-xl border transition-colors space-y-3 ${
                      report.category === 'exploitation' || report.category === 'threats'
                        ? 'border-rose-800/80 bg-rose-950/20'
                        : isResolved
                        ? 'border-slate-800/60 bg-[#090e18]/80 opacity-75'
                        : 'border-slate-800 bg-[#101729]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-cyan-400 font-semibold">{report.id}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-300">
                          {report.targetType}: {report.reportedTarget}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-950 border border-rose-800 text-rose-300">
                          {report.category}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-slate-400">Logged: {new Date(report.timestamp).toLocaleTimeString()}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            isResolved ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}
                        >
                          Status: {report.status}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-200 bg-[#0a0f1d] p-3 rounded-lg border border-slate-800/80">
                      <span className="text-slate-500 font-semibold mr-1.5">Reason:</span>
                      {report.reasonText}
                    </p>

                    {/* Evidence Snippet */}
                    {report.evidenceSnapshot && (
                      <div className="p-2.5 rounded-lg bg-[#080c16] border border-cyan-900/40 text-[11px] text-cyan-200">
                        <span className="font-semibold text-cyan-400 block mb-0.5">Incident Evidence Snapshot:</span>
                        {typeof report.evidenceSnapshot === 'string' ? (
                          <span>{report.evidenceSnapshot}</span>
                        ) : (
                          <div>
                            {report.evidenceSnapshot.textSnippet && <div>Snippet: "{report.evidenceSnapshot.textSnippet}"</div>}
                            {report.evidenceSnapshot.roomId && <div className="text-slate-400">Room: {report.evidenceSnapshot.roomId}</div>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    {!isResolved && (
                      <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                        <input
                          type="text"
                          placeholder="Moderator notes..."
                          value={moderatorNotes[report.id] || ''}
                          onChange={(e) =>
                            setModeratorNotes({ ...moderatorNotes, [report.id]: e.target.value })
                          }
                          className="flex-1 min-w-[200px] bg-[#090d18] border border-slate-800 rounded px-2.5 py-1 text-xs text-white"
                        />

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUpdateReport(report.id, 'resolved', 'warned')}
                          >
                            Warn User
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUpdateReport(report.id, 'resolved', 'muted')}
                          >
                            Mute 1h
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUpdateReport(report.id, 'resolved', 'suspended_24h')}
                          >
                            Suspend 24h
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleUpdateReport(report.id, 'resolved', 'banned_permanent')}
                          >
                            Permanent Ban
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUpdateReport(report.id, 'dismissed', 'none')}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Active Sanctions & Restrictions */}
      {activeTab === 'restrictions' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserX className="w-4 h-4 text-rose-400" />
                <span>Active Sanctions & Restrictions</span>
              </h3>
              <p className="text-xs text-slate-400">
                Server-side mutes, temporary suspensions, and permanent bans across chat, matching, and WebRTC calls.
              </p>
            </div>

            <Button variant="danger" size="sm" onClick={() => setImposingModalOpen(true)}>
              Impose New Sanction
            </Button>
          </div>

          <div className="space-y-3">
            {restrictions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 rounded-xl bg-[#090e18] border border-slate-800">
                No active user sanctions.
              </div>
            ) : (
              restrictions.map((restr) => (
                <div
                  key={restr.id || restr.userId}
                  className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    restr.active ? 'border-amber-900/60 bg-[#101729]' : 'border-slate-800/50 bg-[#090e18] opacity-60'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-xs">{restr.userNickname}</span>
                      <span className="font-mono text-[11px] text-slate-400">({restr.userId})</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-950 text-rose-300 border border-rose-800">
                        {restr.type}
                      </span>
                      {restr.active ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 font-mono">ACTIVE</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-mono">EXPIRED/LIFTED</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300">
                      <span className="text-slate-500">Reason:</span> {restr.reason}
                    </p>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Imposed by: {restr.imposedBy} · Expires: {restr.expiresAt ? new Date(restr.expiresAt).toLocaleString() : 'Permanent'}
                    </div>
                  </div>

                  {restr.active && (
                    <Button variant="outline" size="sm" onClick={() => handleLiftRestriction(restr.userId)}>
                      Lift Sanction
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Appeals Review */}
      {activeTab === 'appeals' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-5">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Scale className="w-4 h-4 text-cyan-400" />
              <span>Moderation Appeals Adjudication</span>
            </h3>
            <p className="text-xs text-slate-400">
              Users sanctioned under temporary suspension or bans may file an appeal. Accepting an appeal lifts the server sanction automatically.
            </p>
          </div>

          <div className="space-y-3">
            {appeals.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 rounded-xl bg-[#090e18] border border-slate-800">
                No moderation appeals logged.
              </div>
            ) : (
              appeals.map((app) => (
                <div
                  key={app.id}
                  className="p-4 rounded-xl border border-slate-800 bg-[#101729] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-cyan-400 text-xs font-semibold">{app.id}</span>
                      <span className="font-bold text-white text-xs">{app.userNickname}</span>
                      <span className="text-slate-400 font-mono text-[11px]">({app.userId})</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        app.status === 'accepted'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : app.status === 'rejected'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : 'bg-amber-950 text-amber-300 border border-amber-800'
                      }`}
                    >
                      Status: {app.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-200 bg-[#090e18] p-3 rounded-lg border border-slate-800">
                    <span className="text-slate-500 font-semibold block mb-1">User Statement:</span>
                    "{app.statement}"
                  </p>

                  {app.status === 'pending' && (
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="danger" size="sm" onClick={() => handleReviewAppeal(app.id, 'rejected')}>
                        <X className="w-3.5 h-3.5 mr-1" />
                        <span>Reject Appeal</span>
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => handleReviewAppeal(app.id, 'accepted')}>
                        <Check className="w-3.5 h-3.5 mr-1" />
                        <span>Accept & Lift Sanction</span>
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4.5: Room Moderator Management */}
      {activeTab === 'moderators' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Room Moderator Management & Operational Coverage</span>
              </h3>
              <p className="text-xs text-slate-400">
                Assign authorized male and female staff moderators to specific public chatrooms. Target coverage is 1 male + 1 female moderator per room where available. Unfilled slots remain honestly reported.
              </p>
            </div>

            <span className="text-xs text-slate-400 font-mono">
              {moderators.length} active assignment{moderators.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Form: Assign Room Moderator */}
          <form onSubmit={handleAssignModerator} className="p-4 rounded-xl border border-slate-800 bg-[#101729] space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Assign Authorized Room Moderator
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Target Room</label>
                <select
                  value={modRoomId}
                  onChange={(e) => setModRoomId(e.target.value)}
                  className="w-full bg-[#090e18] border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  {ROOMS_CONFIG.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name.en} ({r.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">User ID</label>
                <input
                  type="text"
                  placeholder="e.g. usr_mod_rahim"
                  value={modUserId}
                  onChange={(e) => setModUserId(e.target.value)}
                  required
                  className="w-full bg-[#090e18] border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Display Handle</label>
                <input
                  type="text"
                  placeholder="e.g. Rahim_Staff"
                  value={modUsername}
                  onChange={(e) => setModUsername(e.target.value)}
                  required
                  className="w-full bg-[#090e18] border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Gender Focus</label>
                <select
                  value={modGender}
                  onChange={(e) => setModGender(e.target.value as any)}
                  className="w-full bg-[#090e18] border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  <option value="female">Female Moderator Target</option>
                  <option value="male">Male Moderator Target</option>
                  <option value="other">General Moderator</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" size="sm">
                Assign Moderator
              </Button>
            </div>
          </form>

          {/* Active Moderator Assignments List */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Current Room Assignments
            </h4>

            {moderators.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 rounded-xl bg-[#090e18] border border-slate-800">
                No room moderators assigned yet. Assign staff above to fill room coverage.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {moderators.map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded-xl border border-slate-800 bg-[#101729] flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{m.username}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-violet-950 border border-violet-800 text-violet-300">
                          {m.gender}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">({m.userId})</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Room: <span className="text-cyan-400">{m.roomId}</span> · Assigned by: {m.assignedBy}
                      </div>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleRevokeModerator(m.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}


      {/* TAB 5: Age Assurance Controls */}
      {activeTab === 'age_assurance' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-400" />
              <span>Age Assurance Architecture & Legal Policies</span>
            </h3>
            <p className="text-xs text-slate-400">
              Configure adult lounge eligibility thresholds, provider sandboxes, and Bangladesh statutory notices.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-800 bg-[#101729] space-y-2 text-xs">
              <span className="font-bold text-white">Current Provider Architecture</span>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Configured: <span className="font-mono text-cyan-300">Local Declaration + Veriff Sandbox</span>.
                Zero-knowledge cryptographic hashing stores verification tokens without saving user identity documents or biometric scans.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-[#101729] space-y-2 text-xs">
              <span className="font-bold text-white">Legal Disclaimers Active</span>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Statutory notice in effect: "An age-confirmation checkbox alone must not be represented as proof of age. Never permit minors into adult-oriented rooms or sexual conversations."
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-5">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-cyan-400" />
              <span>Server-Authoritative Moderation & Security Audit Trail</span>
            </h3>
            <p className="text-xs text-slate-400">
              Immutable server records of all sensitive actions, penalties, appeal rulings, and setting modifications.
            </p>
          </div>

          <div className="space-y-2">
            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 rounded-xl bg-[#090e18] border border-slate-800">
                No audit logs available.
              </div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-lg border border-slate-800 bg-[#101729] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-cyan-400">{log.action}</span>
                      <span className="text-slate-400">on</span>
                      <span className="font-bold text-white">{log.targetType}:{log.targetId}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Actor: {log.actorNickname} ({log.actorRole})
                    </div>
                  </div>

                  <span className="font-mono text-[11px] text-slate-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 7: Room Controls */}
      {activeTab === 'channels' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-4">
          <h3 className="text-base font-bold text-white">Public & Regional Rooms Catalog</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ROOMS_CONFIG.map((room) => (
              <div key={room.id} className="p-4 rounded-xl border border-slate-800 bg-[#101729] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">{room.name.en}</span>
                  {room.is18Plus && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 font-mono border border-rose-800">
                      18+ Adult Lounge
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">{room.description.en}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 8: Database & SQL Status */}
      {activeTab === 'supabase' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-[#0c1222] space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-amber-400" />
            <span>Database Migrations & RLS Policies</span>
          </h3>
          <p className="text-xs text-slate-300">
            Phase 6 migration adds tables for safety_reports, user_restrictions, moderation_appeals, moderation_audit_logs, user_connections, user_blocks, and age_verifications with Row-Level Security policies.
          </p>
        </div>
      )}

      {/* Impose Restriction Modal */}
      {imposingModalOpen && (
        <Modal isOpen={imposingModalOpen} onClose={() => setImposingModalOpen(false)} title="Impose User Sanction" size="md">
          <form onSubmit={handleImposeRestriction} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Target User ID or Nickname
              </label>
              <input
                type="text"
                value={imposingUser}
                onChange={(e) => setImposingUser(e.target.value)}
                placeholder="e.g. usr_suspicious_77"
                required
                className="w-full bg-[#101729] border border-slate-700 rounded-lg p-2.5 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Sanction Type
              </label>
              <select
                value={imposingType}
                onChange={(e) => setImposingType(e.target.value as any)}
                className="w-full bg-[#101729] border border-slate-700 rounded-lg p-2.5 text-xs text-white"
              >
                <option value="warning">Formal Recorded Warning</option>
                <option value="muted">Temporary Mute (1 Hour)</option>
                <option value="suspended_24h">Temporary Suspension (24 Hours)</option>
                <option value="suspended_7d">Temporary Suspension (7 Days)</option>
                <option value="banned_permanent">Permanent Platform Ban</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Reason & Policy Ground
              </label>
              <textarea
                value={imposingReason}
                onChange={(e) => setImposingReason(e.target.value)}
                placeholder="Specify violation, e.g. aggressive harassment or commercial spamming..."
                required
                rows={3}
                className="w-full bg-[#101729] border border-slate-700 rounded-lg p-2.5 text-xs text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setImposingModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" size="sm">
                Apply Sanction
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
