// worker/lib/googleAuth.ts — OAuth2 de cuenta de servicio de Google (Fase 5,
// plan "salir de Monday", 2026-08-13): firma un JWT RS256 con Web Crypto (no
// hay librería `googleapis` en Cloudflare Workers, ni ningún patrón de firma
// criptográfica previo en este repo) y lo intercambia por un access token.
// Único consumidor hoy: worker/lib/drive.ts (scope drive). Verificado en vivo
// contra la API real de Google antes de escribir esto (token exchange + GET de
// la carpeta padre de licitaciones — ver docs/cmp-tallas-endpoint-map.md fila 100).
import type { Env } from '../env';

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** PEM (PKCS8, "-----BEGIN PRIVATE KEY-----...") → CryptoKey RS256. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signJwt(env: Env, scope: string): Promise<string> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new GoogleAuthError('GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(claim)}`;
  const key = await importPrivateKey(env.GOOGLE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(signature)}`;
}

// Cache en memoria del isolate — evita firmar/intercambiar un JWT por cada
// llamada a Drive dentro de la misma invocación caliente. Un access token de
// Google dura 1h; se refresca 60s antes de expirar.
let cached: { token: string; expiresAt: number; scope: string } | null = null;

export async function getGoogleAccessToken(env: Env, scope = 'https://www.googleapis.com/auth/drive'): Promise<string> {
  const now = Date.now();
  if (cached && cached.scope === scope && cached.expiresAt > now) return cached.token;

  const jwt = await signJwt(env, scope);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json<{ access_token?: string; expires_in?: number; error?: string; error_description?: string }>();
  if (!res.ok || !json.access_token) {
    throw new GoogleAuthError(`Google token exchange failed: ${res.status} ${json.error ?? ''} ${json.error_description ?? ''}`.trim());
  }
  cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 - 60_000, scope };
  return json.access_token;
}
