/**
 * Modulo de Inteligencia Artificial com Google Gemini API
 * Processa texto e audio nativamente, gera embeddings de 768 dimensoes,
 * avalia atualizacoes de versao no tempo e formata respostas curtas e diretas.
 */

export type MemoryCategory =
  | "fato"
  | "regra"
  | "gotcha"
  | "decisao"
  | "financeiro"
  | "lembrete"
  | "pessoal"
  | "projeto";

export interface AnalyzedMessage {
  intent: "STORE" | "QUERY";
  transcription: string;
  topicKey: string;
  category: MemoryCategory;
  cleanFactOrQuery: string;
  shortStoreAck: string;
}

export interface CandidateMemory {
  id: string;
  topic_key: string;
  category: string;
  content: string;
  similarity: number;
  created_at: string;
}

export interface RetrievedMemoryWithHistory {
  memory_id: string;
  topic_key: string;
  category: string;
  latest_content: string;
  latest_created_at: string;
  rrf_score: number;
  has_changes: boolean;
  version_history: Array<{
    id: string;
    content: string;
    created_at: string;
  }>;
}

const DEFAULT_GENERATION_MODEL = "gemini-2.5-flash";
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

/**
 * Analisa a mensagem de entrada (Texto ou Audio .ogg nativo) e classifica a intencao
 */
export async function analyzeIncomingMessage(
  input:
    | { type: "text"; text: string }
    | { type: "audio"; base64Data: string; mimeType: string },
  apiKey: string,
  modelName = DEFAULT_GENERATION_MODEL
): Promise<AnalyzedMessage> {
  const systemInstruction = `Você é um motor classificador de memória pessoal via WhatsApp.
Regra fundamental: Cada mensagem do usuário trata de apenas UM assunto.
Sua tarefa é:
1. Se a entrada for áudio, transcrever fielmente o que o usuário disse em português no campo "transcription". Se for texto, copiar o texto para "transcription".
2. Classificar a intenção ("intent"):
   - "STORE": quando o usuário está enviando uma informação, nota, fato, senha, valor, regra, lembrete ou atualização para ser guardada.
   - "QUERY": quando o usuário está fazendo uma pergunta ou pedindo para lembrar de algo que ele enviou no passado.
3. Gerar um "topicKey" curto e padronizado em kebab-case identificando a entidade e o atributo principal (exemplo: "orcamento-fornecedor-silva", "senha-alarme-deposito", "reuniao-cliente-alfa").
4. Classificar "category" estritamente em uma das opções: "fato", "regra", "gotcha", "decisao", "financeiro", "lembrete", "pessoal", "projeto".
5. Em "cleanFactOrQuery":
   - Se for STORE: escreva a afirmação de forma clara e completa mantendo todos os números, nomes e detalhes.
   - Se for QUERY: escreva os termos-chave principais para consulta no banco de dados.
6. Em "shortStoreAck": escolha uma confirmação extremamente curta, natural e informal em português, variando entre frases como:
   - "Ok, gravei isso!"
   - "Memória guardada!"
   - "Blz, guardei isso também"
   - "Anotado, guardei aqui!"`;

  const userParts =
    input.type === "text"
      ? [{ text: input.text }]
      : [
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.base64Data,
            },
          },
          {
            text: "Transcreva este áudio e extraia os metadados estruturados conforme as instruções.",
          },
        ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: "user",
            parts: userParts,
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              intent: {
                type: "STRING",
                enum: ["STORE", "QUERY"],
              },
              transcription: { type: "STRING" },
              topicKey: { type: "STRING" },
              category: {
                type: "STRING",
                enum: [
                  "fato",
                  "regra",
                  "gotcha",
                  "decisao",
                  "financeiro",
                  "lembrete",
                  "pessoal",
                  "projeto",
                ],
              },
              cleanFactOrQuery: { type: "STRING" },
              shortStoreAck: { type: "STRING" },
            },
            required: [
              "intent",
              "transcription",
              "topicKey",
              "category",
              "cleanFactOrQuery",
              "shortStoreAck",
            ],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Erro na chamada Gemini analyzeIncomingMessage (${response.status}): ${errText}`
    );
  }

  const data = await response.json();
  const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error("Resposta vazia do modelo Gemini ao analisar mensagem.");
  }

  return JSON.parse(rawJson) as AnalyzedMessage;
}

/**
 * Gera o vetor de embedding de 768 dimensoes usando text-embedding-004
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  embeddingModel = DEFAULT_EMBEDDING_MODEL
): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${embeddingModel}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${embeddingModel}`,
        content: {
          parts: [{ text }],
        },
        outputDimensionality: 768,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Erro ao gerar embedding (${response.status}): ${errText}`
    );
  }

  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Vetor de embedding invalido retornado pela API.");
  }

  return values;
}

/**
 * Verifica se a nova informacao enviada pelo usuario atualiza/substitui
 * alguma memoria ativa ja existente sobre o mesmo assunto.
 */
export async function checkTopicEvolution(
  newFact: string,
  newTopicKey: string,
  candidates: CandidateMemory[],
  apiKey: string,
  modelName = DEFAULT_GENERATION_MODEL
): Promise<{ supersedesId: string | null }> {
  if (!candidates || candidates.length === 0) {
    return { supersedesId: null };
  }

  const prompt = `Avalie se a NOVA INFORMAÇÃO enviada pelo usuário atualiza, corrige ou substitui alguma das MEMÓRIAS ATIVAS listadas abaixo (por exemplo: mudança de valor, mudança de data, mudança de senha, atualização de status do mesmo assunto).
Se ela for uma atualização do mesmo assunto de uma memória existente, retorne o "id" exato dessa memória em "supersedesId".
Se for um assunto diferente ou um fato que não substitui nenhum dos candidatos, retorne null em "supersedesId".

NOVA INFORMAÇÃO:
- Tópico: ${newTopicKey}
- Conteúdo: ${newFact}

MEMÓRIAS ATIVAS CANDIDATAS:
${JSON.stringify(candidates, null, 2)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              supersedesId: {
                type: "STRING",
                nullable: true,
              },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    return { supersedesId: null };
  }

  const data = await response.json();
  const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    return { supersedesId: null };
  }

  const parsed = JSON.parse(rawJson) as { supersedesId?: string | null };
  const validId = candidates.find((c) => c.id === parsed.supersedesId)?.id;
  return { supersedesId: validId ?? null };
}

/**
 * Formata a resposta de uma consulta (QUERY) de forma extremamente direta, curta e informal,
 * citando quando o usuario falou aquilo e indicando se houve alteracoes ao longo do tempo.
 */
export async function formatConversationalQueryAnswer(
  userQuestion: string,
  memories: RetrievedMemoryWithHistory[],
  nowIso: string,
  apiKey: string,
  modelName = DEFAULT_GENERATION_MODEL
): Promise<string> {
  if (!memories || memories.length === 0) {
    return "Dei uma olhada aqui e você ainda não me mandou nada sobre isso.";
  }

  const systemInstruction = `Você é o agente pessoal de memória do usuário no WhatsApp.
Regras obrigatórias de estilo de resposta:
1. Responda SEMPRE em texto curto, direto e totalmente informal (como um amigo respondendo rápido no WhatsApp, sem títulos, sem listas formais e sem emojis).
2. Informe sempre a última informação salva no banco de dados mencionando quando o usuário disse aquilo de forma natural. Use exemplos exatamente neste estilo:
   - "No dia dd/mm/aaaa você disse que..."
   - "No mês de [mês] você me falou que..."
   - "Há uns X dias atrás você me disse que..."
   - "Dia dd você me disse que..."
3. Se o campo "has_changes" for true (ou seja, existem registros em "version_history"), você DEVE indicar a última informação que está valendo agora E mencionar de forma natural que ela teve alteração ao longo do tempo (dizendo o que você tinha falado antes e em qual data).
   Exemplo com alteração: "No dia 16/10/2026 você me disse que o orçamento fechou em 15 mil. Antes disso, no dia 10/10/2026, você tinha me falado que era 12 mil."
4. Nunca invente informações que não estejam nos registros fornecidos. Se nenhum dos registros abaixo responder à pergunta do usuário, diga apenas: "Procurei aqui e você ainda não me falou nada sobre isso."`;

  const userPrompt = `Data/Hora Atual de Referência (Brasília): ${nowIso}
Pergunta do Usuário: "${userQuestion}"

Registros Encontrados no Banco de Memória (ordenados por relevância):
${JSON.stringify(memories, null, 2)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Erro ao formatar resposta de consulta (${response.status}): ${errText}`
    );
  }

  const data = await response.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return reply || "Procurei aqui e não encontrei nada salvo sobre isso.";
}
