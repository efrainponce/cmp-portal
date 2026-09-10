// Aviso de "división con la parte nueva borrada" (OPP-0970, 2026-09-10): Pam
// dividió 4 líneas en caballero/dama desde el Proyecto; las 4 líneas nuevas
// se borraron directo en Monday ese mismo día y la cotización se quedó con las
// origen recortadas (650) y sin las de dama (250) — sin ningún aviso, porque la
// origen seguía diciendo "Dividida". Se detectó dos semanas después, cuando el
// archivo de tallas no cuadró con la cotización.
//
// El worker solo marca (`lineaBorrada`, worker/lib/lineaAjustes.ts
// marcarDivisionesBorradas) las divisiones cuya línea nueva desapareció SIN
// pasar por el portal y cuya línea origen sigue viva: un borrado desde el
// portal es intencional y ya queda respaldado. Aquí se ofrece "Restaurar
// línea" (la vuelve a crear tal como se dividió, sin restar nada más de la
// origen) o "Ya no aplica" (el borrado en Monday también fue a propósito: el
// aviso se descarta para siempre). Compartido por CotizacionTab (Oportunidad)
// y CotizacionVirtualTab (Proyecto).
import { useState } from 'react';
import type { AjusteDTO } from '../../../../lib/api';
import { Button } from '../../../../components/core/Button';

type Accion = (subversion: number) => Promise<string | undefined>;

export function DivisionesBorradas({ ajustes, canRestaurar, onRestaurar, onDescartar }: {
  ajustes: AjusteDTO[];
  canRestaurar: boolean;
  /** Regresan el mensaje de error si no se pudo; undefined si quedó hecho. */
  onRestaurar: Accion;
  onDescartar: Accion;
}) {
  const borradas = ajustes.filter((a) => a.lineaBorrada);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (borradas.length === 0) return null;

  const correr = async (accion: Accion, subversion: number) => {
    setBusy(subversion);
    setError(null);
    try {
      const err = await accion(subversion);
      if (err) setError(err);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la acción.');
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
          ? 'Una línea se dividió y la parte nueva se borró directo en Monday'
          : `${borradas.length} líneas se dividieron y la parte nueva se borró directo en Monday`}
      </div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>
        La línea origen ya quedó con la cantidad recortada, pero la línea nueva ya no existe,
        así que la cotización no cuadra con lo que se dividió. "Restaurar línea" la vuelve a
        crear tal como se dividió (mismo producto, color, cantidad y precio), sin restar nada
        más de la origen. Si el borrado fue a propósito, marca "Ya no aplica".
      </div>
      {borradas.map((a) => (
        <div
          key={a.subversion}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}
        >
          <span style={{ flex: 1, minWidth: 200 }}>
            <span style={{ color: 'var(--ink-tertiary)' }}>.{a.subversion} · </span>
            {a.resumen}
          </span>
          {canRestaurar && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant={busy != null ? 'disabled' : 'secondary'}
                onClick={busy != null ? undefined : () => correr(onDescartar, a.subversion)}
              >
                Ya no aplica
              </Button>
              <Button
                variant={busy != null ? 'disabled' : 'secondary'}
                onClick={busy != null ? undefined : () => correr(onRestaurar, a.subversion)}
              >
                {busy === a.subversion ? 'Un momento…' : 'Restaurar línea'}
              </Button>
            </div>
          )}
        </div>
      ))}
      {error && (
        <div style={{ color: 'var(--status-perdida)', font: 'var(--text-caption)', marginTop: 6 }}>{error}</div>
      )}
    </div>
  );
}
