// Admin-only Configuración page: view/edit the portal's identity roster and
// import users from the Monday.com directory. Both endpoints already 403 for
// non-admin viewers server-side — see src/lib/apiClient.ts — this page is
// only reachable via Sidebar's admin-gated nav entry.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  getIdentities, putIdentity, getMondayUsers,
  type IdentityDTO, type MondayUserDTO,
} from '../lib/api';
import { Button } from '../components/core/Button';
import { SearchInput } from '../components/forms/SearchInput';
import { Select } from '../components/forms/Select';
import { StatusBadge } from '../components/core/Badges';
import { GroupCard } from '../components/layout/GroupCard';
import { textIncludes } from '../lib/textMatch';

type Role = IdentityDTO['role'];

const ROLE_LABELS: Record<Role, string> = {
  vendedor: 'Vendedor', compras: 'Compras', admin: 'Admin', cliente: 'Cliente',
};
const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

interface Toast { kind: 'success' | 'error'; message: string }

export function SettingsPage() {
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

        <IdentitiesSection
          identities={identities}
          onSaved={(next) => { upsertIdentity(next); showToast('success', `Teléfono actualizado para ${next.email}.`); }}
          onError={() => showToast('error', 'No se pudo guardar el teléfono.')}
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

function IdentitiesSection({ identities, onSaved, onError }: {
  identities: IdentityDTO[] | null;
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
              </tr>
            </thead>
            <tbody>
              {identities.map((identity) => (
                <IdentityRow key={identity.email} identity={identity} onSaved={onSaved} onError={onError} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GroupCard>
  );
}

function IdentityRow({ identity, onSaved, onError }: {
  identity: IdentityDTO;
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
    </tr>
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
  const [role, setRole] = useState<Role>('vendedor');
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
