// Captura del trazo de la firma. Pointer events (no mouse+touch por separado)
// para que funcione igual con dedo en móvil, stylus y mouse.
//
// Exporta JPEG, no PNG, a propósito: el escritor de PDF del worker solo sabe
// embeber DCTDecode (worker/lib/pdf/writer.ts), así que el canvas se pinta con
// fondo blanco y se serializa con toDataURL('image/jpeg').
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

export interface SignaturePadHandle {
  /** data URL image/jpeg, o null si no hay trazo. */
  toJpeg: () => string | null;
  clear: () => void;
}

const RATIO = 0.32;         // alto/ancho de la caja de firma
const STROKE = '#12243a';

interface SignaturePadProps {
  onChange?: (hasInk: boolean) => void;
  height?: number;
  /** React 19: `ref` es un prop normal, sin forwardRef. */
  ref?: Ref<SignaturePadHandle>;
}

export function SignaturePad({ onChange, height = 150, ref }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // El canvas se dimensiona en píxeles del dispositivo (devicePixelRatio) para
  // que el trazo no salga pixeleado en pantallas retina ni en el PDF.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssWidth = wrap.clientWidth;
    const cssHeight = Math.max(height, Math.round(cssWidth * RATIO));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = STROKE;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [height]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointFrom(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    const from = last.current;
    if (!ctx || !from) return;
    const to = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    last.current = to;
    if (!hasInk) { setHasInk(true); onChange?.(true); }
  };

  const end = () => { drawing.current = false; last.current = null; };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
    onChange?.(false);
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    // Sin trazo devuelve null: el server acepta firmar solo con la identidad
    // autenticada + nombre mecanografiado, y así no manda un JPEG en blanco.
    toJpeg: () => (hasInk ? canvasRef.current?.toDataURL('image/jpeg', 0.85) ?? null : null),
    clear,
  }), [hasInk, clear]);

  return (
    <div ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        style={{
          display: 'block', width: '100%', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', background: '#fff',
          cursor: 'crosshair', touchAction: 'none',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>
          {hasInk ? 'Trazo capturado.' : 'Firma con el dedo, el stylus o el mouse.'}
        </span>
        <span
          onClick={clear}
          style={{ font: 'var(--text-caption)', color: 'var(--accent)', cursor: 'pointer', userSelect: 'none' }}
        >
          Borrar
        </span>
      </div>
    </div>
  );
}
