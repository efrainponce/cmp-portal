// Input numérico de celda — el único `<input type="number">` que debe usar la
// UI de grids editables (cotización, tallas, líneas de OC).
//
// POR QUÉ EXISTE (Efraín, 2026-08-26, video de una cantidad en "-4"): un
// `<input type="number">` nativo trata ↑/↓ como spinner. Quien viene de Excel
// o de Monday hace clic en una celda y presiona ↓ para "bajar al siguiente
// renglón": no baja, le RESTA 1 al valor — cuatro veces y la cantidad quedó en
// -4. Como estas grids guardan en `blur`, el clic en la siguiente celda mandaba
// ese número a Monday sin que nadie lo escribiera: subtotales en $0 y utilidades
// en negativo. La rueda del mouse ya no lo hace (Chrome 149 scrollea la página,
// medido), pero el teclado sí.
//
// Entonces aquí ↑/↓ (y Enter) NUNCA tocan el valor: mueven el foco al mismo
// campo del renglón vecino, que es lo que la gente estaba intentando hacer.
//
// La navegación va por el DOM y no por índices de renglón: cada celda navegable
// se marca con `data-nav-col` (el id de columna) y el contenedor de la grid con
// `data-cmp-navgrid`. Vecino = el anterior/siguiente de esa misma columna en
// orden de documento. Así funciona igual en una grid de inputs siempre visibles
// (cotización) y en una de celdas que solo abren editor al hacer clic (OC), y no
// hay que hilar un índice por props ni mantenerlo sincronizado con el orden.
import type React from 'react';

/** Contenedor de una grid navegable — ↑/↓ solo buscan celdas dentro de él. */
export const NAV_GRID_ATTR = { 'data-cmp-navgrid': 'true' } as const;

/** Marca una celda como destino de ↑/↓ para su columna. */
export function navCellAttrs(colId: string) {
  return { 'data-nav-col': colId } as const;
}

/**
 * Mueve la edición al mismo campo del renglón anterior/siguiente.
 * Si el vecino ya es un input lo enfoca y selecciona; si es una celda que abre
 * su editor al hacer clic (EditableCell de las OC), le manda el clic.
 * Devuelve false si no había vecino (primer/último renglón).
 */
export function moveCellFocus(from: HTMLElement, dir: 1 | -1): boolean {
  const col = from.getAttribute('data-nav-col');
  if (!col) return false;
  const scope: ParentNode = from.closest('[data-cmp-navgrid]') ?? document;
  const cells = [...scope.querySelectorAll<HTMLElement>(`[data-nav-col="${CSS.escape(col)}"]`)];
  const i = cells.indexOf(from);
  const next = i < 0 ? undefined : cells[i + dir];
  if (!next) return false;
  if (next instanceof HTMLInputElement) {
    if (next.disabled) return false;
    next.focus();
    next.select();
  } else {
    next.click();
  }
  return true;
}

/**
 * onKeyDown compartido: ↑/↓/Enter navegan en vez de sumar o restar, y el signo
 * "-" se bloquea donde no existe un valor negativo (cantidades, tallas). Ojo:
 * eso frena el tecleo, no un pegado — la validación de verdad sigue siendo del
 * server.
 * Se exporta suelto para las celdas que ya tienen su propio <input> (OC).
 */
export function numberCellKeyDown(
  e: React.KeyboardEvent<HTMLInputElement>,
  opts: { noNegative?: boolean; onEscape?: () => void } = {},
) {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') {
    // preventDefault SIEMPRE, aunque no haya vecino a dónde ir: lo que no puede
    // pasar es que la tecla le sume o le reste al número.
    e.preventDefault();
    const movio = moveCellFocus(e.currentTarget, e.key === 'ArrowUp' ? -1 : 1);
    // Enter sin vecino (último renglón, o una grid sin columnas navegables como
    // las tallas) sigue confirmando como antes: blur = guardar.
    if (!movio && e.key === 'Enter') e.currentTarget.blur();
    return;
  }
  if (e.key === 'Escape' && opts.onEscape) { opts.onEscape(); return; }
  if (opts.noNegative && (e.key === '-' || e.key === 'Subtract')) e.preventDefault();
}

export interface NumberCellInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Id de columna — ↑/↓ saltan a esta misma columna del renglón vecino. */
  navCol?: string;
  /** Cantidades y tallas: bloquea teclear "-" y pone min=0. */
  noNegative?: boolean;
}

export function NumberCellInput({ navCol, noNegative, className, onKeyDown, ...rest }: NumberCellInputProps) {
  return (
    <input
      {...rest}
      type="number"
      {...(navCol ? navCellAttrs(navCol) : {})}
      {...(noNegative ? { min: 0 } : {})}
      className={className ? `cmp-grid-num-input ${className}` : 'cmp-grid-num-input'}
      onKeyDown={(e) => {
        numberCellKeyDown(e, { noNegative });
        if (!e.defaultPrevented) onKeyDown?.(e);
      }}
    />
  );
}
