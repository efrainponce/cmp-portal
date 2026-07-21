// Estado de guardado async reutilizable — encapsula el patrón repetido en los
// modales de edición inline (EditCliente/EditPersona/EditContacto):
//   setSaving(true); setError(null);
//   try { await patch(); onSaved(); onClose(); } catch(e) { setError(...); }
//   finally { setSaving(...) }
import { useCallback, useState } from 'react';

export interface SaveState<T> {
  /** `null` en reposo; el marcador pasado a `run` mientras corre (por defecto `true`). */
  saving: T | null;
  error: string | null;
  /** Corre `fn`, prendiendo `saving` durante el await y capturando el error en
   * `error` si truena. `marker` es opcional — úsalo cuando hay varias filas o
   * columnas guardando a la vez y hace falta saber cuál (p.ej. el id de la
   * columna, como en EditContactoModal). */
  run: (fn: () => Promise<void>, marker?: T) => Promise<void>;
  setError: (error: string | null) => void;
}

export function useSaveState<T = boolean>(): SaveState<T> {
  const [saving, setSaving] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>, marker?: T) => {
    setSaving((marker ?? true) as T);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(null);
    }
  }, []);

  return { saving, error, run, setError };
}
