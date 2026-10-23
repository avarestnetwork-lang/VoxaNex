import React, { useEffect } from 'react';

export interface SEOHeadProps {
  title?: string;
  description?: string;
  canonicalPath?: string;
  ogType?: 'website' | 'article';
  ogImage?: string;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
  noindex?: boolean;
}

const DEFAULT_TITLE = 'ChatLustora – Bangla & Desi Adult Chat, Dating and Private Messaging';
const DEFAULT_DESC =
  'ChatLustora is an online chat community where you can meet new people, join chat rooms, and discover conversations with people around the world.';
const BASE_DOMAIN = 'https://chatlustora.com';
const DEFAULT_OG_IMAGE = 'https://chatlustora.com/logo.png';

export const SEOHead: React.FC<SEOHeadProps> = ({
  title,
  description,
  canonicalPath = '',
  ogType = 'website',
  ogImage = DEFAULT_OG_IMAGE,
  jsonLd,
  noindex = false,
}) => {
  const fullTitle = title ? (title.includes('ChatLustora') ? title : `${title} | ChatLustora`) : DEFAULT_TITLE;
  const metaDesc = description || DEFAULT_DESC;

  // Sanitize canonical URL: ensure leading slash, remove query params, avoid double slashes, retain single '/' for root
  let cleanPath = canonicalPath.split('?')[0].split('#')[0];
  if (!cleanPath.startsWith('/')) {
    cleanPath = `/${cleanPath}`;
  }
  if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
    cleanPath = cleanPath.slice(0, -1);
  }
  const canonicalUrl = `${BASE_DOMAIN}${cleanPath}`;

  useEffect(() => {
    // 1. Update Title
    document.title = fullTitle;

    // 2. Push SPA virtual pageview to Google Tag Manager dataLayer
    if (typeof window !== 'undefined') {
      const win = window as any;
      win.dataLayer = win.dataLayer || [];
      win.dataLayer.push({
        event: 'virtual_pageview',
        page_location: canonicalUrl,
        page_path: cleanPath,
        page_title: fullTitle,
      });
    }

    // 3. Helper to set or create meta tag
    const setMetaTag = (attribute: 'name' | 'property', attrValue: string, content: string) => {
      let element = document.querySelector(`meta[${attribute}="${attrValue}"]`) as HTMLMetaElement | null;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, attrValue);
        document.head.appendChild(element);
      }
      element.content = content;
    };

    // Standard Meta
    setMetaTag('name', 'description', metaDesc);
    setMetaTag('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');

    // OpenGraph
    setMetaTag('property', 'og:title', fullTitle);
    setMetaTag('property', 'og:description', metaDesc);
    setMetaTag('property', 'og:type', ogType);
    setMetaTag('property', 'og:url', canonicalUrl);
    setMetaTag('property', 'og:site_name', 'ChatLustora');
    setMetaTag('property', 'og:image', ogImage);

    // Twitter Card
    setMetaTag('name', 'twitter:card', 'summary_large_image');
    setMetaTag('name', 'twitter:title', fullTitle);
    setMetaTag('name', 'twitter:description', metaDesc);
    setMetaTag('name', 'twitter:image', ogImage);

    // Canonical Link
    let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonicalUrl;

    // JSON-LD Structured Data
    const scriptId = 'chatlustora-jsonld-schema';
    let scriptTag = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (jsonLd) {
      if (!scriptTag) {
        scriptTag = document.createElement('script');
        scriptTag.id = scriptId;
        scriptTag.type = 'application/ld+json';
        document.head.appendChild(scriptTag);
      }
      scriptTag.textContent = JSON.stringify(jsonLd);
    } else if (scriptTag) {
      scriptTag.remove();
    }
  }, [fullTitle, metaDesc, canonicalUrl, ogType, ogImage, jsonLd, noindex]);

  return null;
};
