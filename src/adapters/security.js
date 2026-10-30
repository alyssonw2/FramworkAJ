/**
 * FLASH — security headers.
 *
 * FLASH ships a strict-by-default CSP because the browser runtime never needs
 * `eval`, inline scripts or inline event handlers. Adjust `csp` when integrating
 * third-party scripts, and keep `script-src` free of `unsafe-inline`.
 */

const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

/**
 * @param {{
 *   csp?: string|false|null,
 *   frameOptions?: string|false,
 *   hsts?: false|{ maxAge?: number, includeSubDomains?: boolean, preload?: boolean },
 *   referrerPolicy?: string|false,
 *   permissionsPolicy?: string|false,
 *   crossOriginOpenerPolicy?: string|false
 * }} [options]
 */
export function securityHeaders(options = {}) {
  const csp = options.csp === undefined ? DEFAULT_CSP : options.csp;
  const frameOptions = options.frameOptions === undefined ? 'DENY' : options.frameOptions;
  const hsts = options.hsts === undefined ? false : options.hsts;
  const referrerPolicy = options.referrerPolicy === undefined ? 'strict-origin-when-cross-origin' : options.referrerPolicy;
  const permissionsPolicy = options.permissionsPolicy === undefined ? 'camera=(), microphone=(), geolocation=()' : options.permissionsPolicy;
  const coep = options.crossOriginOpenerPolicy === undefined ? 'same-origin' : options.crossOriginOpenerPolicy;

  return async (ctx) => {
    ctx.defer((response) => {
      if (csp) response.headers['Content-Security-Policy'] = csp;
      if (frameOptions) response.headers['X-Frame-Options'] = frameOptions;
      if (hsts) {
        const parts = [`max-age=${hsts.maxAge ?? 15552000}`];
        if (hsts.includeSubDomains !== false) parts.push('includeSubDomains');
        if (hsts.preload) parts.push('preload');
        response.headers['Strict-Transport-Security'] = parts.join('; ');
      }
      if (referrerPolicy) response.headers['Referrer-Policy'] = referrerPolicy;
      if (permissionsPolicy) response.headers['Permissions-Policy'] = permissionsPolicy;
      if (coep) response.headers['Cross-Origin-Opener-Policy'] = coep;
      return undefined;
    });
    return undefined;
  };
}

export { DEFAULT_CSP };
