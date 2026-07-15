// worker/mw/access.ts — verifies caller identity into c.get('email').
// dev: X-Dev-Email header or env.DEV_EMAIL. prod: Cf-Access-Jwt-Assertion (RS256).
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

declare module 'hono' {
  interface ContextVariableMap {
    email: string;
  }
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToJson<T>(b64url: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(b64url))) as T;
}

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('jwks fetch failed');
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache.set(teamDomain, { keys: body.keys, fetchedAt: now });
  return body.keys;
}

async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<string> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = b64urlToJson<{ kid: string }>(headerB64);
  const payload = b64urlToJson<{ email?: string; aud?: string[] | string; exp?: number; iss?: string }>(payloadB64);

  const jwk = (await getJwks(teamDomain)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown kid');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) throw new Error('bad signature');

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSec) throw new Error('expired');
  const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
  if (!audOk) throw new Error('bad aud');
  if (!payload.iss || !payload.iss.includes(teamDomain)) throw new Error('bad iss');
  if (!payload.email) throw new Error('no email claim');
  return payload.email;
}

export const access: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.ENVIRONMENT !== 'prod') {
    const email = c.req.header('X-Dev-Email') || c.env.DEV_EMAIL;
    if (!email) return c.json({ error: 'no dev email configured' }, 401);
    c.set('email', email);
    return next();
  }

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token || !c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  try {
    const email = await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);
    c.set('email', email);
    return next();
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};
