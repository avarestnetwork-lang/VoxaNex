import React, { useState, useEffect } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { ForumTopic, ForumReply } from '../types';
import { communityService } from '../services/communityService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { toRelativeTime, formatDhakaDate } from '../utils/date';
import {
  MessageSquare,
  Users,
  Search,
  PlusCircle,
  Pin,
  Eye,
  MessageCircle,
  Clock,
  Sparkles,
  ArrowLeft,
  Trash2,
  Lock,
  Shield,
  Send,
  Flag,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';

export const ForumPage: React.FC = () => {
  const { navigate, params } = useRouter();
  const { language, t } = useLanguage();
  const { user } = useAuth();

  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<(ForumTopic & { replies?: ForumReply[] }) | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTopics, setTotalTopics] = useState(0);

  // New post modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<ForumTopic['category']>('general');
  const [newContent, setNewContent] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Reply state
  const [replyContent, setReplyContent] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  // Report modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [reportSuccess, setReportSuccess] = useState(false);

  // Load topics
  const loadTopics = async (p = 1) => {
    setLoading(true);
    const res = await communityService.getTopics({
      category: categoryFilter,
      q: searchQuery,
      page: p,
      limit: 10,
    });
    if (res.success) {
      setTopics(res.topics);
      setPage(res.page);
      setTotalPages(res.totalPages);
      setTotalTopics(res.total);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTopics(1);
  }, [categoryFilter, searchQuery]);

  // If URL contains topicId parameter, load details
  useEffect(() => {
    if (params.topicId) {
      loadTopicDetails(params.topicId);
    }
  }, [params.topicId]);

  const loadTopicDetails = async (id: string) => {
    const res = await communityService.getTopicById(id);
    if (res.success && res.topic) {
      setSelectedTopic(res.topic);
    }
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setCreateSubmitting(true);
    setErrorMessage('');

    const catLabels: Record<ForumTopic['category'], { en: string; bn: string }> = {
      general: { en: 'General', bn: 'সাধারণ' },
      banglish: { en: 'Banglish', bn: 'বাংলিশ' },
      tech: { en: 'Tech & Code', bn: 'প্রযুক্তি ও কোড' },
      regional: { en: 'Regional', bn: 'আঞ্চলিক' },
      safety: { en: 'Safety', bn: 'নিরাপত্তা' },
      international: { en: 'International', bn: 'আন্তর্জাতিক' },
    };

    const res = await communityService.createTopic({
      authorId: user.id,
      authorNickname: user.nickname,
      authorAvatar: user.avatar,
      authorRole: user.role || (user.email?.includes('admin') ? 'admin' : 'user'),
      title: newTitle.trim(),
      category: newCategory,
      categoryLabel: catLabels[newCategory],
      content: newContent.trim(),
    });

    setCreateSubmitting(false);

    if (res.success && res.topic) {
      setNewModalOpen(false);
      setNewTitle('');
      setNewContent('');
      loadTopics(1);
      loadTopicDetails(res.topic.id);
    } else {
      setErrorMessage(res.error || 'Failed to publish topic');
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTopic || !replyContent.trim()) return;

    setReplySubmitting(true);
    const res = await communityService.replyToTopic({
      topicId: selectedTopic.id,
      authorId: user.id,
      authorNickname: user.nickname,
      authorAvatar: user.avatar,
      authorRole: user.role || 'user',
      content: replyContent.trim(),
    });

    setReplySubmitting(false);

    if (res.success && res.reply) {
      setReplyContent('');
      setSelectedTopic((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          repliesCount: prev.repliesCount + 1,
          replies: [...(prev.replies || []), res.reply!],
        };
      });
    }
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!confirm('Are you sure you want to delete this discussion topic?')) return;
    const ok = await communityService.deleteTopic(topicId, user.role || 'admin');
    if (ok) {
      setSelectedTopic(null);
      loadTopics(page);
    }
  };

  const handleOpenReport = (targetName: string) => {
    setReportTarget(targetName);
    setReportReason('');
    setReportSuccess(false);
    setReportModalOpen(true);
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) return;
    try {
      await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportedTarget: reportTarget,
          category: 'harassment',
          reasonText: reportReason,
          reporterNickname: user.nickname,
        }),
      });
      setReportSuccess(true);
      setTimeout(() => setReportModalOpen(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-500/20 mb-1">
              <Users className="w-7 h-7 text-white" />
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-orange-600 dark:text-orange-400 tracking-wider uppercase">
              <span>Community Forum & Discussions</span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {t.forum.title}
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 max-w-2xl">
              {t.forum.subtitle}
            </p>
          </div>

        <div className="flex items-center gap-3">
          <Button size="md" variant="primary" onClick={() => setNewModalOpen(true)}>
            <PlusCircle className="w-4 h-4 mr-2" />
            <span>{t.forum.newTopicBtn}</span>
          </Button>
        </div>
      </div>

      {/* Selected Topic Details View */}
      {selectedTopic ? (
        <div className="space-y-6">
          <button
            onClick={() => {
              setSelectedTopic(null);
              navigate('/forum');
            }}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to All Discussions</span>
          </button>

          <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-6 sm:p-8 space-y-6">
            {/* Topic Header */}
            <div className="space-y-3 pb-6 border-b border-slate-800">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-violet-400">
                    {selectedTopic.categoryLabel[language]}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500 font-mono">
                    {formatDhakaDate(selectedTopic.createdAt, language)}
                  </span>
                  {selectedTopic.pinned && (
                    <span className="text-amber-400 font-mono text-[10px] bg-amber-950/40 border border-amber-800/50 px-1.5 py-0.5 rounded">
                      Pinned
                    </span>
                  )}
                  {selectedTopic.isLocked && (
                    <span className="text-rose-400 font-mono text-[10px] bg-rose-950/40 border border-rose-800/50 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Locked
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenReport(`Topic: ${selectedTopic.title}`)}
                    className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors text-xs flex items-center gap-1"
                    title="Report Topic"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>Report</span>
                  </button>

                  {(user.role === 'admin' || user.id === selectedTopic.authorId) && (
                    <button
                      onClick={() => handleDeleteTopic(selectedTopic.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors text-xs flex items-center gap-1"
                      title="Delete Topic"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-white">
                {selectedTopic.title}
              </h2>

              <div className="flex items-center gap-2.5 text-xs text-slate-400">
                <span className="text-lg select-none">{selectedTopic.authorAvatar}</span>
                <span className="font-semibold text-slate-200">{selectedTopic.author}</span>
                {selectedTopic.authorRole === 'admin' && (
                  <span className="text-[10px] bg-violet-950 text-violet-300 border border-violet-800 px-1.5 py-0.5 rounded font-mono">
                    Admin
                  </span>
                )}
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-slate-500 font-mono">
                  <Eye className="w-3.5 h-3.5" /> {selectedTopic.viewsCount} views
                </span>
              </div>
            </div>

            {/* Topic Body */}
            <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-line py-2">
              {selectedTopic.content}
            </div>

            {/* Replies Section */}
            <div className="pt-6 border-t border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-cyan-400" />
                <span>Replies ({selectedTopic.replies?.length || 0})</span>
              </h3>

              {/* Replies List */}
              <div className="space-y-3">
                {selectedTopic.replies && selectedTopic.replies.length > 0 ? (
                  selectedTopic.replies.map((reply) => (
                    <div
                      key={reply.id}
                      className="p-4 rounded-xl border border-slate-800/80 bg-[#090d18] space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span>{reply.authorAvatar}</span>
                          <span className="font-semibold text-slate-300">
                            {reply.authorNickname}
                          </span>
                          {reply.authorRole === 'admin' && (
                            <span className="text-[9px] bg-violet-950 text-violet-300 border border-violet-800 px-1 py-0.5 rounded font-mono">
                              Staff
                            </span>
                          )}
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-slate-500 font-mono">
                            {toRelativeTime(reply.createdAt, language)}
                          </span>
                        </div>

                        <button
                          onClick={() => handleOpenReport(`Reply by ${reply.authorNickname}`)}
                          className="text-slate-500 hover:text-amber-400 text-[11px]"
                        >
                          Report
                        </button>
                      </div>
                      <div className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                        {reply.content}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                    No replies yet. Be the first to join the conversation!
                  </div>
                )}
              </div>

              {/* Reply Form */}
              {!selectedTopic.isLocked ? (
                <form onSubmit={handleSendReply} className="pt-4 space-y-2">
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder="Write your constructive reply..."
                      className="flex-1 bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={replySubmitting || !replyContent.trim()}
                    >
                      <Send className="w-3.5 h-3.5 mr-1" />
                      <span>{replySubmitting ? 'Posting...' : 'Reply'}</span>
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="p-3 bg-slate-900/40 border border-slate-800 rounded-lg text-xs text-slate-400 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-500" />
                  <span>This discussion is closed for further replies.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Search & Category Filter Bar */}
          <div className="p-4 rounded-xl border border-slate-800 bg-[#0c1222] space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.forum.searchPlaceholder}
                className="w-full bg-[#101729] border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex flex-wrap gap-1 p-1 bg-[#101729] rounded-lg border border-slate-800/80">
              {[
                { id: 'all', label: 'All Topics' },
                { id: 'general', label: 'General' },
                { id: 'banglish', label: 'Banglish & Etiquette' },
                { id: 'tech', label: 'Tech & Developers' },
                { id: 'regional', label: 'Regional Meetups' },
                { id: 'international', label: 'International' },
                { id: 'safety', label: 'Safety Suggestions' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setCategoryFilter(cat.id);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    categoryFilter === cat.id
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Topics List */}
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-500">
              Loading discussions...
            </div>
          ) : topics.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No topics found matching your criteria. Be the first to start a discussion!
            </div>
          ) : (
            <div className="space-y-3">
              {topics.map((topic) => (
                <div
                  key={topic.id}
                  onClick={() => loadTopicDetails(topic.id)}
                  className="p-5 rounded-xl border border-slate-800 bg-[#0c1220] hover:border-slate-700/80 hover:bg-[#0f1628] transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      {topic.pinned && (
                        <span className="flex items-center gap-1 text-amber-400 font-semibold font-mono text-[10px] bg-amber-950/40 border border-amber-800/50 px-1.5 py-0.5 rounded">
                          <Pin className="w-3 h-3" />
                          <span>Pinned</span>
                        </span>
                      )}
                      <span className="text-cyan-400 font-medium">
                        {topic.categoryLabel[language]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-400 font-medium">{topic.author}</span>
                      {topic.authorRole === 'admin' && (
                        <span className="text-[9px] bg-violet-950 text-violet-300 border border-violet-800 px-1 py-0.5 rounded font-mono">
                          Staff
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-white hover:text-cyan-300 transition-colors truncate">
                      {topic.title}
                    </h3>

                    <p className="text-xs text-slate-400 line-clamp-1">
                      {topic.content}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-slate-400 font-mono shrink-0">
                    <div className="flex items-center gap-1" title="Replies">
                      <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
                      <span>{topic.repliesCount}</span>
                    </div>
                    <div className="flex items-center gap-1" title="Views">
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                      <span>{topic.viewsCount}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {toRelativeTime(topic.lastActivity, language)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
              <div>
                Showing page {page} of {totalPages} ({totalTopics} discussions)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => loadTopics(page - 1)}
                >
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => loadTopics(page + 1)}
                >
                  Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* New Topic Modal */}
      {newModalOpen && (
        <Modal
          isOpen={newModalOpen}
          onClose={() => setNewModalOpen(false)}
          title="Start a Community Discussion"
          subtitle="Share insights, local meetups, or ask questions respectfully"
        >
          <form onSubmit={handleCreateTopic} className="space-y-4">
            {errorMessage && (
              <div className="p-2.5 bg-rose-950/40 border border-rose-800 text-rose-300 text-xs rounded-lg">
                {errorMessage}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Discussion Title
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="What would you like to discuss?"
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Category
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as any)}
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="general">General Community</option>
                <option value="banglish">Banglish & Language Nuances</option>
                <option value="tech">Tech & Developers</option>
                <option value="regional">Regional Meetups</option>
                <option value="international">International Exchange</option>
                <option value="safety">Safety Suggestions</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Content & Context
              </label>
              <textarea
                rows={5}
                required
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Write your discussion content here..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setNewModalOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={createSubmitting}>
                {createSubmitting ? 'Publishing...' : 'Publish Discussion'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Report Modal */}
      {reportModalOpen && (
        <Modal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          title="Submit Content Report"
          subtitle={`Report: ${reportTarget}`}
        >
          {reportSuccess ? (
            <div className="p-4 text-center text-xs text-emerald-400 font-semibold">
              Thank you. Your report has been submitted to moderators for review.
            </div>
          ) : (
            <form onSubmit={handleSubmitReport} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Reason for Reporting
                </label>
                <textarea
                  rows={3}
                  required
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder="Describe why this content violates community safety guidelines..."
                  className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setReportModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit">
                  Submit Report
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
      </div>
    </div>
  );
};
