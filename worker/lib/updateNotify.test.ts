// Lógica pura del emisor de notificaciones de comentarios: qué se considera
// update de máquina y cómo se leen las menciones nativas de Monday. Los textos
// vienen del feed real de Oportunidades/Proyectos (verificado 2026-08-18) — si
// cmp-tallas cambia sus mensajes, este archivo es el que debe actualizarse.
import { describe, it, expect } from 'vitest';
import { isAutomationUpdate, mentionIdsFromBody, notifyBoardKey, PORTAL_SIGNATURE } from './updateNotify';

describe('isAutomationUpdate', () => {
  it('filtra los reportes que publica el portal/cmp-tallas', () => {
    expect(isAutomationUpdate('**Cotización generada — 2026-08-14 20:13 UTC**\n- ✅ 0890 - 1')).toBe(true);
    expect(isAutomationUpdate('**Órdenes de Compra generadas**')).toBe(true);
    expect(isAutomationUpdate('⚠️ Proceso omitido: El Proyecto no tiene Sheet de tallas vinculada')).toBe(true);
  });

  it('filtra los avisos automáticos de flujo', () => {
    expect(isAutomationUpdate('José Luis García Benítez ha solicitado el costeo de la oportunidad.')).toBe(true);
    expect(isAutomationUpdate('EMILY MARTINEZ GONZALEZ ha solicitado la validación del costeo folio: OPP-0890')).toBe(true);
    expect(isAutomationUpdate('Ray Rodriguez ha solicitado confirmación de tallas.')).toBe(true);
    expect(isAutomationUpdate('Hola Ray Rodriguez, LILIANA CHALE:  El costeo fué validado.')).toBe(true);
    expect(isAutomationUpdate('Se intento generar ordenes de compra de proveedores. Pero la orden de compra ya existe')).toBe(true);
  });

  it('deja pasar los comentarios de personas', () => {
    expect(isAutomationUpdate('Hola @EMILY MARTINEZ GONZALEZ\n\nMe piden modificar la cantidad de 53 a 52 unidades.')).toBe(false);
    expect(isAutomationUpdate('BUENAS TARDES.')).toBe(false);
    expect(isAutomationUpdate('LA ESPALDA VA A IR CON BORDADO DIRECTO HILO PLATA DE 27 CM')).toBe(false);
    // Un comentario del portal (lo notifica el POST, el webhook lo salta por la
    // firma, no por este filtro).
    expect(isAutomationUpdate(`Ya quedó el ajuste.\n\n— Efraín vía ${'Portal CMP'}`)).toBe(false);
  });

  it('trata el texto vacío como no notificable', () => {
    expect(isAutomationUpdate('')).toBe(true);
    expect(isAutomationUpdate('   \n ')).toBe(true);
  });
});

describe('mentionIdsFromBody', () => {
  it('lee las menciones nativas de Monday del HTML del update', () => {
    const html = 'Hola <a class="user_mention_editor router" href="https://mexicanaproteccion.monday.com/users/99293456" '
      + 'data-mention-type="User" data-mention-id="99293456">@EMILY MARTINEZ GONZALEZ</a> <br /><br />Me ayudas por favor.';
    expect(mentionIdsFromBody(html)).toEqual([99293456]);
  });

  it('de-duplica y admite varias menciones', () => {
    const html = '<a data-mention-type="User" data-mention-id="1">@A</a> <a data-mention-type="User" data-mention-id="2">@B</a>'
      + ' <a data-mention-type="User" data-mention-id="1">@A</a>';
    expect(mentionIdsFromBody(html).sort()).toEqual([1, 2]);
  });

  it('ignora menciones que no son de usuario (equipos/proyectos)', () => {
    expect(mentionIdsFromBody('<a data-mention-type="Team" data-mention-id="55">@Ventas</a>')).toEqual([]);
    expect(mentionIdsFromBody('sin menciones')).toEqual([]);
  });
});

describe('notifyBoardKey', () => {
  it('manda Proyectos al acceso que lo lista en el sidebar', () => {
    expect(notifyBoardKey('proyectos')).toBe('doctallas');
    expect(notifyBoardKey('oportunidades')).toBe('oportunidades');
  });
});

describe('PORTAL_SIGNATURE', () => {
  it('coincide con la firma que agrega el POST de updates', () => {
    // worker/routes/boards.ts firma cada update del portal con este sufijo; el
    // webhook lo usa para no re-notificar lo que ese POST ya notificó.
    expect(`texto\n\n— Efraín ${PORTAL_SIGNATURE}`).toContain(PORTAL_SIGNATURE);
  });
});
