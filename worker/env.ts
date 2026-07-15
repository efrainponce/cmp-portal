export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MONDAY_API_KEY: string;
  WEBHOOK_TOKEN: string;          // unguessable path segment for /api/sync/webhook/:token
  ENVIRONMENT?: 'dev' | 'prod';
  DEV_EMAIL?: string;             // dev-only identity override; MUST be ignored when prod
  ACCESS_TEAM_DOMAIN?: string;    // e.g. cmp.cloudflareaccess.com (prod)
  ACCESS_AUD?: string;            // Access application AUD tag (prod)
  CMP_TALLAS_BASE?: string;       // Vercel automations base URL
  CMP_SECRET?: string;            // X-CMP-Secret header for cmp-tallas

  // WhatsApp bot (worker/wa/). All optional: routes 503 politely when unset.
  ANTHROPIC_API_KEY?: string;     // Claude API key (Haiku agent)
  ANTHROPIC_BASE_URL?: string;    // dev-only: point the agent at a mock server
  WHATSAPP_TOKEN?: string;        // Meta Graph API access token (system user, permanent)
  WHATSAPP_PHONE_NUMBER_ID?: string; // sender phone-number id from Meta app
  WA_VERIFY_TOKEN?: string;       // arbitrary string echoed at webhook subscribe time
  WA_APP_SECRET?: string;         // Meta app secret — verifies X-Hub-Signature-256
}
