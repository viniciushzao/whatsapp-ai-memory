// Teste E2E simulando a chamada real do Webhook do WhatsApp no Supabase
import { loadEnvFile } from "./setup-env.mjs";

loadEnvFile();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "iuwzoefqwuopftbwquij";
const FUNCTION_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-webhook`;
const SENDER_PHONE = process.env.ALLOWED_PHONE_NUMBER || "5515997347481";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "1418890021300333";
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "4102165980086842";

async function testWebhookExecution() {
  console.log("=== ENVIANDO MENSAGEM DE TESTE PARA A EDGE FUNCTION NA NUVEM ===");

  const uniqueId = "test_msg_" + Date.now();
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15556783716",
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name: "Vinicius" },
                  wa_id: SENDER_PHONE,
                },
              ],
              messages: [
                {
                  from: SENDER_PHONE,
                  id: uniqueId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: {
                    body: "Quando é o meu aniversário?",
                  },
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
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
