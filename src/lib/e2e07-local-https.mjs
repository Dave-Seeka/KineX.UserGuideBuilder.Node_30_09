import https from 'node:https';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * An explicit curl -k equivalent for an HTTPS API listening on loopback only.
 * Node's built-in fetch does not honor the https.Agent option. This small
 * fetch-compatible adapter is used for E2E-07 only, never for browser traffic.
 */
export function createLocalInsecureHttpsFetch(baseUrl, requestImpl = https.request) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' || !['localhost', '127.0.0.1'].includes(origin.hostname)
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('-k/--insecure-local-tls is permitted only for an HTTPS localhost or 127.0.0.1 API origin.');
  }

  return async (input, options = {}) => {
    const url = new URL(input);
    if (url.origin !== origin.origin) {
      throw new Error('Insecure local TLS adapter refuses requests to another origin.');
    }
    if (options.redirect !== 'error' || !['GET', 'POST'].includes(options.method)) {
      throw new Error('Insecure local TLS adapter requires an explicit GET/POST and no redirects.');
    }
    return new Promise((resolve, reject) => {
      const req = requestImpl(url, {
        method: options.method,
        headers: options.headers,
        signal: options.signal,
        rejectUnauthorized: false
      }, response => {
        const chunks = [];
        let length = 0;
        response.on('data', chunk => {
          length += chunk.length;
          if (length > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('KineX API response exceeded the 4 MiB E2E-07 limit.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const status = response.statusCode ?? 0;
          resolve({ status, ok: status >= 200 && status < 300, text: async () => body });
        });
      });
      req.on('error', reject);
      if (options.body !== undefined) req.write(options.body);
      req.end();
    });
  };
}
