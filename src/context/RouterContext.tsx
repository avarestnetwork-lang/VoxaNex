import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type AppRoute =
  | '/'
  | '/age-gate'
  | '/guest-entry'
  | '/rooms'
  | '/chat'
  | '/messages'
  | '/random'
  | '/av-chat'
  | '/auth'
  | '/profile'
  | '/safety'
  | '/forum'
  | '/blog'
  | '/admin'
  | '/privacy'
  | '/terms'
  | '/about'
  | '/contact'
  | '/help'
  | '/faq'
  | '/sitemap'
  | '/chat/indian'
  | '/dating';

interface RouterContextType {
  currentRoute: AppRoute;
  params: Record<string, string>;
  navigate: (route: AppRoute | string, routeParams?: Record<string, string>) => void;
  goBack: () => void;
}

const RouterContext = createContext<RouterContextType | undefined>(undefined);

function parsePath(pathname: string): { route: AppRoute; params: Record<string, string> } {
  // Support both hash routing and HTML5 path
  let path = pathname;
  if (path.startsWith('#')) {
    path = path.slice(1);
  }
  if (!path || path === '') {
    path = '/';
  }

  // Handle /chat/:roomId
  if (path.startsWith('/chat/')) {
    if (path === '/chat/indian') {
      return { route: '/chat/indian', params: {} };
    }
    const roomId = path.replace('/chat/', '');
    return { route: '/chat', params: { roomId } };
  }

  // Handle /forum/:topicId
  if (path.startsWith('/forum/')) {
    const topicId = path.replace('/forum/', '');
    return { route: '/forum', params: { topicId } };
  }

  // Handle /blog/:articleId
  if (path.startsWith('/blog/')) {
    const articleId = path.replace('/blog/', '');
    return { route: '/blog', params: { articleId } };
  }

  const validRoutes: AppRoute[] = [
    '/',
    '/age-gate',
    '/guest-entry',
    '/rooms',
    '/chat',
    '/messages',
    '/random',
    '/av-chat',
    '/auth',
    '/profile',
    '/safety',
    '/forum',
    '/blog',
    '/admin',
    '/privacy',
    '/terms',
    '/about',
    '/contact',
    '/help',
    '/faq',
    '/sitemap',
  ];

  if (validRoutes.includes(path as AppRoute)) {
    return { route: path as AppRoute, params: {} };
  }

  return { route: '/', params: {} };
}

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [routeState, setRouteState] = useState<{ route: AppRoute; params: Record<string, string> }>(() => {
    // If window.location.hash exists, use that; otherwise use location.pathname
    const hash = window.location.hash ? window.location.hash.replace('#', '') : '';
    const initial = hash || window.location.pathname;
    return parsePath(initial);
  });

  const navigate = useCallback((to: AppRoute | string, newParams: Record<string, string> = {}) => {
    let cleanPath = to;
    if (newParams.roomId && to === '/chat') {
      cleanPath = `/chat/${newParams.roomId}`;
    }

    // Update history state
    window.history.pushState(newParams, '', `#${cleanPath}`);
    const parsed = parsePath(cleanPath);
    setRouteState({
      route: parsed.route,
      params: { ...parsed.params, ...newParams },
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const hash = window.location.hash ? window.location.hash.replace('#', '') : '';
      const current = hash || window.location.pathname;
      setRouteState(parsePath(current));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <RouterContext.Provider
      value={{
        currentRoute: routeState.route,
        params: routeState.params,
        navigate,
        goBack,
      }}
    >
      {children}
    </RouterContext.Provider>
  );
};

export const useRouter = (): RouterContextType => {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
};
