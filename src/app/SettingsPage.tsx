// Admin-only Configuración page: view/edit the portal's identity roster and
// import users from the Monday.com directory. Both endpoints already 403 for
// non-admin viewers server-side — see src/lib/apiClient.ts — this page is
// only reachable via Sidebar's admin-gated nav entry.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  getIdentities, putIdentity, getMondayUsers, getBoardAccess, putBoardAccess,
  getZonas, createZona, putZona, deleteZona,
  type IdentityDTO, type MondayUserDTO, type BoardAccessDTO, type ZonaDTO,
} from '../lib/api';
import { Button } from '../components/core/Button';
import { SearchInput } from '../components/forms/SearchInput';
import { Select } from '../components/forms/Select';
import { StatusBadge } from '../components/core/Badges';
import { GroupCard } from '../components/layout/GroupCard';
import { textIncludes } from '../lib/textMatch';
import { startImpersonation } from '../lib/impersonation';
import { useMe, refreshMe } from '../lib/useMe';
import { BOARD_LABELS } from './Sidebar';
import { BOARD_KEYS, TEAM_ROLES } from '../../shared/boardAccess';

type Role = IdentityDTO['role'];

const ROLE_LABELS: Record<Role, string> = {
  vendedor: 'Ventas', compras: 'Compras', admin: 'Admin', almacen: 'Almacén',
};
const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

// El equipo de Monday no es un rol del portal 1:1 (trae cosas como "Sureste" o
// "Administracion"), así que solo lo usamos para adivinar el rol por default.
function inferRoleFromTeams(teams: string[]): Role {
  for (const team of teams) {
    const t = team.toLowerCase();
    if (t.startsWith('admin')) return 'admin';
    if (t.startsWith('compras')) return 'compras';
    if (t.startsWith('almac')) return 'almacen';
    if (t.startsWith('ventas')) return 'vendedor';
  }
  return 'vendedor';
}

interface Toast { kind: 'success' | 'error'; message: string }

export function SettingsPage() {
  const me = useMe();
  const [identities, setIdentities] = useState<IdentityDTO[] | null>(null);
  const [mondayUsers, setMondayUsers] = useState<MondayUserDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    getIdentities().then(setIdentities).catch(() => setLoadError('No se pudo cargar la lista de usuarios del portal.'));
    getMondayUsers().then(setMondayUsers).catch(() => setLoadError('No se pudo cargar el directorio de Monday.'));
  }, []);

  function showToast(kind: Toast['kind'], message: string) {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 3500);
  }

  // Keep the roster in sync locally after a save/import so both sections
  // (and the "ya importado" badge) reflect it without a refetch.
  function upsertIdentity(next: IdentityDTO) {
    setIdentities((prev) => {
      if (!prev) return [next];
      const i = prev.findIndex((p) => p.email === next.email);
      if (i === -1) return [...prev, next];
      const copy = prev.slice();
      copy[i] = next;
      return copy;
    });
  }

  const importedEmails = new Set((identities ?? []).map((i) => i.email));
  const filteredMonday = (mondayUsers ?? []).filter((u) => textIncludes(u.nombre, q) || textIncludes(u.email, q));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>Configuración</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
          Gestiona quién puede iniciar sesión en el portal e importa usuarios desde Monday.com.
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '20px 0 32px' }}>
        {loadError && (
          <div style={{
            margin: '0 24px 16px', padding: '10px 14px', borderRadius: 'var(--radius-lg)',
            background: 'var(--status-perdida-tint)', color: 'var(--status-perdida)', font: 'var(--text-label)',
          }}>
            {loadError}
          </div>
        )}

        <MyAccountSection
          me={me}
          onSaved={(nombre) => {
            setIdentities((prev) => (prev ?? []).map((i) => (i.email === me?.email ? { ...i, nombre } : i)));
            showToast('success', 'Nombre actualizado.');
          }}
          onError={() => showToast('error', 'No se pudo guardar el nombre.')}
        />

        <div style={{ height: 24 }} />

        <IdentitiesSection
          identities={identities}
          ownEmail={me?.email ?? null}
          onSaved={(next) => { upsertIdentity(next); showToast('success', `Teléfono actualizado para ${next.email}.`); }}
          onError={() => showToast('error', 'No se pudo guardar el teléfono.')}
        />

        <div style={{ height: 24 }} />

        <BoardAccessSection
          onSaved={(role) => showToast('success', `Accesos de ${ROLE_LABELS[role]} actualizados.`)}
          onError={() => showToast('error', 'No se pudieron guardar los accesos.')}
        />

        <div style={{ height: 24 }} />

        <ZonasSection
          identities={identities}
          onToast={showToast}
        />

        <div style={{ height: 24 }} />

        <MondaySection
          users={filteredMonday}
          total={mondayUsers?.length ?? 0}
          q={q}
          onQChange={setQ}
          importedEmails={importedEmails}
          onImported={(next) => { upsertIdentity(next); showToast('success', `${next.nombre ?? next.email} agregado al portal.`); }}
          onError={() => showToast('error', 'No se pudo importar el usuario.')}
        />
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, padding: '10px 16px', borderRadius: 'var(--radius-lg)',
          background: toast.kind === 'success' ? 'var(--status-ganada)' : 'var(--status-perdida)',
          color: '#fff', font: 'var(--text-label-strong)', boxShadow: 'var(--shadow-modal)', zIndex: 50,
        }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// Bloque fijo hasta arriba de Configuración: nombre + correo de la sesión activa
// (no del rol impersonado — ImpersonationBanner ya cubre ese caso aparte), para
// que sea obvio con qué cuenta se está entrando cuando hay más de una disponible
// (Efraín, 2026-08-05, tras el bug de la identidad fantasma de Gmail).
function MyAccountSection({ me, onSaved, onError }: {
  me: ReturnType<typeof useMe>;
  onSaved: (nombre: string) => void;
  onError: () => void;
}) {
  const [nombre, setNombre] = useState(me?.nombre ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNombre(me?.nombre ?? ''); }, [me?.nombre]);

  if (!me) return null;
  const dirty = nombre.trim() !== me.nombre && nombre.trim() !== '';

  async function save() {
    const next = nombre.trim();
    if (!next) return;
    setSaving(true);
    try {
      await putIdentity(me!.email, { nombre: next });
      await refreshMe();
      onSaved(next);
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      margin: '0 24px 16px', padding: '14px 18px', borderRadius: 'var(--radius-2xl)',
      border: '1px solid var(--border)', background: 'var(--bg-raised)',
      display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 200px', minWidth: 160 }}>
        <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
          Cuenta
        </div>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          style={{ ...inputStyle, font: 'var(--text-label-strong)', color: 'var(--ink)' }}
        />
      </div>
      <div style={{ flex: '1 1 220px', minWidth: 180 }}>
        <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
          Correo (no editable)
        </div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', padding: '6px 9px' }}>{me.email}</div>
      </div>
      <Button variant={dirty && !saving ? 'primary' : 'disabled'} onClick={save} style={{ padding: '6px 12px' }}>
        {saving ? 'Guardando…' : 'Guardar'}
      </Button>
    </div>
  );
}

function IdentitiesSection({ identities, ownEmail, onSaved, onError }: {
  identities: IdentityDTO[] | null;
  ownEmail: string | null;
  onSaved: (next: IdentityDTO) => void;
  onError: () => void;
}) {
  return (
    <GroupCard label="Usuarios del portal" color="var(--accent-blue)" tint="var(--status-seguimiento-tint)" count={identities?.length ?? '…'}>
      {!identities ? (
        <RowMessage>Cargando…</RowMessage>
      ) : identities.length === 0 ? (
        <RowMessage>Todavía no hay usuarios registrados.</RowMessage>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Rol</th>
                <th style={thStyle}>Estado</th>
                <th style={thStyle}>Teléfono</th>
                <th style={thStyle} />
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {identities.map((identity) => (
                <IdentityRow key={identity.email} identity={identity} isSelf={identity.email === ownEmail} onSaved={onSaved} onError={onError} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GroupCard>
  );
}

function IdentityRow({ identity, isSelf, onSaved, onError }: {
  identity: IdentityDTO;
  isSelf: boolean;
  onSaved: (next: IdentityDTO) => void;
  onError: () => void;
}) {
  const [phone, setPhone] = useState(identity.phone ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = phone !== (identity.phone ?? '');

  async function save() {
    setSaving(true);
    try {
      const nextPhone = phone.trim() || null;
      await putIdentity(identity.email, { phone: nextPhone });
      onSaved({ ...identity, phone: nextPhone });
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <td style={tdStyle}>{identity.nombre || '—'}</td>
      <td style={tdStyle}>{identity.email}</td>
      <td style={tdStyle}><StatusBadge label={ROLE_LABELS[identity.role]} color="var(--ink-secondary)" tint="var(--bg-sunken)" /></td>
      <td style={tdStyle}>
        {identity.active
          ? <StatusBadge label="Activo" color="var(--status-ganada)" tint="var(--status-ganada-tint)" />
          : <StatusBadge label="Inactivo" color="var(--status-perdida)" tint="var(--status-perdida-tint)" />}
      </td>
      <td style={tdStyle}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Sin teléfono" style={inputStyle} />
      </td>
      <td style={tdStyle}>
        <Button variant={dirty && !saving ? 'primary' : 'disabled'} onClick={save} style={{ padding: '6px 12px' }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </td>
      <td style={tdStyle}>
        {!isSelf && identity.active && (
          <Button
            variant="secondary"
            onClick={() => startImpersonation(identity.email)}
            style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}
          >
            Ver como
          </Button>
        )}
      </td>
    </tr>
  );
}

// Accesos por equipo a los boards del sidebar (shared/boardAccess.ts) — declutter de
// nav, no la protección real de datos (esa sigue en shared/visibility.ts por columna).
// 'admin' siempre trae todos los boards y no es editable (worker/lib/boardAccess.ts).
const MATRIX_ROLES: Role[] = [...TEAM_ROLES, 'admin'];

function BoardAccessSection({ onSaved, onError }: {
  onSaved: (role: Role) => void;
  onError: () => void;
}) {
  const [access, setAccess] = useState<BoardAccessDTO | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    getBoardAccess().then(setAccess).catch(() => setLoadError(true));
  }, []);

  return (
    <GroupCard label="Accesos por equipo" color="var(--accent-red)" tint="var(--status-esperando-tint)" count={MATRIX_ROLES.length}>
      {loadError ? (
        <RowMessage>No se pudieron cargar los accesos por equipo.</RowMessage>
      ) : !access ? (
        <RowMessage>Cargando…</RowMessage>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Equipo</th>
                {BOARD_KEYS.map((k) => <th key={k} style={{ ...thStyle, textAlign: 'center' }}>{BOARD_LABELS[k]}</th>)}
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROLES.map((role) => (
                <BoardAccessRow
                  key={role}
                  role={role}
                  boardKeys={access[role] ?? []}
                  onSaved={(keys) => { setAccess((prev) => prev && { ...prev, [role]: keys }); onSaved(role); }}
                  onError={onError}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GroupCard>
  );
}

function BoardAccessRow({ role, boardKeys, onSaved, onError }: {
  role: Role;
  boardKeys: string[];
  onSaved: (boardKeys: string[]) => void;
  onError: () => void;
}) {
  const editable = TEAM_ROLES.includes(role);
  const [draft, setDraft] = useState(new Set(boardKeys));
  const [saving, setSaving] = useState(false);
  const dirty = draft.size !== boardKeys.length || boardKeys.some((k) => !draft.has(k));

  function toggle(k: string) {
    if (!editable) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const keys = [...draft];
      await putBoardAccess(role, keys);
      onSaved(keys);
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <td style={tdStyle}>{ROLE_LABELS[role]}</td>
      {BOARD_KEYS.map((k) => (
        <td key={k} style={{ ...tdStyle, textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={draft.has(k)}
            disabled={!editable}
            onChange={() => toggle(k)}
            style={{ cursor: editable ? 'pointer' : 'default' }}
          />
        </td>
      ))}
      <td style={tdStyle}>
        {editable && (
          <Button variant={dirty && !saving ? 'primary' : 'disabled'} onClick={save} style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        )}
      </td>
    </tr>
  );
}

// Zonas de ventas (worker/lib/zonas.ts): el líder VE las oportunidades de sus
// miembros; editarlas sigue siendo solo del dueño. A diferencia de "Accesos por
// equipo" (declutter de nav), esto sí cambia qué datos ve cada quien.
function ZonasSection({ identities, onToast }: {
  identities: IdentityDTO[] | null;
  onToast: (kind: Toast['kind'], message: string) => void;
}) {
  const [zonas, setZonas] = useState<ZonaDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [nueva, setNueva] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getZonas().then(setZonas).catch(() => setLoadError(true));
  }, []);

  async function crear() {
    const nombre = nueva.trim();
    if (!nombre) return;
    setCreating(true);
    try {
      const zona = await createZona(nombre);
      setZonas((prev) => [...(prev ?? []), zona].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNueva('');
      onToast('success', `Zona "${zona.nombre}" creada.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'No se pudo crear la zona.');
    } finally {
      setCreating(false);
    }
  }

  async function borrar(zona: ZonaDTO) {
    if (!window.confirm(`¿Eliminar la zona "${zona.nombre}"? Su líder dejará de ver las oportunidades del equipo.`)) return;
    try {
      await deleteZona(zona.id);
      setZonas((prev) => (prev ?? []).filter((z) => z.id !== zona.id));
      onToast('success', `Zona "${zona.nombre}" eliminada.`);
    } catch {
      onToast('error', 'No se pudo eliminar la zona.');
    }
  }

  // Solo gente activa: una identidad dada de baja no debe poder quedar de líder
  // ni sumar oportunidades a la zona (el server además filtra por active = 1).
  const activos = (identities ?? []).filter((i) => i.active);

  return (
    <GroupCard
      label="Zonas de ventas"
      color="var(--accent-purple, var(--accent-blue))"
      tint="var(--status-seguimiento-tint)"
      count={zonas?.length ?? '…'}
    >
      <div style={{ padding: '12px 18px', background: 'var(--bg-raised)', font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
        El líder de una zona ve las oportunidades de sus miembros además de las suyas, en
        modo lectura: editarlas, mandarlas a costeo o generar documentos sigue siendo
        solo del vendedor dueño.
      </div>

      {loadError ? (
        <RowMessage>No se pudieron cargar las zonas.</RowMessage>
      ) : !zonas ? (
        <RowMessage>Cargando…</RowMessage>
      ) : (
        <>
          {zonas.length === 0 && <RowMessage>Todavía no hay zonas. Sin zonas, cada quien ve solo lo suyo.</RowMessage>}
          {zonas.map((zona) => (
            <ZonaRow
              key={zona.id}
              zona={zona}
              identities={activos}
              onSaved={(next) => {
                setZonas((prev) => (prev ?? []).map((z) => (z.id === next.id ? next : z)));
                onToast('success', `Zona "${next.nombre}" actualizada.`);
              }}
              onError={(msg) => onToast('error', msg)}
              onDelete={() => borrar(zona)}
            />
          ))}
        </>
      )}

      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        padding: '12px 18px', background: 'var(--bg-raised)', borderTop: '1px solid var(--border-subtle)',
      }}>
        <input
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') crear(); }}
          placeholder="Nombre de la zona (ej. Zona Norte)"
          style={{ ...inputStyle, maxWidth: 280 }}
        />
        <Button variant={nueva.trim() && !creating ? 'primary' : 'disabled'} onClick={crear} style={{ padding: '6px 12px' }}>
          {creating ? 'Creando…' : 'Crear zona'}
        </Button>
      </div>
    </GroupCard>
  );
}

function ZonaRow({ zona, identities, onSaved, onError, onDelete }: {
  zona: ZonaDTO;
  identities: IdentityDTO[];
  onSaved: (next: ZonaDTO) => void;
  onError: (message: string) => void;
  onDelete: () => void;
}) {
  const [nombre, setNombre] = useState(zona.nombre);
  const [lider, setLider] = useState(zona.liderEmail ?? '');
  const [miembros, setMiembros] = useState(new Set(zona.miembros));
  const [saving, setSaving] = useState(false);

  const dirty = nombre !== zona.nombre
    || lider !== (zona.liderEmail ?? '')
    || miembros.size !== zona.miembros.length
    || zona.miembros.some((m) => !miembros.has(m));

  function toggle(email: string) {
    setMiembros((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      // El líder nunca se guarda como miembro de su propia zona: su scope ya lo
      // incluye por definición (worker/lib/zonas.ts readableUserIds).
      const clean = [...miembros].filter((m) => m !== lider);
      await putZona(zona.id, { nombre: nombre.trim(), liderEmail: lider || null, miembros: clean });
      onSaved({ ...zona, nombre: nombre.trim(), liderEmail: lider || null, miembros: clean });
      setMiembros(new Set(clean));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo guardar la zona.');
    } finally {
      setSaving(false);
    }
  }

  const liderOptions = [
    { value: '', label: 'Sin líder' },
    ...identities.map((i) => ({ value: i.email, label: i.nombre || i.email })),
  ];

  return (
    <div style={{ padding: '14px 18px', background: 'var(--bg-raised)', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }} />
        <div style={{ minWidth: 200 }}>
          <Select value={lider} onChange={setLider} options={liderOptions} />
        </div>
        <div style={{ flex: 1 }} />
        <Button variant={dirty && !saving ? 'primary' : 'disabled'} onClick={save} style={{ padding: '6px 12px' }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button variant="secondary" onClick={onDelete} style={{ padding: '6px 12px' }}>Eliminar</Button>
      </div>

      <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '14px 0 8px' }}>
        Miembros
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
        {identities.filter((i) => i.email !== lider).map((i) => (
          <label key={i.email} style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--text-label)', color: 'var(--ink-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={miembros.has(i.email)} onChange={() => toggle(i.email)} style={{ cursor: 'pointer' }} />
            {i.nombre || i.email}
          </label>
        ))}
      </div>
    </div>
  );
}

function MondaySection({ users, total, q, onQChange, importedEmails, onImported, onError }: {
  users: MondayUserDTO[];
  total: number;
  q: string;
  onQChange: (v: string) => void;
  importedEmails: Set<string>;
  onImported: (next: IdentityDTO) => void;
  onError: () => void;
}) {
  return (
    <GroupCard label="Importar desde Monday" color="var(--accent-green)" tint="var(--status-confirmado-tint)" count={`${users.length}/${total}`}>
      <div style={{ padding: '12px 18px', background: 'var(--bg-raised)' }}>
        <SearchInput value={q} onChange={(e) => onQChange(e.target.value)} placeholder="Buscar por nombre o email…" style={{ maxWidth: 360 }} />
      </div>
      {users.length === 0 ? (
        <RowMessage>Sin resultados.</RowMessage>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Equipos</th>
                <th style={thStyle}>Teléfono</th>
                <th style={thStyle}>Rol a asignar</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <MondayUserRow key={u.id} user={u} imported={importedEmails.has(u.email)} onImported={onImported} onError={onError} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GroupCard>
  );
}

function MondayUserRow({ user, imported, onImported, onError }: {
  user: MondayUserDTO;
  imported: boolean;
  onImported: (next: IdentityDTO) => void;
  onError: () => void;
}) {
  const [phone, setPhone] = useState(user.phone ?? '');
  const [role, setRole] = useState<Role>(() => inferRoleFromTeams(user.teams));
  const [saving, setSaving] = useState(false);

  async function add() {
    setSaving(true);
    try {
      const nextPhone = phone.trim() || null;
      const patch: Partial<IdentityDTO> = { nombre: user.nombre, mondayUserId: user.id, role, active: true, phone: nextPhone };
      await putIdentity(user.email, patch);
      onImported({ email: user.email, phone: nextPhone, nombre: user.nombre, mondayUserId: user.id, role, active: true });
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <td style={tdStyle}>{user.nombre}</td>
      <td style={tdStyle}>{user.email}</td>
      <td style={tdStyle}>{user.teams.length ? user.teams.join(', ') : '—'}</td>
      <td style={tdStyle}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Capturar teléfono" style={inputStyle} />
      </td>
      <td style={{ ...tdStyle, minWidth: 150 }}>
        <Select value={role} onChange={(v) => setRole(v as Role)} options={ROLE_OPTIONS} />
      </td>
      <td style={tdStyle}>
        <Button variant={saving ? 'disabled' : 'primary'} onClick={add} style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
          {saving ? 'Guardando…' : imported ? 'Actualizar' : 'Agregar al portal'}
        </Button>
      </td>
    </tr>
  );
}

function RowMessage({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '20px 18px', font: 'var(--text-label)', color: 'var(--ink-quiet)', background: 'var(--bg-raised)' }}>
      {children}
    </div>
  );
}

const thStyle: CSSProperties = {
  textAlign: 'left', padding: '9px 14px', font: 'var(--text-micro)',
  color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: 'var(--bg-raised)',
};

const tdStyle: CSSProperties = {
  textAlign: 'left', padding: '8px 14px', font: 'var(--text-label)',
  color: 'var(--ink-secondary)', background: 'var(--bg-raised)',
};

const inputStyle: CSSProperties = {
  width: '100%', minWidth: 140, font: 'var(--text-body)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '6px 9px', boxSizing: 'border-box',
};
