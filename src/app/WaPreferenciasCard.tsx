// Ajustes → "WhatsApp: qué recibe cada número" (docs/plan-wa-cartera.md §7).
// El admin ve por persona lo mismo que ella controla desde su chat con
// "ajustes" (resumen matutino, propuesta de cierre, avisos, hora, sábados,
// pausa/parar) y puede prendérselo a alguien nuevo sin que escriba nada.
// Cada cambio queda en wa_preferencias_log con el correo del admin.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getWaPreferencias, patchWaPreferencia, enviarResumenWa } from '../lib/api';
import type { WaPreferenciasDTO } from '../../shared/dto';
import { Button } from '../components/core/Button';
import { StatusBadge } from '../components/core/Badges';
import { GroupCard } from '../components/layout/GroupCard';

const HORAS = [7, 8, 9, 10, 11, 12];

export function WaPreferenciasCard({ onToast }: { onToast: (kind: 'success' | 'error', message: string) => void }) {
  const [rows, setRows] = useState<WaPreferenciasDTO[] | null>(null);
  const [activa, setActiva] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // onToast cambia de identidad en cada render del padre; el fetch va una vez.
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  useEffect(() => {
    getWaPreferencias()
      .then((r) => { setRows(r.preferencias); setActiva(r.activa); })
      .catch(() => toastRef.current('error', 'No se pudieron cargar las preferencias de WhatsApp.'));
  }, []);

  async function cambiar(email: string, patch: Parameters<typeof patchWaPreferencia>[1]) {
    setBusy(email);
    try {
      await patchWaPreferencia(email, patch);
      setRows((prev) => (prev ?? []).map((r) => (r.email === email ? { ...r, ...patch } as WaPreferenciasDTO : r)));
    } catch {
      onToast('error', 'No se pudo guardar la preferencia.');
    } finally {
      setBusy(null);
    }
  }

  async function mandarAhora(email: string) {
    setBusy(email);
    try {
      const r = await enviarResumenWa(email);
      onToast(r.enviado ? 'success' : 'error', r.enviado ? `Resumen enviado a ${email}.` : `No se mandó: ${r.motivo ?? 'sin motivo'}`);
    } catch {
      onToast('error', 'No se pudo mandar el resumen.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <GroupCard label="WhatsApp: qué recibe cada número" color="var(--accent-blue)" tint="var(--status-seguimiento-tint)" count={rows?.length ?? '…'}>
      <div style={{ padding: '10px 18px', font: 'var(--text-label)', color: 'var(--ink-tertiary)', background: 'var(--bg-raised)', borderBottom: '1px solid var(--border-subtle)' }}>
        Cada persona controla esto desde su chat escribiendo <b>ajustes</b>, <b>pausa</b> o <b>parar</b>. Aquí se le puede prender a alguien nuevo.
        {!activa && <> El resumen matutino automático está <b>apagado</b> en el servidor (WA_CARTERA); "Mandar ahora" sí funciona.</>}
      </div>
      {!rows ? (
        <div style={{ padding: '20px 18px', font: 'var(--text-label)', color: 'var(--ink-quiet)', background: 'var(--bg-raised)' }}>Cargando…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Persona</th>
                <th style={th}>Teléfono</th>
                <th style={th}>Resumen</th>
                <th style={th}>Cierre</th>
                <th style={th}>Avisos</th>
                <th style={th}>Hora</th>
                <th style={th}>Sáb</th>
                <th style={th}>Estado</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sinTel = !r.phone;
                const dis = busy === r.email || sinTel;
                const toggle = (campo: 'resumen' | 'cierre' | 'avisos' | 'sabado') => (
                  <input type="checkbox" checked={r[campo]} disabled={dis} onChange={(e) => cambiar(r.email, { [campo]: e.target.checked })} />
                );
                return (
                  <tr key={r.email} style={{ borderTop: '1px solid var(--border-subtle)', opacity: sinTel ? 0.55 : 1 }}>
                    <td style={td}>{r.nombre || r.email}<div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)' }}>{r.email}</div></td>
                    <td style={td}>{r.phone ?? <span style={{ color: 'var(--ink-quiet)' }}>sin teléfono</span>}</td>
                    <td style={td}>{toggle('resumen')}</td>
                    <td style={td}>{toggle('cierre')}</td>
                    <td style={td}>{toggle('avisos')}</td>
                    <td style={td}>
                      <select value={r.hora} disabled={dis} onChange={(e) => cambiar(r.email, { hora: Number(e.target.value) })} style={{ font: 'var(--text-label)' }}>
                        {HORAS.map((h) => <option key={h} value={h}>{h}:00</option>)}
                      </select>
                    </td>
                    <td style={td}>{toggle('sabado')}</td>
                    <td style={td}>
                      {r.todoApagado ? (
                        <StatusBadge label="Parado" color="var(--status-perdida)" tint="var(--status-perdida-tint)" />
                      ) : r.pausaHasta && new Date(r.pausaHasta) > new Date() ? (
                        <StatusBadge label={`Pausa hasta ${r.pausaHasta.slice(0, 10)}`} color="var(--ink-secondary)" tint="var(--bg-sunken)" />
                      ) : (
                        <StatusBadge label="Activo" color="var(--accent-blue)" tint="var(--status-seguimiento-tint)" />
                      )}
                      {(r.todoApagado || r.pausaHasta) && (
                        <Button variant="secondary" onClick={() => { void cambiar(r.email, { todoApagado: false }); void cambiar(r.email, { pausaHasta: null }); }} style={{ padding: '2px 8px', marginLeft: 6 }}>
                          Reanudar
                        </Button>
                      )}
                    </td>
                    <td style={td}>
                      <Button variant={dis ? 'disabled' : 'secondary'} onClick={() => mandarAhora(r.email)} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                        Mandar resumen ahora
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </GroupCard>
  );
}

const th: CSSProperties = {
  textAlign: 'left', padding: '9px 14px', font: 'var(--text-micro)',
  color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: 'var(--bg-raised)',
};
const td: CSSProperties = {
  textAlign: 'left', padding: '8px 14px', font: 'var(--text-label)',
  color: 'var(--ink-secondary)', background: 'var(--bg-raised)', verticalAlign: 'middle',
};
