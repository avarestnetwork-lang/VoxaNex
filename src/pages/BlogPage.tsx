import React, { useState, useEffect } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { BlogArticle, BlogComment, CommunityGuide } from '../types';
import { communityService } from '../services/communityService';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatDhakaDate } from '../utils/date';
import { SEOHead } from '../components/common/SEOHead';
import {
  BookOpen,
  Clock,
  ArrowRight,
  ArrowLeft,
  Shield,
  Sparkles,
  User,
  Tag,
  PlusCircle,
  MessageSquare,
  Send,
  Compass,
  Shuffle,
  ShieldAlert,
  ShieldCheck,
  Video,
  AlertTriangle,
  FileText,
  CheckCircle2,
  XCircle,
  Share2,
} from 'lucide-react';

export const BlogPage: React.FC = () => {
  const { navigate, params } = useRouter();
  const { language, t } = useLanguage();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'guides' | 'articles'>('guides');
  const [articles, setArticles] = useState<BlogArticle[]>([]);
  const [guides, setGuides] = useState<CommunityGuide[]>([]);
  const [activeArticle, setActiveArticle] = useState<BlogArticle | null>(null);
  const [activeGuide, setActiveGuide] = useState<CommunityGuide | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Comments state
  const [commentText, setCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  // Author publishing modal state
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [newTitleEn, setNewTitleEn] = useState('');
  const [newTitleBn, setNewTitleBn] = useState('');
  const [newSummaryEn, setNewSummaryEn] = useState('');
  const [newSummaryBn, setNewSummaryBn] = useState('');
  const [newContentEn, setNewContentEn] = useState('');
  const [newContentBn, setNewContentBn] = useState('');
  const [newCategory, setNewCategory] = useState('Safety & Conduct');
  const [newTags, setNewTags] = useState('Safety, Guide, Community');
  const [newStatus, setNewStatus] = useState<'draft' | 'published'>('published');
  const [publishError, setPublishError] = useState('');

  // Share notification
  const [copiedNotification, setCopiedNotification] = useState(false);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [fetchedArticles, fetchedGuidesRes] = await Promise.all([
        communityService.getArticles({ status: 'published' }),
        communityService.getGuides(),
      ]);
      setArticles(fetchedArticles);
      setGuides(fetchedGuidesRes.guides);
      setLoading(false);
    }
    loadData();
  }, []);

  // Check URL param
  useEffect(() => {
    if (params.articleId) {
      // Find either in articles or guides
      const matchArt = articles.find((a) => a.slug === params.articleId || a.id === params.articleId);
      if (matchArt) {
        setActiveArticle(matchArt);
        setActiveTab('articles');
      } else {
        const matchGuide = guides.find((g) => g.slug === params.articleId || g.id === params.articleId);
        if (matchGuide) {
          setActiveGuide(matchGuide);
          setActiveTab('guides');
        }
      }
    }
  }, [params.articleId, articles, guides]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitleEn.trim() || !newContentEn.trim()) return;

    setPublishError('');
    const tagsArray = newTags.split(',').map((t) => t.trim()).filter(Boolean);

    const articleToSave: BlogArticle = {
      id: `art_${Date.now()}`,
      slug: newTitleEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
      title: { en: newTitleEn, bn: newTitleBn || newTitleEn },
      summary: { en: newSummaryEn, bn: newSummaryBn || newSummaryEn },
      content: { en: newContentEn, bn: newContentBn || newContentEn },
      category: newCategory,
      tags: tagsArray,
      readTime: `${Math.max(1, Math.ceil(newContentEn.split(' ').length / 150))} min read`,
      publishedAt: new Date().toISOString().split('T')[0],
      author: user.nickname,
      authorRole: user.role === 'admin' ? 'admin' : 'editor',
      status: newStatus,
      comments: [],
    };

    const res = await communityService.publishArticle(articleToSave, user.role || 'admin');
    if (res.success) {
      setPublishModalOpen(false);
      setArticles([articleToSave, ...articles]);
      setActiveArticle(articleToSave);
      setActiveTab('articles');
    } else {
      setPublishError(res.error || 'Failed to publish article');
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeArticle || !commentText.trim()) return;

    setCommentSubmitting(true);
    const res = await communityService.addCommentToArticle(
      activeArticle.slug,
      user.nickname,
      user.avatar,
      commentText.trim()
    );

    setCommentSubmitting(false);
    if (res.success && res.comment) {
      setCommentText('');
      setActiveArticle((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          comments: [...(prev.comments || []), res.comment!],
        };
      });
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  const getGuideIcon = (name: string) => {
    switch (name) {
      case 'Compass':
        return Compass;
      case 'Shuffle':
        return Shuffle;
      case 'ShieldCheck':
        return ShieldCheck;
      case 'Video':
        return Video;
      case 'ShieldAlert':
        return ShieldAlert;
      case 'AlertTriangle':
        return AlertTriangle;
      default:
        return FileText;
    }
  };

  const blogSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'ChatLustora Community & Safety Blog',
    description: 'Community guidelines, online safety tips, chat room etiquette, and platform updates on ChatLustora.',
    publisher: {
      '@type': 'Organization',
      name: 'ChatLustora',
      url: 'https://chatlustora.com',
    },
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={
          activeArticle
            ? `${activeArticle.title[language]} | ChatLustora Blog`
            : activeGuide
            ? `${activeGuide.title[language]} | ChatLustora Safety Guide`
            : 'Community Knowledge & Safety Center | ChatLustora'
        }
        description={
          activeArticle
            ? activeArticle.summary[language]
            : activeGuide
            ? activeGuide.summary[language]
            : 'Explore safety guides, chat tips, and community guidelines for ChatLustora users.'
        }
        canonicalPath={
          activeArticle
            ? `/blog?articleId=${activeArticle.slug}`
            : activeGuide
            ? `/blog?articleId=${activeGuide.slug}`
            : '/blog'
        }
        jsonLd={blogSchema}
      />
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Page Title & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-500/20 mb-1">
              <BookOpen className="w-7 h-7 text-white" />
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-orange-600 dark:text-orange-400 tracking-wider uppercase">
              <span>Community Knowledge & Safety Center</span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{t.blog.title}</h1>
            <p className="text-base text-slate-600 dark:text-slate-400 max-w-2xl">{t.blog.subtitle}</p>
          </div>

        {/* Action button for admin / editors */}
        <div className="flex items-center gap-2">
          {user.role === 'admin' && (
            <Button size="sm" variant="secondary" onClick={() => setPublishModalOpen(true)}>
              <PlusCircle className="w-4 h-4 mr-1.5" />
              <span>Create Article</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Mode Toggle: Community Guides vs Blog Articles */}
      {!activeArticle && !activeGuide && (
        <div className="flex gap-2 p-1 bg-[#0c1222] rounded-xl border border-slate-800 w-fit">
          <button
            onClick={() => setActiveTab('guides')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'guides'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Editable Community Guides ({guides.length})
          </button>
          <button
            onClick={() => setActiveTab('articles')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'articles'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Editorial Blog & CMS ({articles.length})
          </button>
        </div>
      )}

      {/* GUIDE DETAIL VIEW */}
      {activeGuide ? (
        <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-6 sm:p-10 space-y-8">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setActiveGuide(null);
                navigate('/blog');
              }}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Knowledge Guides</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>{copiedNotification ? 'Link Copied!' : 'Share Guide'}</span>
            </button>
          </div>

          <div className="space-y-3 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-violet-400 font-semibold uppercase font-mono tracking-wider">
                {activeGuide.category}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">Updated: {activeGuide.lastUpdated}</span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              {activeGuide.title[language]}
            </h2>

            <p className="text-sm text-slate-300 leading-relaxed max-w-3xl">
              {activeGuide.summary[language]}
            </p>
          </div>

          {/* Guide Sections */}
          <div className="space-y-8">
            {activeGuide.sections.map((section, idx) => (
              <div key={idx} className="space-y-4">
                <h3 className="text-lg font-bold text-cyan-300 flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">0{idx + 1}.</span>
                  <span>{section.heading[language]}</span>
                </h3>

                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                  {section.body[language]}
                </p>

                {/* Do / Don't columns */}
                {(section.doList || section.dontList) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {section.doList && (
                      <div className="p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-xl space-y-2">
                        <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase font-mono">
                          <CheckCircle2 className="w-4 h-4" /> Recommended Practice
                        </div>
                        <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                          {section.doList[language].map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {section.dontList && (
                      <div className="p-4 bg-rose-950/20 border border-rose-800/40 rounded-xl space-y-2">
                        <div className="text-xs font-bold text-rose-400 flex items-center gap-1.5 uppercase font-mono">
                          <XCircle className="w-4 h-4" /> Strictly Avoid
                        </div>
                        <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                          {section.dontList[language].map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pt-6 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>VoxaNex Verified Community Safety Guide</span>
            <Button size="sm" variant="secondary" onClick={() => setActiveGuide(null)}>
              Back to Guide Index
            </Button>
          </div>
        </div>
      ) : activeArticle ? (
        /* ARTICLE DETAIL VIEW */
        <div className="border border-slate-800 bg-[#0d1322] rounded-2xl p-6 sm:p-10 space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setActiveArticle(null);
                navigate('/blog');
              }}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t.blog.backToList}</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>{copiedNotification ? 'Link Copied!' : 'Share Article'}</span>
            </button>
          </div>

          <div className="space-y-3 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
              <span className="text-violet-400 font-semibold">{activeArticle.category}</span>
              <span aria-hidden="true">·</span>
              <span>{activeArticle.readTime}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{formatDhakaDate(activeArticle.publishedAt, language)}</span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              {activeArticle.title[language]}
            </h2>

            <div className="flex items-center gap-4 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>By {activeArticle.author}</span>
              </div>
              {activeArticle.authorRole && (
                <span className="font-mono text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded uppercase">
                  {activeArticle.authorRole}
                </span>
              )}
            </div>

            {/* Tags */}
            {activeArticle.tags && activeArticle.tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {activeArticle.tags.map((tg) => (
                  <span
                    key={tg}
                    className="text-[11px] font-mono text-cyan-400/90 bg-cyan-950/30 border border-cyan-800/40 px-2 py-0.5 rounded"
                  >
                    #{tg}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="text-sm sm:text-base text-slate-200 leading-relaxed whitespace-pre-line space-y-4">
            {activeArticle.content[language]}
          </div>

          {/* Moderated Comments Section */}
          <div className="pt-8 border-t border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <span>Community Comments ({activeArticle.comments?.length || 0})</span>
            </h3>

            {/* Comment list */}
            <div className="space-y-3">
              {activeArticle.comments && activeArticle.comments.length > 0 ? (
                activeArticle.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="p-4 rounded-xl border border-slate-800/80 bg-[#090d18] space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span>{comment.authorAvatar}</span>
                        <span className="font-semibold text-slate-300">{comment.authorNickname}</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="text-slate-500 font-mono">
                          {formatDhakaDate(comment.createdAt, language)}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs sm:text-sm text-slate-200">{comment.content}</div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                  No comments yet. Share your thoughts below.
                </div>
              )}
            </div>

            {/* Add comment input */}
            <form onSubmit={handleAddComment} className="pt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Leave a respectful comment..."
                  className="flex-1 bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={commentSubmitting || !commentText.trim()}
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  <span>Post</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : activeTab === 'guides' ? (
        /* GUIDES LIST */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {guides.map((guide) => {
            const Icon = getGuideIcon(guide.icon);
            return (
              <div
                key={guide.id}
                onClick={() => setActiveGuide(guide)}
                className="p-6 rounded-xl border border-slate-800 bg-[#0c1220] hover:border-violet-600/50 hover:bg-[#0f1628] transition-all cursor-pointer flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-violet-950/60 border border-violet-800/40 flex items-center justify-center text-violet-300">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="font-mono text-[10px] text-slate-500 uppercase">
                      {guide.category}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white hover:text-cyan-300 transition-colors">
                    {guide.title[language]}
                  </h3>

                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {guide.summary[language]}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono">Updated {guide.lastUpdated}</span>
                  <span className="text-cyan-400 font-semibold flex items-center gap-1">
                    Read Guide <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* BLOG ARTICLES LIST */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {articles.map((article) => (
            <div
              key={article.id}
              onClick={() => setActiveArticle(article)}
              className="p-6 rounded-xl border border-slate-800 bg-[#0c1220] hover:border-slate-700 hover:bg-[#0f1628] transition-all flex flex-col justify-between cursor-pointer"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-cyan-400 font-semibold">{article.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{article.readTime}</span>
                </div>

                <h3 className="text-base font-bold text-white hover:text-cyan-300 transition-colors">
                  {article.title[language]}
                </h3>

                <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                  {article.summary[language]}
                </p>
              </div>

              <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-mono">{formatDhakaDate(article.publishedAt, language)}</span>
                <span className="text-cyan-400 font-medium flex items-center gap-1">
                  {t.blog.readMore} <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Admin Publish Article Modal */}
      {publishModalOpen && (
        <Modal
          isOpen={publishModalOpen}
          onClose={() => setPublishModalOpen(false)}
          title="Publish CMS Blog Article"
          subtitle="Authorized editorial publication"
        >
          <form onSubmit={handlePublish} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {publishError && (
              <div className="p-2.5 bg-rose-950/40 border border-rose-800 text-rose-300 text-xs rounded-lg">
                {publishError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                English Title
              </label>
              <input
                type="text"
                required
                value={newTitleEn}
                onChange={(e) => setNewTitleEn(e.target.value)}
                placeholder="Title in English..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                Bangla Title (Optional)
              </label>
              <input
                type="text"
                value={newTitleBn}
                onChange={(e) => setNewTitleBn(e.target.value)}
                placeholder="বাংলা শিরোনাম..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                  Publication Status
                </label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as any)}
                  className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                Tags (Comma separated)
              </label>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="Safety, WebRTC, Banglish..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                English Summary
              </label>
              <textarea
                rows={2}
                value={newSummaryEn}
                onChange={(e) => setNewSummaryEn(e.target.value)}
                placeholder="Brief summary for listings..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">
                English Content
              </label>
              <textarea
                rows={5}
                required
                value={newContentEn}
                onChange={(e) => setNewContentEn(e.target.value)}
                placeholder="Article content in English..."
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="secondary" type="button" onClick={() => setPublishModalOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit">
                Save & Publish
              </Button>
            </div>
          </form>
        </Modal>
      )}
      </div>
    </div>
  );
};
