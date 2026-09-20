/**
 * Sveltia CMS OAuth 共享逻辑（从 sveltia-cms-auth Worker 移植）
 * 环境变量在 Cloudflare Pages 项目设置中配置：
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / ALLOWED_DOMAINS
 */

const supportedProviders = ['github'];

const providerScopes = {
  github: {
    default: 'repo,user',
    separator: ',',
    allowed: ['repo', 'public_repo', 'user', 'read:user', 'user:email'],
  },
};

const getScope = (provider, requested) => {
  const { default: fallback, separator, allowed } = providerScopes[provider];
  const scopes = (requested ?? '').split(/[\s,]+/).filter(Boolean);
  if (!scopes.length) return fallback;
  if (scopes.every((s) => allowed.includes(s))) return scopes.join(separator);
  return fallback;
};

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getDomainPatterns = (allowedDomains) =>
  (allowedDomains ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `^${escapeRegExp(s).replaceAll('\\*', '.+')}$`);

const serialize = (v) => JSON.stringify(v ?? null).replaceAll('<', '\\u003c');

export const outputHTML = ({ provider = 'unknown', token, error, errorCode, env = {} }) => {
  const state = error ? 'error' : 'success';
  const content = error ? { provider, error, errorCode } : { provider, token };

  return new Response(
    `<!doctype html><html><body><script>
      (() => {
        const trustedPatterns = ${serialize(getDomainPatterns(env.ALLOWED_DOMAINS))};
        const hasToken = ${serialize(!!token)};
        const isTrusted = (origin) => {
          try {
            const { hostname } = new URL(origin);
            return trustedPatterns.some((p) => new RegExp(p).test(hostname));
          } catch { return false; }
        };
        window.addEventListener('message', ({ data, origin }) => {
          if (data !== 'authorizing:${provider}') return;
          if (hasToken && trustedPatterns.length && !isTrusted(origin)) return;
          window.opener?.postMessage(
            'authorization:${provider}:${state}:${JSON.stringify(content)}',
            origin
          );
        });
        window.opener?.postMessage('authorizing:${provider}', '*');
      })();
    </script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Set-Cookie': `csrf-token=deleted; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure`,
      },
    }
  );
};

export const handleAuth = async (request, env) => {
  const { origin, searchParams } = new URL(request.url);
  const { provider, site_id: domain, scope: requestedScope } = Object.fromEntries(searchParams);

  if (!provider || !supportedProviders.includes(provider)) {
    return outputHTML({ env, error: 'Unsupported backend.', errorCode: 'UNSUPPORTED_BACKEND' });
  }

  const scope = getScope(provider, requestedScope);
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ALLOWED_DOMAINS } = env;
  const domainPatterns = getDomainPatterns(ALLOWED_DOMAINS);

  if (domainPatterns.length && !domainPatterns.some((p) => new RegExp(p).test(domain ?? ''))) {
    return outputHTML({ env, provider, error: 'Domain not allowed.', errorCode: 'UNSUPPORTED_DOMAIN' });
  }

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return outputHTML({ env, provider, error: 'OAuth not configured.', errorCode: 'MISCONFIGURED_CLIENT' });
  }

  const csrfToken = crypto.randomUUID().replaceAll('-', '');
  const params = new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope, state: csrfToken });

  return new Response('', {
    status: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params.toString()}`,
      'Set-Cookie': `csrf-token=github_${csrfToken}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`,
    },
  });
};

export const handleCallback = async (request, env) => {
  const { searchParams } = new URL(request.url);
  const { code, state } = Object.fromEntries(searchParams);

  const [, provider, csrfToken] =
    request.headers.get('Cookie')?.match(/\bcsrf-token=([a-z-]+?)_([0-9a-f]{32})\b/) ?? [];

  if (!provider || !supportedProviders.includes(provider)) {
    return outputHTML({ env: {}, error: 'Unsupported backend.', errorCode: 'UNSUPPORTED_BACKEND' });
  }
  if (!code || !state) {
    return outputHTML({ env: {}, provider, error: 'No code received.', errorCode: 'AUTH_CODE_REQUEST_FAILED' });
  }
  if (!csrfToken || state !== csrfToken) {
    return outputHTML({ env: {}, provider, error: 'CSRF check failed.', errorCode: 'CSRF_DETECTED' });
  }

  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return outputHTML({ env: {}, provider, error: 'OAuth not configured.', errorCode: 'MISCONFIGURED_CLIENT' });
  }

  let response;
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET }),
    });
  } catch {
    return outputHTML({ env: {}, provider, error: 'Token request failed.', errorCode: 'TOKEN_REQUEST_FAILED' });
  }

  let token = '', error = '';
  try {
    ({ access_token: token, error } = await response.json());
  } catch {
    return outputHTML({ env: {}, provider, error: 'Malformed response.', errorCode: 'MALFORMED_RESPONSE' });
  }

  return outputHTML({ env: {}, provider, token, error });
};
