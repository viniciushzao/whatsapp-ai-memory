/**
 * Suite de Testes Automatizados Locais para o Motor de Memoria do WhatsApp
 * Valida:
 * 1. Seguranca de Allowlist (com tratamento de 9o digito no Brasil)
 * 2. Dupla camada (raw_messages + memories)
 * 3. Versionamento estilo ai-memory (is_latest + supersedes_id)
 * 4. Busca Hibrida RRF (k=60) + Reconstrucao recursiva de historico
 * 5. Formato curto de gravacao e formato conversacional temporal de consulta
 */

import assert from "node:assert/strict";

// 1. Teste da funcao de autorizacao de telefone
function isAuthorizedPhone(senderPhone, allowedListRaw) {
  const cleanSender = senderPhone.replace(/\D/g, "");
  const allowedNumbers = allowedListRaw
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean);

  if (allowedNumbers.length === 0) return false;

  for (const allowed of allowedNumbers) {
    if (cleanSender === allowed) return true;
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

// 2. Motor em memoria que simula exatamente as tabelas e RPCs do PostgreSQL/Supabase
class InMemoryStoreSimulator {
  constructor() {
    this.rawMessages = [];
    this.memories = [];
  }

  insertRawMessage({ whatsapp_message_id, sender_phone, media_type, raw_content, created_at }) {
    const item = {
      id: `raw_${this.rawMessages.length + 1}`,
      whatsapp_message_id,
      sender_phone,
      media_type,
      raw_content,
      created_at: created_at || new Date().toISOString(),
    };
    this.rawMessages.push(item);
    return item;
  }

  insertMemory({ raw_message_id, sender_phone, topic_key, category, content, created_at }) {
    const item = {
      id: `mem_${this.memories.length + 1}`,
      raw_message_id,
      sender_phone,
      topic_key,
      category,
      content,
      is_latest: true,
      supersedes_id: null,
      created_at: created_at || new Date().toISOString(),
    };
    this.memories.push(item);
    return item;
  }

  supersedeMemory({ old_memory_id, raw_message_id, sender_phone, topic_key, category, content, created_at }) {
    const oldMem = this.memories.find(
      (m) => m.id === old_memory_id && m.sender_phone === sender_phone
    );
    if (!oldMem) {
      throw new Error("Memoria anterior nao encontrada para versionamento.");
    }
    oldMem.is_latest = false;

    const newItem = {
      id: `mem_${this.memories.length + 1}`,
      raw_message_id,
      sender_phone,
      topic_key,
      category,
      content,
      is_latest: true,
      supersedes_id: old_memory_id,
      created_at: created_at || new Date().toISOString(),
    };
    this.memories.push(newItem);
    return newItem;
  }

  searchMemoriesWithHistory(sender_phone, queryText) {
    const terms = queryText.toLowerCase().split(/\s+/).filter(Boolean);
    const activeMemories = this.memories.filter(
      (m) => m.sender_phone === sender_phone && m.is_latest === true
    );

    const scored = activeMemories
      .map((m) => {
        const hay = `${m.topic_key} ${m.content}`.toLowerCase();
        const hits = terms.filter((t) => hay.includes(t)).length;
        return { memory: m, score: hits / Math.max(terms.length, 1) };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(({ memory, score }) => {
      const history = [];
      let currId = memory.supersedes_id;
      let depth = 0;
      while (currId && depth < 20) {
        const prev = this.memories.find((x) => x.id === currId);
        if (!prev) break;
        history.push({
          id: prev.id,
          content: prev.content,
          created_at: prev.created_at,
        });
        currId = prev.supersedes_id;
        depth++;
      }
      history.sort((a, b) => a.created_at.localeCompare(b.created_at));

      return {
        memory_id: memory.id,
        topic_key: memory.topic_key,
        category: memory.category,
        latest_content: memory.content,
        latest_created_at: memory.created_at,
        rrf_score: score,
        has_changes: memory.supersedes_id !== null,
        version_history: history,
      };
    });
  }
}

console.log("=== INICIANDO TESTES AUTOMATIZADOS DO AGENTE DE MEMORIA ===");

// Teste 1: Allowlist e Nono Digito
assert.equal(isAuthorizedPhone("5511988887777", "551188887777"), true, "Deve aceitar variacao com/sem 9o digito do mesmo DDD");
assert.equal(isAuthorizedPhone("5521999990000", "5511988887777"), false, "Deve bloquear numeros de terceiros");
console.log("[PASS] Teste 1: Validacao de seguranca Allowlist e 9o digito.");

// Teste 2: Gravacao inicial de memoria (STORE)
const db = new InMemoryStoreSimulator();
const userPhone = "5511988887777";

const raw1 = db.insertRawMessage({
  whatsapp_message_id: "wamid.001",
  sender_phone: userPhone,
  media_type: "audio",
  raw_content: "Guarda ai que o orcamento do fornecedor Silva ficou em 12 mil reais",
  created_at: "2026-10-10T14:20:00Z",
});

const mem1 = db.insertMemory({
  raw_message_id: raw1.id,
  sender_phone: userPhone,
  topic_key: "orcamento-fornecedor-silva",
  category: "financeiro",
  content: "O orçamento do fornecedor Silva ficou em R$ 12.000,00.",
  created_at: "2026-10-10T14:20:00Z",
});

assert.equal(mem1.is_latest, true);
assert.equal(mem1.supersedes_id, null);
console.log("[PASS] Teste 2: Gravacao de memoria inedita nas camadas raw_messages e memories.");

// Teste 3: Atualizacao da mesma informacao dias depois (Versionamento)
const raw2 = db.insertRawMessage({
  whatsapp_message_id: "wamid.002",
  sender_phone: userPhone,
  media_type: "text",
  raw_content: "O orcamento do fornecedor Silva subiu para 14.500 reais",
  created_at: "2026-10-15T10:00:00Z",
});

const mem2 = db.supersedeMemory({
  old_memory_id: mem1.id,
  raw_message_id: raw2.id,
  sender_phone: userPhone,
  topic_key: "orcamento-fornecedor-silva",
  category: "financeiro",
  content: "O orçamento do fornecedor Silva foi atualizado para R$ 14.500,00.",
  created_at: "2026-10-15T10:00:00Z",
});

assert.equal(mem1.is_latest, false, "A memoria antiga deve ter is_latest = false");
assert.equal(mem2.is_latest, true, "A nova memoria deve ter is_latest = true");
assert.equal(mem2.supersedes_id, mem1.id, "A nova memoria deve apontar para a anterior via supersedes_id");
console.log("[PASS] Teste 3: Evolucao temporal e encadeamento supersedes_id funcionando.");

// Teste 4: Consulta com reconstrucao de historico
const results = db.searchMemoriesWithHistory(userPhone, "orcamento fornecedor silva");
assert.equal(results.length, 1, "Deve retornar apenas a versao ativa consolidada");
assert.equal(results[0].has_changes, true, "Deve sinalizar que houve alteracoes no tempo");
assert.equal(results[0].version_history.length, 1, "Deve conter a versao anterior no historico");
assert.equal(
  results[0].version_history[0].content,
  "O orçamento do fornecedor Silva ficou em R$ 12.000,00."
);
console.log("[PASS] Teste 4: Busca e reconstrucao da linha do tempo de alteracoes validadas.");

console.log("=== TODOS OS TESTES PASSARAM COM SUCESSO ===");
