// Admin "ver como" — the target email rides in localStorage so it survives a
// reload, and apiClient.ts attaches it as X-Impersonate-Email on every request.
// The worker is the actual gate (only accepts the header from a real admin
// identity), so this module is just UI-side bookkeeping.
import { invalidateMeCache } from './useMe';

const KEY = 'cmp:impersonateEmail';

export function getImpersonateTarget(): string | null {
  return localStorage.getItem(KEY);
}

// "Ver como" is only triggered from Configuración (admin-only route) — land on
// a board every role can see, since the target identity may not have access
// to wherever the admin happened to be.
export function startImpersonation(email: string) {
  localStorage.setItem(KEY, email);
  invalidateMeCache();
  window.location.href = '/oportunidades';
}

export function stopImpersonation() {
  localStorage.removeItem(KEY);
  invalidateMeCache();
  window.location.href = '/oportunidades';
}
