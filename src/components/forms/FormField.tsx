// Generic writable field for create-record forms — switches on col.type like
// CellContent does for reading (src/components/board/cells.tsx).
import type { CSSProperties } from 'react';
import type { ColMeta } from '../../lib/api';
import type { VendedorDTO } from '../../../shared/dto';
import { Select } from './Select';

interface FormFieldProps {
  col: ColMeta;
  value: string;
  onChange: (value: string) => void;
  vendedores?: VendedorDTO[];
}

const fieldStyle: CSSProperties = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box',
};

// Monday's phone column stores { phone, countryShortName } — countryShortName is an
// ISO 3166-1 alpha-2 code, used by Monday to show the flag/dial code. Without it the
// number saves but shows with no indicator. Encoded into the form value as "CC:number"
// (see worker/lib/columnEncode.ts for the matching decode).
const PHONE_COUNTRIES = [
  { code: 'MX', label: '🇲🇽 +52' },
  { code: 'US', label: '🇺🇸 +1' },
  { code: 'GT', label: '🇬🇹 +502' },
  { code: 'HN', label: '🇭🇳 +504' },
  { code: 'SV', label: '🇸🇻 +503' },
  { code: 'CO', label: '🇨🇴 +57' },
  { code: 'ES', label: '🇪🇸 +34' },
];

function splitPhoneValue(value: string): [string, string] {
  const i = value.indexOf(':');
  return i === -1 ? ['MX', value] : [value.slice(0, i), value.slice(i + 1)];
}

export function FormField({ col, value, onChange, vendedores }: FormFieldProps) {
  if (col.type === 'long_text') {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} style={fieldStyle} />;
  }
  if ((col.type === 'dropdown' || col.type === 'status') && col.labels) {
    const options = Object.values(col.labels).map((l) => ({ value: l.label, label: l.label }));
    return <Select value={value} onChange={onChange} options={options} />;
  }
  if (col.type === 'date') {
    return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />;
  }
  if (col.type === 'people') {
    const options = (vendedores ?? []).map((v) => ({ value: String(v.id), label: v.nombre }));
    return <Select value={value} onChange={onChange} options={options} placeholder="Elegir vendedor…" />;
  }
  if (col.type === 'email') {
    return <input type="email" value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />;
  }
  if (col.type === 'phone') {
    const [country, number] = splitPhoneValue(value);
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={country}
          onChange={(e) => onChange(`${e.target.value}:${number}`)}
          style={{ ...fieldStyle, width: 'auto', flex: '0 0 auto', background: 'var(--bg-raised)' }}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
        <input
          type="tel"
          value={number}
          onChange={(e) => onChange(`${country}:${e.target.value}`)}
          style={{ ...fieldStyle, flex: 1 }}
        />
      </div>
    );
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />;
}
