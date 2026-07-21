// Señal global de "la sesión de Access se cayó y apiFetch ya agotó su único
// auto-retry por pestaña" — apiClient.ts la dispara; App.tsx la usa para tapar
// toda la UI con una pantalla de login explícita en vez de dejar que cada
// componente (UserChip, tabs sueltos) muestre "Invitado" por su cuenta.
import { useEffect, useState } from 'react';

let expired = false;
const listeners = new Set<() => void>();

export function markSessionExpired() {
  if (expired) return;
  expired = true;
  listeners.forEach((l) => l());
}

export function useSessionExpired(): boolean {
  const [value, setValue] = useState(expired);
  useEffect(() => {
    const listener = () => setValue(expired);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return value;
}
