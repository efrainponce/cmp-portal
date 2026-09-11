// Candados de las herramientas del agente (WhatsApp + chat del portal). Lo que
// se ancla: las consultas de dirección (ranking de vendedores, resumen de
// ventas, costeos por validar) solo se OFRECEN y solo CORREN para la whitelist
// por correo de Efraín (2026-09-11) — rol admin no basta.
import { describe, it, expect } from 'vitest';
import { toolsFor, puedeUsarTool, TOOL_ROLES, TOOLS } from './assistantTools';

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

  it('cada herramienta declarada tiene su regla de rol (fail-closed)', () => {
    for (const t of TOOLS) expect(TOOL_ROLES[t.name], t.name).toBeDefined();
  });
});
