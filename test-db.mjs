// Script para verificar tabelas, dados existentes e RPCs no Supabase
import { loadEnvFile } from "./setup-env.mjs";

loadEnvFile();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "iuwzoefqwuopftbwquij";
const CLI_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";

async function checkDatabase() {
  console.log("=== VERIFICANDO BANCO DE DADOS SUPABASE ===");
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CUSTOM_SERVICE_ROLE_KEY || "";

  if (CLI_TOKEN) {
    try {
      const keysRes = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`,
        {
          headers: { Authorization: `Bearer ${CLI_TOKEN}` },
        }
      );
      if (keysRes.ok) {
        const keys = await keysRes.json();
        const foundKey = keys.find((k) => k.name === "service_role")?.api_key;
        if (foundKey) {
          serviceKey = foundKey;
        }
      }
    } catch {
      // Usa fallback do .env
    }
  }

  if (!serviceKey) {
    console.error("[ERRO] SUPABASE_SERVICE_ROLE_KEY nao encontrada.");
    process.exit(1);
  }

  console.log("[OK] Service key carregada!");

  const restUrl = `https://${PROJECT_REF}.supabase.co/rest/v1`;

  // 1. Checar tabelas
  for (const table of ["raw_messages", "memories", "webhook_debug_logs"]) {
    try {
      const res = await fetch(`${restUrl}/${table}?select=*&limit=5`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Range: "0-4",
          Prefer: "count=exact",
        },
      });
      if (res.ok) {
        const rows = await res.json();
        const contentRange = res.headers.get("content-range");
        console.log(
          `[OK] Tabela '${table}': Existe! Total de registros: ${contentRange || rows.length}`
        );
        if (rows.length > 0) {
          console.log(
            `     Exemplo de registro em '${table}':`,
            JSON.stringify(rows[0]).slice(0, 150) + "..."
          );
        }
      } else {
        console.log(
          `[FAIL] Tabela '${table}': Status ${res.status} - ${await res.text()}`
        );
      }
    } catch (e) {
      console.log(`[ERROR] Tabela '${table}':`, e.message);
    }
  }

  // 2. Checar RPCs
  console.log("\n=== TESTANDO RPCs ===");
  try {
    const dummyEmbedding = new Array(768).fill(0.01);
    const rpcRes = await fetch(
      `${restUrl}/rpc/find_candidate_memories_for_update`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_sender_phone: process.env.ALLOWED_PHONE_NUMBER || "5515997347481",
          p_topic_key: "teste",
          p_query_embedding: dummyEmbedding,
          p_match_count: 5,
        }),
      }
    );
    console.log(
      "RPC find_candidate_memories_for_update:",
      rpcRes.status,
      await rpcRes.json()
    );
  } catch (e) {
    console.log("RPC find_candidate_memories_for_update erro:", e.message);
  }

  // 3. Checar Edge Function Webhook
  console.log("\n=== TESTANDO EDGE FUNCTION (GET / Webhook Verification) ===");
  try {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "token_minhameoria_rev1";
    const fnUrl = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=CHALLENGE_ACCEPTED_12345`;
    const fnRes = await fetch(fnUrl);
    const fnText = await fnRes.text();
    console.log(
      `Webhook Verification GET Status: ${fnRes.status}, Body: ${fnText}`
    );
    if (fnText === "CHALLENGE_ACCEPTED_12345") {
      console.log("[OK] Webhook GET verification funcionando 100%!");
    } else {
      console.log("[FAIL] Webhook verification falhou:", fnText);
    }
  } catch (e) {
    console.log("Edge Function erro:", e.message);
  }

  // 4. Ver detalhes das mensagens e logs
  console.log("\n=== REGISTROS RECENTES DE MEMORIAS E LOGS ===");
  try {
    const memsRes = await fetch(
      `${restUrl}/memories?select=topic_key,category,content,is_latest,created_at&limit=5`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }
    );
    console.log("Memorias salvas:", await memsRes.json());

    const debugRes = await fetch(
      `${restUrl}/webhook_debug_logs?select=id,created_at,payload&order=id.desc&limit=3`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }
    );
    console.log(
      "Ultimos webhook logs:",
      JSON.stringify(await debugRes.json(), null, 2)
    );
  } catch (e) {
    console.log("Erro ao buscar memorias/logs:", e.message);
  }
}

checkDatabase();
