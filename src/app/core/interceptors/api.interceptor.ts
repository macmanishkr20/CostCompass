import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Functional HTTP interceptor (Angular 19 pattern).
 * Adds x-correlation-id header for traceability on first-party requests.
 * Skips absolute cross-origin URLs (e.g. the GitHub API) so we don't trip
 * their CORS preflight with a non-allow-listed custom header.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const isAbsolute = /^https?:\/\//i.test(req.url);
  const isCrossOrigin = isAbsolute && !req.url.startsWith(location.origin);
  if (isCrossOrigin) return next(req);

  const cloned = req.clone({
    setHeaders: {
      'x-correlation-id': crypto.randomUUID(),
    },
  });
  return next(cloned);
};
