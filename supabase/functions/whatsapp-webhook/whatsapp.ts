/**
 * Cliente para a WhatsApp Cloud API (Meta Graph API v21.0)
 * Responsavel por baixar midias de audio (.ogg) e enviar respostas de texto.
 */

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
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
 * Baixa o arquivo de audio (.ogg) dos servidores da Meta a partir do media_id
 */
export async function downloadWhatsAppAudio(
  mediaId: string,
  config: WhatsAppConfig
): Promise<{ base64Data: string; mimeType: string }> {
  // Passo 1: Obter a URL temporaria do arquivo de midia
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

  // Passo 2: Baixar os bytes reais do arquivo de audio usando a URL retornada
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
 */
export async function sendWhatsAppText(
  toPhone: string,
  textBody: string,
  config: WhatsAppConfig
): Promise<void> {
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
        to: toPhone,
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
  config: WhatsAppConfig
): Promise<void> {
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
  ).catch(() => {
    // Falha nao critica caso a marcacao de leitura atrase
  });
}
