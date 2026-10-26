import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  downloadWhatsAppAudio,
  markMessageAsRead,
  sendWhatsAppText,
  WhatsAppConfig,
} from "./whatsapp.ts";
import {
  analyzeIncomingMessage,
  CandidateMemory,
  checkTopicEvolution,
  formatConversationalQueryAnswer,
  generateEmbedding,
  RetrievedMemoryWithHistory,
} from "./gemini.ts";

/**
 * Normaliza numeros de telefone (remove caracteres nao numericos)
 * e trata a variacao do nono digito no Brasil (55 + DDD + 9 + 8 digitos)
 */
function isAuthorizedPhone(senderPhone: string, allowedListRaw: string): boolean {
  const cleanSender = senderPhone.replace(/\D/g, "");
  const allowedNumbers = allowedListRaw
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean);

  if (allowedNumbers.length === 0) {
    return false;
  }

  for (const allowed of allowedNumbers) {
    if (cleanSender === allowed) {
      return true;
    }
    // Tratamento para numeros do Brasil (com ou sem o 9 adicional apos o DDD)
    if (
      cleanSender.startsWith("55") &&
      allowed.startsWith("55") &&
      cleanSender.slice(0, 4) === allowed.slice(0, 4) &&
      cleanSender.slice(-8) === allowed.slice(-8)
    ) {
      return true;
    }
  }

  return false;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ==========================================================================
  // 1. VERIFICACAO DO WEBHOOK DA META (GET)
  // ==========================================================================
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";

    if (mode === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Verification failed", { status: 403 });
  }

  // ==========================================================================
  // 2. RECEBIMENTO DE MENSAGENS DO WHATSAPP (POST)
  // ==========================================================================
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey =
      Deno.env.get("CUSTOM_SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Registra qualquer webhook (incluindo erros de entrega da Meta em statuses)
    await supabase.from("webhook_debug_logs").insert({ payload });

    const changeValue = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = changeValue?.messages?.[0];

    // Se for apenas confirmacao de entrega/leitura/erro da Meta, retorna 200 OK
    if (!message) {
      return new Response(JSON.stringify({ status: "ignored_non_message" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const senderPhone: string = message.from;
    const messageId: string = message.id;
    const messageType: string = message.type;

    const allowedPhonesEnv = Deno.env.get("ALLOWED_PHONE_NUMBER") || "";
    if (!isAuthorizedPhone(senderPhone, allowedPhonesEnv)) {
      console.warn(`Mensagem ignorada de numero nao autorizado: ${senderPhone}`);
      return new Response(JSON.stringify({ status: "unauthorized_phone" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
    const whatsappConfig: WhatsAppConfig = {
      accessToken: Deno.env.get("WHATSAPP_ACCESS_TOKEN")!,
      phoneNumberId:
        changeValue?.metadata?.phone_number_id ||
        Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!,
    };

    // Evita reprocessamento caso a Meta reenvie o mesmo webhook
    const { data: existingRaw } = await supabase
      .from("raw_messages")
      .select("id")
      .eq("whatsapp_message_id", messageId)
      .maybeSingle();

    if (existingRaw) {
      return new Response(JSON.stringify({ status: "already_processed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Marca a mensagem como lida no WhatsApp
    await markMessageAsRead(messageId, whatsappConfig);

    // Prepara a entrada (Texto ou Audio .ogg)
    let geminiInput:
      | { type: "text"; text: string }
      | { type: "audio"; base64Data: string; mimeType: string };
    let mediaType: "text" | "audio";

    if (messageType === "text" && message.text?.body) {
      mediaType = "text";
      geminiInput = {
        type: "text",
        text: message.text.body.trim(),
      };
    } else if (messageType === "audio" && message.audio?.id) {
      mediaType = "audio";
      const audioData = await downloadWhatsAppAudio(
        message.audio.id,
        whatsappConfig
      );
      geminiInput = {
        type: "audio",
        base64Data: audioData.base64Data,
        mimeType: audioData.mimeType,
      };
    } else {
      await sendWhatsAppText(
        senderPhone,
        "Por enquanto eu so consigo processar mensagens de texto ou audio.",
        whatsappConfig
      );
      return new Response(JSON.stringify({ status: "unsupported_media" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Analisa com o Gemini (transcreve audio se necessario e classifica STORE vs QUERY)
    const analyzed = await analyzeIncomingMessage(geminiInput, geminiApiKey);

    // Registra na Camada 1: Log Episodico Bruto (raw_messages)
    const { data: insertedRaw, error: rawError } = await supabase
      .from("raw_messages")
      .insert({
        whatsapp_message_id: messageId,
        sender_phone: senderPhone,
        media_type: mediaType,
        raw_content: analyzed.transcription,
      })
      .select("id")
      .single();

    if (rawError) {
      throw new Error(`Erro ao salvar raw_message: ${rawError.message}`);
    }

    // Gera o embedding semantico de 768 dimensoes
    const embedding = await generateEmbedding(
      `${analyzed.topicKey}: ${analyzed.cleanFactOrQuery}`,
      geminiApiKey
    );

    // ========================================================================
    // FLUXO A: GUARDAR OU ATUALIZAR MEMORIA (STORE)
    // ========================================================================
    if (analyzed.intent === "STORE") {
      // Verifica se ja existe memoria ativa (is_latest = true) sobre o mesmo assunto
      const { data: candidates, error: candError } = await supabase.rpc(
        "find_candidate_memories_for_update",
        {
          p_sender_phone: senderPhone,
          p_topic_key: analyzed.topicKey,
          p_query_embedding: embedding,
          p_match_count: 5,
        }
      );

      if (candError) {
        throw new Error(
          `Erro ao buscar candidatos para atualizacao: ${candError.message}`
        );
      }

      const evolution = await checkTopicEvolution(
        analyzed.cleanFactOrQuery,
        analyzed.topicKey,
        (candidates || []) as CandidateMemory[],
        geminiApiKey
      );

      if (evolution.supersedesId) {
        // Atualiza versao existente (marca anterior como is_latest = false e aponta supersedes_id)
        const { error: supError } = await supabase.rpc("supersede_memory", {
          p_old_memory_id: evolution.supersedesId,
          p_raw_message_id: insertedRaw.id,
          p_sender_phone: senderPhone,
          p_topic_key: analyzed.topicKey,
          p_category: analyzed.category,
          p_content: analyzed.cleanFactOrQuery,
          p_embedding: embedding,
        });

        if (supError) {
          throw new Error(`Erro ao versionar memoria: ${supError.message}`);
        }
      } else {
        // Insere como memoria inedita
        const { error: memError } = await supabase.from("memories").insert({
          raw_message_id: insertedRaw.id,
          sender_phone: senderPhone,
          topic_key: analyzed.topicKey,
          category: analyzed.category,
          content: analyzed.cleanFactOrQuery,
          embedding: embedding,
          is_latest: true,
          supersedes_id: null,
        });

        if (memError) {
          throw new Error(`Erro ao inserir memoria: ${memError.message}`);
        }
      }

      // Envia confirmacao extremamente curta e direta
      await sendWhatsAppText(
        senderPhone,
        analyzed.shortStoreAck || "Ok, gravei isso!",
        whatsappConfig
      );

      return new Response(
        JSON.stringify({
          status: "stored",
          topicKey: analyzed.topicKey,
          superseded: evolution.supersedesId,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // FLUXO B: CONSULTAR MEMORIA (QUERY)
    // =======================================================================
    const { data: searchResults, error: searchError } = await supabase.rpc(
      "search_memories_with_history",
      {
        p_sender_phone: senderPhone,
        p_query_text: analyzed.cleanFactOrQuery,
        p_query_embedding: embedding,
        p_match_count: 5,
        p_rrf_k: 60,
      }
    );

    if (searchError) {
      throw new Error(`Erro na busca hibrida: ${searchError.message}`);
    }

    const nowBrasilia = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });

    const answerText = await formatConversationalQueryAnswer(
      analyzed.transcription,
      (searchResults || []) as RetrievedMemoryWithHistory[],
      nowBrasilia,
      geminiApiKey
    );

    await sendWhatsAppText(senderPhone, answerText, whatsappConfig);

    return new Response(
      JSON.stringify({
        status: "queried",
        matches: searchResults?.length || 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Erro no processamento do webhook:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
});
