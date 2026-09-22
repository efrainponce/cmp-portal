// Sección "Carpeta de Drive" del tab Documentación (Efraín, 2026-09-15): la
// carpeta del item en Google Drive con sus subcarpetas (01. BASES … 12.
// FACTURA) y los archivos de cada una, leídos EN VIVO de Drive al abrir el
// tab (nunca en polling — son 2 llamadas a Google por lectura). Un Proyecto
// sin carpeta propia puede crearla desde aquí; "Sincronizar documentos" copia
// a Drive lo que el item ya tiene en Monday (cotizaciones, OC/contrato,
// actas, tallas, OC proveedor) a su subcarpeta.
import { useEffect, useState } from 'react';
import type { DriveCarpetaResponse, DriveSubcarpetaDTO, DriveArchivoDTO } from '../../../shared/dto';
import { getDriveCarpeta, crearDriveCarpetaProyecto, sincronizarDriveCarpeta, type DriveKind } from '../../lib/driveApi';

interface Props {
  kind: DriveKind;
  itemId: string;
  /** "Oportunidad" / "Proyecto" — se pinta junto al título. */
  etiqueta: string;
  /** false = el viewer solo lee (líder de zona): sin crear ni sincronizar. */
  editable: boolean;
}

export function DriveCarpeta({ kind, itemId, etiqueta, editable }: Props) {
  const [data, setData] = useState<DriveCarpetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<'crear' | 'sincronizar' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = () => {
    setLoading(true);
    setError(null);
    getDriveCarpeta(kind, itemId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo leer la carpeta de Drive.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setData(null);
    setAviso(null);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, itemId]);

  const crear = async () => {
    setAccion('crear');
    setError(null);
    try {
      await crearDriveCarpetaProyecto(itemId);
      setAviso('Carpeta creada.');
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la carpeta.');
    } finally {
      setAccion(null);
    }
  };

  const sincronizar = async () => {
    setAccion('sincronizar');
    setError(null);
    setAviso(null);
    try {
      const r = await sincronizarDriveCarpeta(kind, itemId);
      const partes = [
        r.subidos.length ? `${r.subidos.length} ${r.subidos.length === 1 ? 'archivo subido' : 'archivos subidos'}` : null,
        r.existentes ? `${r.existentes} ya ${r.existentes === 1 ? 'estaba' : 'estaban'}` : null,
      ].filter(Boolean);
      setAviso(partes.length ? partes.join(' · ') : 'No hay documentos que subir.');
      if (r.errores.length) setError(r.errores.join(' — '));
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron sincronizar los documentos.');
    } finally {
      setAccion(null);
    }
  };

  const total = data ? data.archivos.length + data.subcarpetas.reduce((n, s) => n + s.archivos.length, 0) : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)' }}>Carpeta de Drive · {etiqueta}</div>
        {data?.carpeta && (
          <a href={data.carpeta.url} target="_blank" rel="noreferrer" style={{ font: 'var(--text-label-strong)', color: 'var(--accent)', textDecoration: 'none' }}>
            Abrir en Drive ↗
          </a>
        )}
        {data?.carpeta && !loading && (
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>{total} {total === 1 ? 'archivo' : 'archivos'}</span>
        )}
      </div>

      {loading && !data && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', marginTop: 6 }}>Leyendo Drive…</div>}

      {data && !data.disponible && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 6 }}>Drive no está configurado en este ambiente.</div>
      )}

      {data?.disponible && !data.carpeta && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
            {kind === 'proyecto'
              ? 'Este proyecto aún no tiene carpeta propia en Drive.'
              : 'Esta oportunidad no tiene carpeta de Drive (se crea sola al darla de alta en Monday).'}
          </span>
          {kind === 'proyecto' && data.puedeCrear && editable && (
            <BotonChico onClick={accion ? undefined : crear}>{accion === 'crear' ? 'Creando…' : 'Crear carpeta de Drive'}</BotonChico>
          )}
        </div>
      )}

      {data?.carpeta && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <BotonChico onClick={loading || accion ? undefined : cargar}>{loading ? 'Actualizando…' : 'Actualizar'}</BotonChico>
            {editable && (
              <BotonChico onClick={accion || loading ? undefined : sincronizar} title="Copia a Drive los documentos que este registro ya tiene en Monday">
                {accion === 'sincronizar' ? 'Sincronizando…' : 'Sincronizar documentos'}
              </BotonChico>
            )}
            {aviso && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)' }}>{aviso}</span>}
          </div>
          <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', background: '#fff' }}>
            {data.subcarpetas.map((s, i) => <SubcarpetaRow key={s.id} sub={s} primera={i === 0} />)}
            {data.archivos.length > 0 && (
              <div style={{ borderTop: data.subcarpetas.length ? '1px solid var(--border-subtle)' : 'none', padding: '8px 12px' }}>
                <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-tertiary)', marginBottom: 4 }}>En la carpeta</div>
                <ListaArchivos archivos={data.archivos} />
              </div>
            )}
            {data.subcarpetas.length === 0 && data.archivos.length === 0 && (
              <div style={{ padding: '10px 12px', font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>La carpeta está vacía.</div>
            )}
          </div>
        </>
      )}

      {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function SubcarpetaRow({ sub, primera }: { sub: DriveSubcarpetaDTO; primera: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const n = sub.archivos.length;
  return (
    <div style={{ borderTop: primera ? 'none' : '1px solid var(--border-subtle)' }}>
      <div
        onClick={() => setAbierta((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ width: 12, font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>{abierta ? '▾' : '▸'}</span>
        <span style={{ flex: 1, minWidth: 0, font: n ? 'var(--text-body-strong)' : 'var(--text-body)', color: n ? 'var(--ink)' : 'var(--ink-quiet)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub.nombre}
        </span>
        <span style={{ font: 'var(--text-caption)', color: n ? 'var(--ink-secondary)' : 'var(--ink-faint)', flex: 'none' }}>
          {n === 0 ? 'vacía' : `${n} ${n === 1 ? 'archivo' : 'archivos'}`}
        </span>
        <a
          href={sub.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Abrir esta subcarpeta en Drive"
          style={{ font: 'var(--text-label-strong)', color: 'var(--accent)', textDecoration: 'none', flex: 'none' }}
        >
          ↗
        </a>
      </div>
      {abierta && (
        <div style={{ padding: '0 12px 10px 34px' }}>
          {n === 0
            ? <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Sin archivos.</div>
            : <ListaArchivos archivos={sub.archivos} />}
        </div>
      )}
    </div>
  );
}

function ListaArchivos({ archivos }: { archivos: DriveArchivoDTO[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {archivos.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            style={{ flex: 1, minWidth: 0, font: 'var(--text-label-strong)', color: 'var(--accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {a.nombre}
          </a>
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', flex: 'none' }}>{fechaCorta(a.modificado)}</span>
        </div>
      ))}
    </div>
  );
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function BotonChico({ onClick, children, title }: { onClick?: () => void; children: React.ReactNode; title?: string }) {
  const disabled = !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg)', padding: '5px 10px',
        font: 'var(--text-label-strong)', color: disabled ? 'var(--ink-faint)' : 'var(--ink-secondary)', cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
