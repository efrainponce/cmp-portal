// Candados de las herramientas del agente (WhatsApp + chat del portal). Lo que
// se ancla: las consultas de dirección (ranking de vendedores, resumen de
// ventas, costeos por validar) solo se OFRECEN y solo CORREN para la whitelist
// por correo de Efraín (2026-09-11) — rol admin no basta.
import { describe, it, expect } from 'vitest';
import { toolsFor, puedeUsarTool, TOOL_ROLES, TOOLS, documentosProyecto, resumenLineasProyecto } from './assistantTools';

const DIRECCION = ['ranking_vendedores', 'resumen_ventas', 'oportunidades_por_validar', 'consulta_libre'];

const nombres = (email: string, role: 'admin' | 'compras' | 'vendedor' | 'almacen' = 'admin') =>
  toolsFor({ email, role }).map(t => t.name);

describe('consultas de dirección del bot', () => {
  it('Elisa, el CEO, Efraín y Jorge (webcmp) las reciben', () => {
    for (const email of [
      'administracion@mexicanadeproteccion.com',
      'efrainponce@mexicanadeproteccion.com',
      'efrain.ponce@mexicanadeproteccion.com',
      'salinasefrain@mexicanadeproteccion.com',
      'efrain.ponces@gmail.com',
      'webcmp@mexicanadeproteccion.com',
    ]) {
      for (const tool of DIRECCION) expect(nombres(email), `${email} ${tool}`).toContain(tool);
    }
  });

  it('PAM es admin y NO las recibe; ni se le dejan correr', () => {
    const pam = { email: 'compras@mexicanadeproteccion.com', role: 'admin' as const };
    for (const tool of DIRECCION) {
      expect(nombres(pam.email)).not.toContain(tool);
      expect(puedeUsarTool(tool, pam)).toBe(false);
    }
    // El resto de sus herramientas de admin sigue igual.
    expect(nombres(pam.email)).toContain('consultar_pipeline');
  });

  it('un correo de la whitelist con otro rol tampoco las recibe (rol Y correo)', () => {
    for (const role of ['compras', 'vendedor', 'almacen'] as const) {
      for (const tool of DIRECCION) expect(nombres('webcmp@mexicanadeproteccion.com', role)).not.toContain(tool);
    }
  });

  it('detalle_proyecto es de vendedor/compras/admin (el scope por renglón lo pone el DAL), no de almacén', () => {
    for (const role of ['vendedor', 'compras', 'admin'] as const) expect(nombres('x@y.com', role)).toContain('detalle_proyecto');
    expect(nombres('x@y.com', 'almacen')).not.toContain('detalle_proyecto');
  });

  it('cada herramienta declarada tiene su regla de rol (fail-closed)', () => {
    for (const t of TOOLS) expect(TOOL_ROLES[t.name], t.name).toBeDefined();
  });
});

const col = (id: string, text: string | null, value: unknown = null) =>
  ({ id, text, value: value === null ? null : JSON.stringify(value) });

describe('detalle_proyecto — documentos', () => {
  const proyecto = {
    columns: JSON.stringify([
      // OC/contrato/cotización firmada (oculto) — la ve el vendedor.
      col('file_mm33yv4p', 'https://x/a.pdf', { files: [{ name: 'OC cliente.pdf' }] }),
      // OC interna — solo compras/admin.
      col('file_mm0hcrtz', 'https://x/b.pdf, https://x/c.pdf', { files: [{ name: 'OC-1.pdf' }, { name: 'OC-2.pdf' }] }),
    ]),
  };

  it('dice qué está subido y qué falta, con los nombres y sin "(oculto)"', () => {
    const docs = documentosProyecto(proyecto, 'admin', 'x@y.com');
    const firmada = docs.find(d => d.documento.startsWith('OC/contrato'));
    expect(firmada).toMatchObject({ documento: 'OC/contrato/cotización firmada', subido: true, archivos: ['OC cliente.pdf'] });
    expect(docs.find(d => d.documento === 'OC interna')).toMatchObject({ subido: true, archivos: ['OC-1.pdf', 'OC-2.pdf'] });
    expect(docs.find(d => d.documento === 'OC Prov. Firmada')).toMatchObject({ subido: false });
  });

  it('el vendedor no ve documentos de columnas que su rol no lee (OC interna)', () => {
    const docs = documentosProyecto(proyecto, 'vendedor', 'x@y.com').map(d => d.documento);
    expect(docs).toContain('OC/contrato/cotización firmada');
    expect(docs).not.toContain('OC interna');
  });
});

describe('detalle_proyecto — líneas resumidas por producto+color', () => {
  const linea = (producto: string, color: string, talla: string, cantidad: number, estado?: string, guia?: string) => ({
    name: producto,
    columns: JSON.stringify([
      col('text_mm0hs17x', producto), col('text_mm0h4a1c', color), col('text_mm1antcb', talla),
      col('numeric_mm0hj2q4', String(cantidad)),
      ...(estado ? [col('color_mm0hqf79', estado)] : []),
      ...(guia ? [col('text_mm0mzet0', guia)] : []),
    ]),
  });

  it('suma piezas, desglosa tallas y cuenta estados', () => {
    const r = resumenLineasProyecto([
      linea('Camisa', 'Negro', 'M', 10, 'Entregado', 'G1'),
      linea('Camisa', 'negro', 'L', 5, 'En embellecimiento'),
      linea('Pantalón', 'Azul', '32', 20, 'Entregado', 'G1'),
    ], 'vendedor', 'x@y.com');
    expect(r).toMatchObject({ total_lineas: 3, total_piezas: 35, lineas_por_estado: { Entregado: 2, 'En embellecimiento': 1 } });
    expect(r.productos[0]).toMatchObject({ producto: 'Pantalón', piezas: 20, tallas: '32: 20', guias: ['G1'] });
    expect(r.productos[1]).toMatchObject({ producto: 'Camisa', color: 'Negro', piezas: 15, tallas: 'M: 10, L: 5', estado: { Entregado: 1, 'En embellecimiento': 1 } });
  });
});
