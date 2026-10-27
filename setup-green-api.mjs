// Script automatizado para configurar a instancia da GREEN-API (Webhook URL + Eventos)
import { loadEnvFile } from "./setup-env.mjs";

loadEnvFile();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "iuwzoefqwuopftbwquij";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook`;

const GREEN_API_URL = (process.env.GREEN_API_URL || "https://api.green-api.com").replace(/\/+$/, "");
const ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE || "";
const API_TOKEN_INSTANCE = process.env.GREEN_API_TOKEN_INSTANCE || "";

async function configureGreenApi() {
  console.log("=== CONFIGURANDO INSTANCIA GREEN-API ===");

  if (!ID_INSTANCE || !API_TOKEN_INSTANCE) {
    console.error(
      "[ERRO] Preencha GREEN_API_ID_INSTANCE e GREEN_API_TOKEN_INSTANCE no arquivo .env antes de rodar este comando."
    );
    process.exit(1);
  }

  // 1. Verificar estado da instancia (authorized / notAuthorized)
  const stateRes = await fetch(
    `${GREEN_API_URL}/waInstance${ID_INSTANCE}/getStateInstance/${API_TOKEN_INSTANCE}`
  );
  const stateData = await stateRes.json();
  console.log("1. Estado da Instancia:", stateRes.status, stateData);

  if (stateData?.stateInstance !== "authorized") {
    console.warn(
      "[AVISO] Sua instancia ainda nao esta 'authorized'. Escaneie o QR Code no painel da Green-API!"
    );
  }

  // 2. Configurar Webhook apontando para a Edge Function do Supabase
  const settingsPayload = {
    webhookUrl: WEBHOOK_URL,
    webhookUrlToken: "",
    delaySendMessagesMilliseconds: 500,
    markIncomingMessagesReaded: "yes",
    markIncomingMessagesReadedOnReply: "yes",
    incomingWebhook: "yes",
    outgoingMessageWebhook: "yes",
    outgoingAPIMessageWebhook: "no",
    stateWebhook: "no",
    deviceWebhook: "no",
  };

  const setRes = await fetch(
    `${GREEN_API_URL}/waInstance${ID_INSTANCE}/setSettings/${API_TOKEN_INSTANCE}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsPayload),
    }
  );
  const setData = await setRes.json();
  console.log("2. Configuracao de Webhook (setSettings):", setRes.status, setData);

  if (setRes.ok && setData?.saveSettings) {
    console.log(`[OK] Webhook configurado com sucesso para: ${WEBHOOK_URL}`);
  } else {
    console.error("[FAIL] Falha ao salvar configuracoes na Green-API.");
  }
}

configureGreenApi();
