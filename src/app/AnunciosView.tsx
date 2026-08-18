// Pantalla "Anuncios" — comunicados del portal (Efraín, 2026-08-17). Todos leen;
// solo admin publica/edita/archiva (el worker lo vuelve a checar, ver
// worker/routes/anuncios.ts — esto es la cara visible, no el candado).
//
// El "visto" se asienta cuando la tarjeta estuvo de verdad en pantalla (~1.2s con
// IntersectionObserver), no al abrir la vista: si hay 8 anuncios y el usuario ve
// dos, el badge del sidebar debe seguir marcando los otros seis.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnuncioDTO, AnuncioSeveridad } from '../lib/anunciosApi';
import { useAnuncios, crearAnuncio, editarAnuncio, archivarAnuncio, borrarAnuncio } from '../lib/anunciosApi';
import { getZonas, type ZonaDTO } from '../lib/apiClient';
import type { Role } from '../../shared/types';
import { useMe } from '../lib/useMe';
import { useIsMobile } from '../lib/useIsMobile';
import { Button } from '../components/core/Button';
import { ConfirmButton } from '../components/core/ConfirmButton';
import { Modal } from '../components/core/Modal';

const ROLE_LABELS: Record<Role, string> = {
  vendedor: 'Ventas', compras: 'Compras', almacen: 'Almacén', admin: 'Admin',
};
const ROLE_ORDER: Role[] = ['vendedor', 'compras', 'almacen', 'admin'];

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const mismoAno = d.getFullYear() === hoy.getFullYear();
  return d.toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', ...(mismoAno ? {} : { year: 'numeric' }),
  }) + ' · ' + d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
}

function audienciaTexto(a: AnuncioDTO, zonas: ZonaDTO[]): string {
  const partes: string[] = [];
  partes.push(a.roles.length === 0 ? 'Todo el equipo' : a.roles.map((r) => ROLE_LABELS[r]).join(', '));
  if (a.zonaIds.length > 0) {
    const nombres = a.zonaIds.map((id) => zonas.find((z) => z.id === id)?.nombre ?? `Zona ${id}`);
    partes.push(`zona ${nombres.join(', ')}`);
  }
  return partes.join(' · ');
}

function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      font: 'var(--text-caption)', color: color ?? 'var(--ink-tertiary)',
      // color-mix y no `color + '1a'`: los colores llegan como var(--token), y
      // concatenarles el alfa en hex produce "var(--x)1a", que el navegador tira.
      background: color ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--bg-sunken)',
      border: color ? `1px solid color-mix(in srgb, ${color} 35%, transparent)` : '1px solid transparent',
      borderRadius: 'var(--radius-full)', padding: '3px 9px', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function AnuncioCard({
  anuncio, esAdmin, zonas, onVisto, onEditar, onCambio,
}: {
  anuncio: AnuncioDTO;
  esAdmin: boolean;
  zonas: ZonaDTO[];
  onVisto: (id: string) => void;
  onEditar: (a: AnuncioDTO) => void;
  onCambio: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const importante = anuncio.severidad === 'importante';

  // Visto tras 1.2s visible. Solo para los no vistos: el observer ni se arma si
  // ya está leído (la mayoría de las tarjetas tras la primera pasada).
  useEffect(() => {
    if (anuncio.visto || anuncio.archivado) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer: number | undefined;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          if (timer === undefined) timer = window.setTimeout(() => onVisto(anuncio.id), 1200);
        } else {
          window.clearTimeout(timer);
          timer = undefined;
        }
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => { window.clearTimeout(timer); obs.disconnect(); };
  }, [anuncio.id, anuncio.visto, anuncio.archivado, onVisto]);

  return (
    <div
      ref={ref}
      style={{
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${importante ? 'var(--status-perdida)' : anuncio.visto ? 'var(--border)' : 'var(--accent)'}`,
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-raised)',
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
        opacity: anuncio.archivado ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', flex: 1, minWidth: 0 }}>
          {anuncio.titulo}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
          {importante && <Chip color="var(--status-perdida)">Importante</Chip>}
          {!anuncio.visto && !anuncio.archivado && <Chip color="var(--accent)">Nuevo</Chip>}
          {anuncio.archivado && <Chip>Archivado</Chip>}
        </div>
      </div>

      <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
        {anuncio.cuerpo}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <span style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          {anuncio.autorNombre} · {fechaCorta(anuncio.createdAt)}
        </span>
        {esAdmin && <Chip>Para: {audienciaTexto(anuncio, zonas)}</Chip>}
        {esAdmin && anuncio.waEnviados > 0 && <Chip>WhatsApp: {anuncio.waEnviados}</Chip>}
      </div>

      {esAdmin && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <Button variant="secondary" style={{ padding: '6px 12px', font: 'var(--text-caption)' }} onClick={() => onEditar(anuncio)}>
            Editar
          </Button>
          <Button
            variant="secondary"
            style={{ padding: '6px 12px', font: 'var(--text-caption)' }}
            onClick={async () => { await archivarAnuncio(anuncio.id, !anuncio.archivado); onCambio(); }}
          >
            {anuncio.archivado ? 'Restaurar' : 'Archivar'}
          </Button>
          <ConfirmButton
            label="Eliminar"
            confirmLabel="¿Eliminar?"
            variant="danger"
            style={{ padding: '6px 12px', font: 'var(--text-caption)' }}
            onConfirm={async () => { await borrarAnuncio(anuncio.id); onCambio(); }}
          />
        </div>
      )}
    </div>
  );
}

interface BorradorState {
  id: string | null;
  titulo: string;
  cuerpo: string;
  severidad: AnuncioSeveridad;
  roles: Role[];
  zonaIds: number[];
  notificarWa: boolean;
}

const BORRADOR_VACIO: BorradorState = {
  id: null, titulo: '', cuerpo: '', severidad: 'normal', roles: [], zonaIds: [], notificarWa: false,
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', font: 'var(--text-label)',
  color: 'var(--ink)', background: 'var(--bg)',
};

function Composer({
  borrador, zonas, onClose, onGuardado,
}: {
  borrador: BorradorState;
  zonas: ZonaDTO[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [draft, setDraft] = useState<BorradorState>(borrador);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const editando = draft.id !== null;

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const guardar = async () => {
    if (guardando || !draft.titulo.trim() || !draft.cuerpo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await editarAnuncio(draft.id!, {
          titulo: draft.titulo, cuerpo: draft.cuerpo, severidad: draft.severidad,
          roles: draft.roles, zonaIds: draft.zonaIds,
        });
      } else {
        await crearAnuncio({
          titulo: draft.titulo, cuerpo: draft.cuerpo, severidad: draft.severidad,
          roles: draft.roles, zonaIds: draft.zonaIds, notificarWa: draft.notificarWa,
        });
      }
      onGuardado();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo guardar');
      setGuardando(false);
    }
  };

  const listo = draft.titulo.trim().length > 0 && draft.cuerpo.trim().length > 0;

  return (
    <Modal
      title={editando ? 'Editar anuncio' : 'Nuevo anuncio'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant={listo && !guardando ? 'primary' : 'disabled'} onClick={guardar}>
            {guardando ? 'Guardando…' : editando ? 'Guardar' : 'Publicar'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label>Título</Label>
          <input
            value={draft.titulo}
            maxLength={120}
            placeholder="Ej. Cierre de mes: fecha límite de facturación"
            onChange={(e) => setDraft({ ...draft, titulo: e.target.value })}
            style={inputStyle}
          />
        </div>

        <div>
          <Label>Mensaje</Label>
          <textarea
            value={draft.cuerpo}
            maxLength={4000}
            rows={7}
            placeholder="Escribe el comunicado…"
            onChange={(e) => setDraft({ ...draft, cuerpo: e.target.value })}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        <div>
          <Label>Prioridad</Label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['normal', 'importante'] as AnuncioSeveridad[]).map((s) => (
              <Button
                key={s}
                variant={draft.severidad === s ? 'primary' : 'secondary'}
                style={{ padding: '6px 14px', font: 'var(--text-caption)' }}
                onClick={() => setDraft({ ...draft, severidad: s })}
              >
                {s === 'normal' ? 'Normal' : 'Importante'}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label>Para qué roles</Label>
          <Hint>Sin nada marcado, el anuncio es para todo el equipo.</Hint>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {ROLE_ORDER.map((r) => (
              <Button
                key={r}
                variant={draft.roles.includes(r) ? 'primary' : 'secondary'}
                style={{ padding: '6px 12px', font: 'var(--text-caption)' }}
                onClick={() => setDraft({ ...draft, roles: toggle(draft.roles, r) })}
              >
                {ROLE_LABELS[r]}
              </Button>
            ))}
          </div>
        </div>

        {zonas.length > 0 && (
          <div>
            <Label>Para qué zonas</Label>
            <Hint>Sin nada marcado, aplica a todas las zonas. Cuenta el líder y sus miembros.</Hint>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {zonas.map((z) => (
                <Button
                  key={z.id}
                  variant={draft.zonaIds.includes(z.id) ? 'primary' : 'secondary'}
                  style={{ padding: '6px 12px', font: 'var(--text-caption)' }}
                  onClick={() => setDraft({ ...draft, zonaIds: toggle(draft.zonaIds, z.id) })}
                >
                  {z.nombre}
                </Button>
              ))}
            </div>
          </div>
        )}

        {!editando && (
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.notificarWa}
              onChange={(e) => setDraft({ ...draft, notificarWa: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>Avisar también por WhatsApp</span>
              <Hint>Le llega solo a quien tenga teléfono registrado en el portal. Úsalo para lo que de verdad no puede esperar.</Hint>
            </span>
          </label>
        )}

        {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{error}</div>}
      </div>
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', marginBottom: 6 }}>{children}</div>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 2 }}>{children}</div>;
}

export function AnunciosView() {
  const me = useMe();
  const isMobile = useIsMobile();
  const { anuncios, cargando, refetch, marcarVisto } = useAnuncios();
  const [zonas, setZonas] = useState<ZonaDTO[]>([]);
  const [borrador, setBorrador] = useState<BorradorState | null>(null);
  const esAdmin = me?.role === 'admin';
  const pad = isMobile ? 16 : 28;

  // Las zonas solo las expone /admin/zonas — el composer y las etiquetas de
  // audiencia son admin-only, así que no se piden para nadie más.
  useEffect(() => {
    if (!esAdmin) return;
    getZonas().then(setZonas).catch(() => {});
  }, [esAdmin]);

  const { vigentes, archivados } = useMemo(() => ({
    vigentes: anuncios.filter((a) => !a.archivado),
    archivados: anuncios.filter((a) => a.archivado),
  }), [anuncios]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: pad }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '800 22px \'Inter\', sans-serif', color: 'var(--ink)' }}>Anuncios</div>
            <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', marginTop: 4 }}>
              {cargando
                ? 'Cargando…'
                : vigentes.length === 0
                  ? 'No hay anuncios por ahora.'
                  : 'Comunicados del equipo.'}
            </div>
          </div>
          {esAdmin && (
            <Button onClick={() => setBorrador(BORRADOR_VACIO)} style={{ flex: 'none' }}>
              + Nuevo anuncio
            </Button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {vigentes.map((a) => (
            <AnuncioCard
              key={a.id}
              anuncio={a}
              esAdmin={!!esAdmin}
              zonas={zonas}
              onVisto={marcarVisto}
              onEditar={(x) => setBorrador({
                id: x.id, titulo: x.titulo, cuerpo: x.cuerpo, severidad: x.severidad,
                roles: x.roles, zonaIds: x.zonaIds, notificarWa: false,
              })}
              onCambio={refetch}
            />
          ))}
        </div>

        {esAdmin && archivados.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-quiet)' }}>Archivados</div>
            {archivados.map((a) => (
              <AnuncioCard
                key={a.id}
                anuncio={a}
                esAdmin
                zonas={zonas}
                onVisto={marcarVisto}
                onEditar={(x) => setBorrador({
                  id: x.id, titulo: x.titulo, cuerpo: x.cuerpo, severidad: x.severidad,
                  roles: x.roles, zonaIds: x.zonaIds, notificarWa: false,
                })}
                onCambio={refetch}
              />
            ))}
          </div>
        )}
      </div>

      {borrador && (
        <Composer
          borrador={borrador}
          zonas={zonas}
          onClose={() => setBorrador(null)}
          onGuardado={refetch}
        />
      )}
    </div>
  );
}
