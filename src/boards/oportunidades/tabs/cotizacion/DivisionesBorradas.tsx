// Aviso de "división con la parte nueva borrada" (OPP-0970, 2026-09-10): Pam
// dividió 4 líneas en caballero/dama desde el Proyecto; las 4 líneas nuevas
// se borraron directo en Monday ese mismo día y la cotización se quedó con las
// origen recortadas (650) y sin las de dama (250) — sin ningún aviso, porque la
// origen seguía diciendo "Dividida". Se detectó dos semanas después, cuando el
// archivo de tallas no cuadró con la cotización. El worker marca esos ajustes
// (`lineaBorrada`, worker/lib/lineaAjustes.ts marcarDivisionesBorradas) y aquí
// se ofrece "Restaurar línea", que la vuelve a crear tal como se dividió sin
// restar nada más de la origen. Compartido por CotizacionTab (Oportunidad) y
// CotizacionVirtualTab (Proyecto).
import { useState } from 'react';
import type { AjusteDTO } from '../../../../lib/api';
import { Button } from '../../../../components/core/Button';

export function DivisionesBorradas({ ajustes, canRestaurar, onRestaurar }: {
  ajustes: AjusteDTO[];
  canRestaurar: boolean;
  /** Regresa el mensaje de error si no se pudo; undefined si quedó restaurada. */
  onRestaurar: (subversion: number) => Promise<string | undefined>;
}) {
  const borradas = ajustes.filter((a) => a.lineaBorrada);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (borradas.length === 0) return null;

  const restaurar = async (subversion: number) => {
    setBusy(subversion);
    setError(null);
    try {
      const err = await onRestaurar(subversion);
      if (err) setError(err);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restaurar la línea.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{
      margin: '0 0 14px', padding: '10px 14px', border: '1px solid var(--status-perdida)',
      borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
      font: 'var(--text-label)', color: 'var(--ink-secondary)',
    }}>
      <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
        {borradas.length === 1
          ? 'Una línea se dividió y la parte nueva ya no existe'
          : `${borradas.length} líneas se dividieron y la parte nueva ya no existe`}
      </div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>
        La línea origen ya quedó con la cantidad recortada, pero la línea nueva se borró
        después — por eso la cotización no cuadra con el archivo de tallas. Restaurar la
        vuelve a crear tal como se dividió (mismo producto, color, cantidad y precio), sin
        restar nada más de la origen.
      </div>
      {borradas.map((a) => (
        <div
          key={a.subversion}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--ink-tertiary)' }}>.{a.subversion} · </span>
            {a.resumen}
            <span style={{ color: 'var(--ink-tertiary)' }}>
              {a.borradaPor
                ? ` — borrada desde el portal por ${a.borradaPor}${a.borradaEn ? ` el ${a.borradaEn.slice(0, 10)}` : ''}`
                : ' — borrada directo en Monday, no desde el portal'}
            </span>
          </span>
          {canRestaurar && (
            <Button
              variant={busy != null ? 'disabled' : 'secondary'}
              onClick={busy != null ? undefined : () => restaurar(a.subversion)}
            >
              {busy === a.subversion ? 'Restaurando…' : 'Restaurar línea'}
            </Button>
          )}
        </div>
      ))}
      {error && (
        <div style={{ color: 'var(--status-perdida)', font: 'var(--text-caption)', marginTop: 6 }}>{error}</div>
      )}
    </div>
  );
}
