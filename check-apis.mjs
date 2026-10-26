// Script de diagnostico completo de todas as APIs (Gemini, Supabase Management API, Meta WhatsApp Cloud API)
import { loadEnvFile } from "./setup-env.mjs";

loadEnvFile();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "iuwzoefqwuopftbwquij";
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const META_WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "1418890021300333";
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "4102165980086842";

async function testGemini() {
  console.log("\n--- 1. TESTANDO GOOGLE GEMINI API ---");
  if (!GEMINI_API_KEY) {
    console.error("[FAIL] GEMINI_API_KEY nao configurada no arquivo .env");
    return;
  }

  try {
    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Responda apenas: OK" }] }],
        }),
      }
    );
    const genData = await genRes.json();
    if (genRes.ok) {
      console.log(
        "[OK] Gemini gemini-2.5-flash:",
        genData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      );
    } else {
      console.error("[FAIL] Gemini gemini-2.5-flash:", genRes.status, genData);
    }

    const embRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: "teste de embedding" }] },
          outputDimensionality: 768,
        }),
      }
    );
    const embData = await embRes.json();
    if (embRes.ok && embData?.embedding?.values?.length === 768) {
      console.log("[OK] Gemini gemini-embedding-001: 768 dimensoes geradas com sucesso!");
    } else {
      console.error("[FAIL] Gemini embedding:", embRes.status, embData);
    }
  } catch (e) {
    console.error("[ERROR] Excecao ao testar Gemini:", e.message);
  }
}

async function testSupabaseCLI() {
  console.log("\n--- 2. TESTANDO SUPABASE MANAGEMENT API ---");
  if (!SUPABASE_ACCESS_TOKEN) {
    console.error("[FAIL] SUPABASE_ACCESS_TOKEN nao configurado no arquivo .env");
    return;
  }

  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}`,
      {
        headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
      }
    );
    if (res.ok) {
      const data = await res.json();
      console.log(
        `[OK] Projeto Supabase '${data.name}' (${SUPABASE_PROJECT_REF}) - Status: '${data.status}'`
      );

      const keysRes = await fetch(
        `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys`,
        {
          headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
        }
      );
      if (keysRes.ok) {
        const keys = await keysRes.json();
        console.log(
          "[OK] API Keys disponiveis:",
          keys.map((k) => ({
            name: k.name,
            type: k.type,
            prefix: k.api_key ? k.api_key.slice(0, 15) + "..." : "N/A",
          }))
        );
      }

      const secRes = await fetch(
        `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/secrets`,
        {
          headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
        }
      );
      if (secRes.ok) {
        const secrets = await secRes.json();
        console.log(
          "[OK] Secrets configurados nas Edge Functions:",
          secrets.map((s) => s.name)
        );
      }

      const funcRes = await fetch(
        `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/functions`,
        {
          headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
        }
      );
      if (funcRes.ok) {
        const funcs = await funcRes.json();
        console.log(
          "[OK] Edge Functions implantadas:",
          funcs.map((f) => ({
            name: f.name,
            status: f.status,
            version: f.version,
          }))
        );
      }
    } else {
      console.error(`[FAIL] Supabase Management API falhou com status ${res.status}`);
    }
  } catch (e) {
    console.error("[ERROR] Excecao ao testar Supabase Management API:", e.message);
  }
}

async function testMeta() {
  console.log("\n--- 3. TESTANDO META GRAPH API (WHATSAPP) ---");
  if (!META_WA_TOKEN) {
    console.error("[FAIL] WHATSAPP_ACCESS_TOKEN nao configurado no arquivo .env");
    return;
  }

  try {
    const phoneRes = await fetch(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,code_verification_status,quality_rating`,
      {
        headers: { Authorization: `Bearer ${META_WA_TOKEN}` },
      }
    );
    const phoneData = await phoneRes.json();
    if (phoneRes.ok) {
      console.log("[OK] Phone Number ID:", phoneData);
    } else {
      console.error("[FAIL] Phone Number ID:", phoneRes.status, phoneData);
    }

    const wabaRes = await fetch(
      `https://graph.facebook.com/v21.0/${WABA_ID}?fields=name,timezone_id,message_template_namespace`,
      {
        headers: { Authorization: `Bearer ${META_WA_TOKEN}` },
      }
    );
    const wabaData = await wabaRes.json();
    if (wabaRes.ok) {
      console.log("[OK] WABA:", wabaData);
    } else {
      console.error("[FAIL] WABA:", wabaRes.status, wabaData);
    }

    const subsRes = await fetch(
      `https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps`,
      {
        headers: { Authorization: `Bearer ${META_WA_TOKEN}` },
      }
    );
    const subsData = await subsRes.json();
    if (subsRes.ok) {
      console.log("[OK] Subscribed Apps:", subsData);
    } else {
      console.error("[FAIL] Subscribed Apps:", subsRes.status, subsData);
    }
  } catch (e) {
    console.error("[ERROR] Excecao ao testar Meta:", e.message);
  }
}

async function run() {
  await testGemini();
  await testSupabaseCLI();
  await testMeta();
}

run();
