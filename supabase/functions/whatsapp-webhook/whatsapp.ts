/**
 * Cliente hibrido para WhatsApp:
 * - Suporta GREEN-API (recomendado, sem Meta for Developers, via QR Code)
 * - Mantem retrocompatibilidade com Meta Cloud API (v21.0)
 */

export interface WhatsAppConfig {
  provider: "green-api" | "meta";
  // Credenciais Green-API
  greenApiUrl?: string;
  greenIdInstance?: string;
  greenApiTokenInstance?: string;
  // Credenciais Meta Cloud API (legado)
  accessToken?: string;
  phoneNumberId?: string;
}

/**
 * Converte um ArrayBuffer em string Base64 para envio inline ao Gemini
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Baixa um arquivo de audio (.ogg) a partir de uma URL direta (Green-API downloadUrl)
 */
export async function downloadAudioFromUrl(
  downloadUrl: string,
  mimeTypeHint?: string
): Promise<{ base64Data: string; mimeType: string }> {
  const binaryResponse = await fetch(downloadUrl, { method: "GET" });

  if (!binaryResponse.ok) {
    const errText = await binaryResponse.text();
    throw new Error(
      `Falha ao baixar audio da URL (${binaryResponse.status}): ${errText}`
    );
  }

  const arrayBuffer = await binaryResponse.arrayBuffer();
  const base64Data = arrayBufferToBase64(arrayBuffer);
  const rawMime =
    mimeTypeHint || binaryResponse.headers.get("content-type") || "audio/ogg";
  const cleanMimeType = rawMime.split(";")[0].trim();

  return {
    base64Data,
    mimeType: cleanMimeType || "audio/ogg",
  };
}

/**
 * Baixa o arquivo de audio (.ogg) dos servidores da Meta a partir do media_id
 */
export async function downloadWhatsAppAudio(
  mediaId: string,
  config: WhatsAppConfig
): Promise<{ base64Data: string; mimeType: string }> {
  const metaResponse = await fetch(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    }
  );

  if (!metaResponse.ok) {
    const errText = await metaResponse.text();
    throw new Error(
      `Falha ao consultar metadados da midia (${metaResponse.status}): ${errText}`
    );
  }

  const mediaInfo = (await metaResponse.json()) as {
    url: string;
    mime_type?: string;
  };

  const binaryResponse = await fetch(mediaInfo.url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  if (!binaryResponse.ok) {
    const errText = await binaryResponse.text();
    throw new Error(
      `Falha ao baixar binario de audio (${binaryResponse.status}): ${errText}`
    );
  }

  const arrayBuffer = await binaryResponse.arrayBuffer();
  const base64Data = arrayBufferToBase64(arrayBuffer);
  const rawMime = mediaInfo.mime_type || "audio/ogg";
  const cleanMimeType = rawMime.split(";")[0].trim();

  return {
    base64Data,
    mimeType: cleanMimeType,
  };
}

/**
 * Envia uma mensagem de texto direta para o usuario no WhatsApp
 * (Suporta Green-API e Meta Cloud API)
 */
export async function sendWhatsAppText(
  toChatOrPhone: string,
  textBody: string,
  config: WhatsAppConfig
): Promise<void> {
  if (config.provider === "green-api") {
    const baseUrl = (
      config.greenApiUrl || "https://api.green-api.com"
    ).replace(/\/+$/, "");
    const chatId = toChatOrPhone.includes("@")
      ? toChatOrPhone
      : `${toChatOrPhone.replace(/\D/g, "")}@c.us`;

    const response = await fetch(
      `${baseUrl}/waInstance${config.greenIdInstance}/sendMessage/${config.greenApiTokenInstance}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          message: textBody,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Falha ao enviar mensagem via Green-API (${response.status}): ${errText}`
      );
    }
    return;
  }

  // Fallback: Meta Cloud API
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toChatOrPhone.replace(/\D/g, ""),
        type: "text",
        text: {
          preview_url: false,
          body: textBody,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Falha ao enviar mensagem WhatsApp (${response.status}): ${errText}`
    );
  }
}

/**
 * Marca a mensagem recebida como lida no WhatsApp
 */
export async function markMessageAsRead(
  messageId: string,
  chatIdOrPhone: string,
  config: WhatsAppConfig
): Promise<void> {
  if (config.provider === "green-api") {
    const baseUrl = (
      config.greenApiUrl || "https://api.green-api.com"
    ).replace(/\/+$/, "");
    const chatId = chatIdOrPhone.includes("@")
      ? chatIdOrPhone
      : `${chatIdOrPhone.replace(/\D/g, "")}@c.us`;

    await fetch(
      `${baseUrl}/waInstance${config.greenIdInstance}/readChat/${config.greenApiTokenInstance}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          idMessage: messageId,
        }),
      }
    ).catch(() => {});
    return;
  }

  await fetch(
    `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    }
  ).catch(() => {});
}
