import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { fileURLToPath } from "node:url";

// Garante resolucao DNS imediata para dominios recem-restaurados (ex: Supabase)
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  const origLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options || {};
    origLookup(hostname, options, (err, address, family) => {
      if (!err) return cb(null, address, family);
      dns.resolve4(hostname, (rErr, addresses) => {
        if (rErr || !addresses || addresses.length === 0) {
          return cb(err, address, family);
        }
        if (opts && opts.all) {
          return cb(
            null,
            addresses.map((a) => ({ address: a, family: 4 }))
          );
        }
        return cb(null, addresses[0], 4);
      });
    });
  };
} catch {
  // Ignora caso nao permitido pelo SO
}

/**
 * Carrega as variaveis do arquivo .env local sem dependencias externas
 */
export function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "iuwzoefqwuopftbwquij";
const CLI_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";

async function generateEnv() {
  if (!CLI_TOKEN) {
    console.error("[ERRO] Defina SUPABASE_ACCESS_TOKEN no ambiente ou no arquivo .env antes de rodar setup-env.mjs.");
    process.exit(1);
  }

  const keysRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${CLI_TOKEN}` },
  });

  if (!keysRes.ok) {
    console.error(`[ERRO] Falha ao buscar API keys no Supabase (${keysRes.status}):`, await keysRes.text());
    process.exit(1);
  }

  const keys = await keysRes.json();
  const serviceKey = keys.find((k) => k.name === "service_role")?.api_key || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = keys.find((k) => k.name === "anon")?.api_key || process.env.SUPABASE_ANON_KEY || "";

  const envContent = `# Variaveis de Ambiente - Agente de Memoria WhatsApp
GEMINI_API_KEY=${process.env.GEMINI_API_KEY || ""}

# Meta Cloud API
WHATSAPP_ACCESS_TOKEN=${process.env.WHATSAPP_ACCESS_TOKEN || ""}
WHATSAPP_PHONE_NUMBER_ID=${process.env.WHATSAPP_PHONE_NUMBER_ID || "1418890021300333"}
WHATSAPP_VERIFY_TOKEN=${process.env.WHATSAPP_VERIFY_TOKEN || "token_minhameoria_rev1"}
WHATSAPP_BUSINESS_ACCOUNT_ID=${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "4102165980086842"}

# Telefone autorizado
ALLOWED_PHONE_NUMBER=${process.env.ALLOWED_PHONE_NUMBER || "5515997347481"}

# Supabase
SUPABASE_PROJECT_REF=${PROJECT_REF}
SUPABASE_URL=https://${PROJECT_REF}.supabase.co
SUPABASE_ANON_KEY=${anonKey}
SUPABASE_SERVICE_ROLE_KEY=${serviceKey}
CUSTOM_SERVICE_ROLE_KEY=${serviceKey}
SUPABASE_ACCESS_TOKEN=${CLI_TOKEN}
`;

  fs.writeFileSync(".env", envContent, "utf-8");
  console.log("[OK] Arquivo .env atualizado com as chaves mais recentes do Supabase!");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  generateEnv();
}
