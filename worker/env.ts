export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  FILES: R2Bucket;
  MONDAY_API_KEY: string;
  WEBHOOK_TOKEN: string;          // unguessable path segment for /api/sync/webhook/:token
  ENVIRONMENT?: 'dev' | 'prod';
  DEV_EMAIL?: string;             // dev-only identity override; MUST be ignored when prod
  ACCESS_TEAM_DOMAIN?: string;    // e.g. cmp.cloudflareaccess.com (prod)
  ACCESS_AUD?: string;            // Access application AUD tag (prod)
  CMP_TALLAS_BASE?: string;       // Vercel automations base URL
  CMP_SECRET?: string;            // X-CMP-Secret header for cmp-tallas
  // Plan "salir de Monday" Fase 1 (2026-08-12): '1' prende el validar_costeo nativo
  // (worker/lib/costeo.ts) en vez de llamar a cmp-tallas — fallback vivo mientras se
  // corre en paralelo contra oportunidades reales y se compara el resultado. Sin
  // definir o distinto de '1' = comportamiento de siempre (cmp-tallas).
  COSTEO_NATIVE?: string;
  // Fase 2 (2026-08-12): '1' prende worker/lib/cotizacion.ts (Eledo+DocuSeal
  // directo) en vez de cmp-tallas' /api/generate_cotizacion. Mismo criterio de
  // fallback vivo que COSTEO_NATIVE.
  COTIZACION_NATIVE?: string;
  // Fase 3 (2026-08-12): '1' prende "Confirmar tallas" nativo (worker/lib/
  // proyectoTallas.ts confirmTallasNative — gate TODO CUADRA 100% D1, PDF propio
  // del portal, DocuSeal directo) en vez de cmp-tallas' /api/confirm_tallas.
  TALLAS_NATIVE?: string;
  // Fase 4 (2026-08-12): '1' prende "Generar OC" nativo (worker/lib/oc.ts —
  // agrupa por proveedor, Eledo+DocuSeal directo, folio global "OC-n" en D1) en
  // vez de cmp-tallas' /api/generate_oc.
  OC_NATIVE?: string;
  // Fase 0 (cimientos, 2026-08-12) — clientes delgados para las fases siguientes
  // (cotización/OC vía Eledo+DocuSeal, imagen de producto vía Airtable).
  ELEDO_API_KEY?: string;         // worker/lib/eledo.ts
  DOCUSEAL_API_KEY?: string;      // worker/lib/docuseal.ts
  AIRTABLE_API_KEY?: string;      // worker/lib/airtable.ts

  // Fase 5 (2026-08-13): '1' prende la creación nativa de la carpeta de Drive +
  // 12 subcarpetas de licitación al crearse una Oportunidad (worker/sync/
  // webhook.ts, evento create_item), en vez del escenario 100 de Make
  // (create_subfolders de cmp-tallas) — y el depósito de los PDFs que ya
  // generan las Fases 2-4 (cotización/tallas/OC) en su subcarpeta. Requiere que
  // Efraín desactive el escenario 100 de Make antes de encender esta flag, para
  // no crear carpetas duplicadas. Mismo criterio de fallback vivo que las fases
  // anteriores: sin definir = el comportamiento de siempre (Make + cmp-tallas).
  DRIVE_NATIVE?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;  // worker/lib/googleAuth.ts (JWT RS256)
  GOOGLE_PRIVATE_KEY?: string;            // PEM, service account de Drive

  // Claude agent, shared by two channels: WhatsApp bot (worker/wa/) and the
  // portal chat bubble (worker/assistant/). Both reply politely when unset.
  ANTHROPIC_API_KEY?: string;     // Claude API key (Haiku agent)
  ANTHROPIC_BASE_URL?: string;    // dev-only: point the agent at a mock server
  WHATSAPP_TOKEN?: string;        // Meta Graph API access token (system user, permanent)
  WHATSAPP_PHONE_NUMBER_ID?: string; // sender phone-number id from Meta app
  WA_VERIFY_TOKEN?: string;       // arbitrary string echoed at webhook subscribe time
  WA_APP_SECRET?: string;         // Meta app secret — verifies X-Hub-Signature-256

  ADMIN_ALERT_PHONE?: string;     // E.164 (52XXXXXXXXXX) — destino de alertas de sync_log
}
