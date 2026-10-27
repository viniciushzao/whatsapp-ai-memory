// Teste E2E simulando a chamada real do Webhook da GREEN-API no Supabase
import { loadEnvFile } from "./setup-env.mjs";

loadEnvFile();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "iuwzoefqwuopftbwquij";
const FUNCTION_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook`;
const SENDER_PHONE = (process.env.ALLOWED_PHONE_NUMBER || "5515997347481").split(",")[0].trim();
const ID_INSTANCE = Number(process.env.GREEN_API_ID_INSTANCE || 7103000000);

async function testWebhookExecution() {
  console.log("=== ENVIANDO MENSAGEM DE TESTE (FORMATO GREEN-API) PARA A EDGE FUNCTION ===");

  const uniqueId = "GREEN_TEST_" + Date.now();
  const payload = {
    typeWebhook: "incomingMessageReceived",
    instanceData: {
      idInstance: ID_INSTANCE,
      wid: `${SENDER_PHONE}@c.us`,
      typeInstance: "whatsapp",
    },
    timestamp: Math.floor(Date.now() / 1000),
    idMessage: uniqueId,
    senderData: {
      chatId: `${SENDER_PHONE}@c.us`,
      sender: `${SENDER_PHONE}@c.us`,
      senderName: "Vinicius",
      senderContactName: "Vinicius",
    },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: {
        textMessage: "Quando é o meu aniversário?",
        isTemplateMessage: false,
      },
    },
  };

  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.log("Status HTTP:", res.status);
  const json = await res.json();
  console.log("Resposta da Edge Function:", JSON.stringify(json, null, 2));
}

testWebhookExecution();
