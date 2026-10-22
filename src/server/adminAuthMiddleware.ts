import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AdminJwtPayload {
  role: 'admin' | 'moderator';
  username?: string;
  iat?: number;
  exp?: number;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    const value = parts.join('=').trim();
    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  });
  return cookies;
}

/**
 * Strict server-side Admin / Staff Authorization Middleware.
 * - Enforces cryptographically signed JWT in admin_token cookie or Authorization header.
 * - Rejects fallback JWT secrets ('fallback_secret', 'change_me') and missing process.env.JWT_SECRET.
 * - Protects state-changing requests against CSRF.
 * - Ignores untrusted x-user-role and body parameters.
 */
export function adminAuthMiddleware(requiredRole: 'admin' | 'moderator' = 'admin') {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'fallback_secret' || secret === 'change_me') {
      return res.status(500).json({
        success: false,
        error: 'Server authentication misconfigured. Admin JWT_SECRET is missing or set to an unsafe default.',
      });
    }

    const cookies = parseCookies(req.headers.cookie);
    const token =
      cookies['admin_token'] ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : undefined);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Admin authentication required. Missing admin_token cookie.',
      });
    }

    // CSRF Protection for state-changing requests authenticated via cookies
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && cookies['admin_token']) {
      const origin = req.headers.origin || req.headers.referer;
      const host = req.headers.host;
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return res.status(403).json({
              success: false,
              error: 'Forbidden: Cross-site request rejected (CSRF protection failed).',
            });
          }
        } catch {
          // Ignore header parsing errors for non-standard callers
        }
      }
    }

    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: 'chatlustora-auth',
        audience: 'chatlustora-admin',
      }) as AdminJwtPayload;

      if (!decoded || !decoded.role) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid token claims.',
        });
      }

      if (requiredRole === 'admin' && decoded.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Admin privileges required.',
        });
      }

      if (
        requiredRole === 'moderator' &&
        decoded.role !== 'admin' &&
        decoded.role !== 'moderator'
      ) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Staff privileges required.',
        });
      }

      // Attach verified admin claims onto request object
      (req as any).adminUser = decoded;
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Session expired or invalid admin token.',
      });
    }
  };
}
