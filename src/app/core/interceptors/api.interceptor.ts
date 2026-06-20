import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Functional HTTP interceptor (Angular 19 pattern).
 * Adds x-correlation-id header for traceability.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const cloned = req.clone({
    setHeaders: {
      'x-correlation-id': crypto.randomUUID(),
    },
  });
  return next(cloned);
};
