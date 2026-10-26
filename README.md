# Agente de Memoria Pessoal no WhatsApp (Arquitetura Cloud 24/7)

Sistema serverless de memoria episodica e semantica operado via WhatsApp (mensagens de texto e audio `.ogg`), inspirado na arquitetura de dupla camada do `ai-memory`. Executa 100% em nuvem gratuita (Supabase Edge Functions + PostgreSQL/`pgvector` + Meta WhatsApp Cloud API + Google Gemini API).

---

## 1. Estrutura do Repositorio

```text
|-- .env.example                                      # Template de variaveis de ambiente
|-- .gitignore                                       # Arquivos ignorados pelo Git
|-- package.json                                      # Scripts de diagnostico, testes e deploy
|-- README.md                                         # Documentacao oficial, setup e troubleshooting
|-- setup-env.mjs                                     # Carregador e sincronizador de variaveis (.env)
|-- check-apis.mjs                                    # Diagnostico de APIs (Gemini, Supabase e Meta)
|-- test-db.mjs                                       # Verificacao de tabelas, RPCs e Webhook na nuvem
|-- test-e2e-simulation.mjs                           # Simulacao E2E da Edge Function na nuvem
|-- test-local.mjs                                    # Suite de testes automatizados locais
`-- supabase/
    |-- migrations/
    |   `-- 20261016000000_init_memory_schema.sql    # Schema SQL (pgvector, tabelas, RRF, CTE historica)
    `-- functions/
        `-- whatsapp-webhook/
            |-- index.ts                              # Entrypoint da Edge Function (Webhooks GET/POST)
            |-- gemini.ts                             # Motor de IA (Gemini 2.5 Flash + gemini-embedding-001)
            `-- whatsapp.ts                           # Conector Meta WhatsApp Cloud API (v21.0)
```

---

## 2. Status Atual do Projeto e O Que Falta para Funcionar

### O que ja esta 100% implementado e verificado:
1. **Infraestrutura em Nuvem Pronta:**
   - Banco de Dados no Supabase configurado com extensao `vector`, tabela `raw_messages`, tabela `memories` e funcoes RPC (`find_candidate_memories_for_update`, `supersede_memory` e `search_memories_with_history`).
   - Edge Function `whatsapp-webhook` com deploy ativo no Supabase, recebendo webhooks da Meta com sucesso.
2. **Recebimento de Mensagens:**
   - Mensagens enviadas do seu WhatsApp pessoal chegam a nuvem, passam pela validacao de seguranca da allowlist e sao gravadas na integra no banco de dados.
3. **Classificacao e Busca Semantica:**
   - O Google Gemini analisa a mensagem (transcreve audio se necessario), classifica entre `STORE` e `QUERY`, gera os embeddings de 768 dimensoes via `gemini-embedding-001` e gerencia a evolucao temporal de fatos via `is_latest` e `supersedes_id`.

### Pontos de Desbloqueio para Producao:
1. **Chave da API Google Gemini (`GEMINI_API_KEY`):**
   - Caso a chave atual apresente saldo pre-pago esgotado (`402 RESOURCE_EXHAUSTED`), gere uma nova API Key gratuita no [Google AI Studio](https://aistudio.google.com/apikey) ou adicione saldo ao projeto.
2. **Token Permanente e Numero Brasileiro na Meta (`Error 130497` / `Error 190`):**
   - Ao tentar enviar a resposta de volta para o seu numero de WhatsApp no Brasil (`+55`) usando o numero de teste americano (`+1 555-678-3716`), a Meta bloqueia a entrega assincrona com o erro `130497: Business account is restricted from messaging users in this country`.
   - Alem disso, tokens temporarios de 24h expiram (`Error 190`). E necessario cadastrar um numero brasileiro (`+55`) e gerar um System User Token permanente.

---

## 3. Passo a Passo para Concluir a Aplicacao

Siga os passos abaixo na ordem indicada:

### Passo 1: Atualizar a Chave do Google Gemini (`GEMINI_API_KEY`)
1. Acesse o [Google AI Studio](https://aistudio.google.com/apikey).
2. Crie uma nova chave de API gratuita (Free Tier) ou recarregue os creditos do projeto atual.
3. Atualize o valor de `GEMINI_API_KEY` no seu arquivo `.env` local.

### Passo 2: Obter e Cadastrar um Numero Brasileiro (+55) na Meta
A Meta exige que o remetente seja um numero do Brasil para responder a usuarios brasileiros:
1. **Obter Linha (+55):** Utilize um numero fixo virtual/VoIP brasileiro (ex: Voip do Brasil, FalaHub, Twilio) ou um chip eSIM pre-pago exclusivo para o bot (capaz de receber SMS ou chamada de voz).
2. Acesse o painel [Meta for Developers](https://developers.facebook.com/) -> Aplicativo **MinhaMemoria** -> **WhatsApp** -> **API Setup**.
3. Em **Step 1: Select phone numbers**, clique em **Add phone number**.
4. Informe o Nome do Perfil (`Agente de Memoria`), insira o numero brasileiro (`+55...`) e valide o codigo de 6 digitos via SMS ou ligacao.
5. Copie o novo **Phone Number ID** gerado pela Meta.

### Passo 3: Gerar o Token Permanente (System User) na Meta
Para evitar que o bot pare de funcionar a cada 24 horas:
1. Acesse as [Configuracoes do Negocio da Meta](https://business.facebook.com/settings).
2. Navegue ate **Usuarios** -> **Usuarios do sistema** -> **Adicionar** (Nome: `AgenteMemoriaAdmin`, Funcao: *Admin*).
3. Clique em **Adicionar ativos** -> **Aplicativos** -> Selecione `MinhaMemoria` e marque **Controle total**.
4. Clique em **Gerar novo token**, selecione validade **Nunca** (*Never*) e marque as permissoes:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copie o token permanente gerado e atualize `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` no seu arquivo `.env`.

### Passo 4: Sincronizar Segredos no Supabase e Validar
Com o arquivo `.env` atualizado, sincronize os segredos na Edge Function do Supabase:
```powershell
npx supabase secrets set --project-ref iuwzoefqwuopftbwquij `
  GEMINI_API_KEY="SUA_NOVA_CHAVE_GEMINI" `
  WHATSAPP_PHONE_NUMBER_ID="NOVO_PHONE_NUMBER_ID_BRASILEIRO" `
  WHATSAPP_ACCESS_TOKEN="SEU_TOKEN_PERMANENTE"
```
Em seguida, rode a suite completa de verificacao local:
```powershell
npm test
npm run check:apis
npm run check:db
npm run test:e2e
```

---

## 4. Retrabalhos, Gotchas e Aprendizados

Durante o desenvolvimento da solucao, enfrentamos e contornamos particularidades criticas da infraestrutura:

1. **Modelo de Embedding da Google Cloud (`text-embedding-004` vs `gemini-embedding-001`):**
   - *Gotcha:* A especificacao original utilizava `text-embedding-004`. No entanto, na versao `v1beta` da API Gemini com chaves do Google AI Studio, o endpoint de embeddings retornou erro `404 Not Found`.
   - *Correcao:* Inspecionamos os modelos disponiveis via API e ajustamos para o modelo oficial `gemini-embedding-001`, configurando `outputDimensionality: 768` para manter total compatibilidade com o indice HNSW do PostgreSQL.

2. **Assinatura Explicita de Webhooks na WABA (`Subscribed Apps` e `Fields`):**
   - *Gotcha:* Apenas configurar a URL do Webhook no painel de desenvolvedores nao e suficiente. As mensagens enviadas pelo celular nao chegavam a nuvem.
   - *Correcao:* Foi necessario enviar requisicoes diretas via Graph API para inscrever o aplicativo na WABA (`POST /{waba_id}/subscribed_apps`) e assinar formalmente o campo `messages` na subscricao (`POST /{app_id}/subscriptions` com `fields=messages`).

3. **Chave de Servico no Supabase (`SUPABASE_SERVICE_ROLE_KEY`):**
   - *Gotcha:* O Supabase impede via API o cadastro manual de variaveis iniciadas pelo prefixo reservado `SUPABASE_`.
   - *Correcao:* Injetamos a chave JWT sob a variavel `CUSTOM_SERVICE_ROLE_KEY` e ajustamos o `index.ts` para realizar o fallback automatico:
     ```typescript
     const supabaseServiceKey = Deno.env.get("CUSTOM_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
     ```

4. **Normalizacao do 9o Digito no Brasil:**
   - *Gotcha:* Operadoras e a Meta alternam o envio do numero remetente com 8 ou 9 digitos apos o DDD (ex: `551599734...` vs `55159734...`), o que causava rejeicao indevida na allowlist.
   - *Correcao:* A funcao `isAuthorizedPhone` foi construida para comparar os primeiros 4 digitos (DDI + DDD) e os ultimos 8 digitos, aceitando o numero independentemente da presenca do 9o digito.

5. **Auditoria Assincrona de Entregas da Meta (`statuses`):**
   - *Gotcha:* Chamadas de envio para a Meta retornam `200 OK` (apenas indicando que o payload foi aceito na fila), mas o descarte real ocorre segundos depois de forma assincrona.
   - *Correcao:* Criamos a tabela `webhook_debug_logs` e configuramos a Edge Function para registrar todos os callbacks assincronos da Meta, o que nos permitiu capturar o erro exato `130497`.

---

## 5. Como Rodar e Testar em Qualquer Computador

Como toda a arquitetura e serverless (executa no Supabase e na Meta), este projeto **nao depende de servidores locais ligados**.

1. **Pre-requisitos:**
   - [Node.js](https://nodejs.org/) (versao 18 ou superior).
   - [Supabase CLI](https://supabase.com/docs/guides/cli) (ou executando via `npx supabase`).

2. **Clonar o Repositorio:**
   ```bash
   git clone https://github.com/viniciushzao/whatsapp-ai-memory.git
   cd whatsapp-ai-memory
   ```

3. **Comandos NPM Disponiveis:**
   - `npm test` — Executa os testes unitarios locais em memoria (Allowlist 9o digito, dupla camada, versionamento `supersedes_id` e busca RRF com historico).
   - `npm run setup:env` — Sincroniza as chaves de API do Supabase diretamente no arquivo `.env`.
   - `npm run check:apis` — Diagnostica a conectividade e validade das chaves do Gemini, Supabase e Meta Graph API.
   - `npm run check:db` — Verifica tabelas, RPCs, logs de webhook e responde ao challenge GET da Edge Function.
   - `npm run test:e2e` — Dispara uma simulacao real de payload de mensagem POST contra a Edge Function na nuvem.
   - `npm run deploy` — Faz o deploy atualizado da Edge Function `whatsapp-webhook`.
