// Script de diagnostico completo de todas as APIs (Gemini, Supabase Management API, Green-API WhatsApp)
import { loadEnvFile } from "./setup-env.mjs";

loadEnvFile();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "iuwzoefqwuopftbwquij";
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";

const GREEN_API_URL = (process.env.GREEN_API_URL || "https://api.green-api.com").replace(/\/+$/, "");
const GREEN_ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE || "";
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN_INSTANCE || "";

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

async function testGreenApi() {
  console.log("\n--- 3. TESTANDO GREEN-API (WHATSAPP) ---");
  if (!GREEN_ID_INSTANCE || !GREEN_API_TOKEN) {
    console.warn(
      "[PENDENTE] GREEN_API_ID_INSTANCE ou GREEN_API_TOKEN_INSTANCE ainda nao preenchidos no arquivo .env"
    );
    return;
  }

  try {
    const stateRes = await fetch(
      `${GREEN_API_URL}/waInstance${GREEN_ID_INSTANCE}/getStateInstance/${GREEN_API_TOKEN}`
    );
    const stateData = await stateRes.json();
    if (stateRes.ok) {
      console.log("[OK] Estado da Instancia Green-API:", stateData);
    } else {
      console.error("[FAIL] Estado da Instancia Green-API:", stateRes.status, stateData);
    }

    const settingsRes = await fetch(
      `${GREEN_API_URL}/waInstance${GREEN_ID_INSTANCE}/getSettings/${GREEN_API_TOKEN}`
    );
    const settingsData = await settingsRes.json();
    if (settingsRes.ok) {
      console.log("[OK] Configuracoes de Webhook Green-API:", {
        wid: settingsData.wid,
        webhookUrl: settingsData.webhookUrl,
        incomingWebhook: settingsData.incomingWebhook,
        outgoingMessageWebhook: settingsData.outgoingMessageWebhook,
      });
    }
  } catch (e) {
    console.error("[ERROR] Excecao ao testar Green-API:", e.message);
  }
}

async function run() {
  await testGemini();
  await testSupabaseCLI();
  await testGreenApi();
}

run();
