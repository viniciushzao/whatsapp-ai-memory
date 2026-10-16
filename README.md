# Agente de Memoria Pessoal no WhatsApp (Arquitetura Cloud 24/7)

Sistema serverless de memoria episodica e semantica operado via WhatsApp (mensagens de texto e audio `.ogg`), inspirado na arquitetura de dupla camada do `ai-memory`. Executa 100% em nuvem gratuita (Supabase Edge Functions + PostgreSQL/`pgvector` + Meta WhatsApp Cloud API + Google Gemini API).

---

## 1. Estrutura do Repositorio

```text
|-- .env.example                                      # Template de variaveis de ambiente
|-- .gitignore                                       # Arquivos ignorados pelo Git
|-- README.md                                         # Documentacao oficial, setup e troubleshooting
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

### O unico ponto de bloqueio atual (O Erro 130497 da Meta):
Ao tentar enviar a resposta de volta para o seu numero de WhatsApp no Brasil (`+55`), a Meta bloqueia a entrega assincrona com o erro:
> `Error 130497: Business account is restricted from messaging users in this country.`

**Causa:** O numero remetente padrao da Meta e um numero virtual de teste dos EUA (`+1 555-678-3716`). A politica de integridade anti-spam da Meta proibe contas de teste nao verificadas dos EUA de enviarem mensagens para numeros brasileiros (`+55`).

---

## 3. Passo a Passo para Concluir a Aplicacao

Para desbloquear o envio de respostas no WhatsApp, siga os passos abaixo:

### Passo 1: Obter um Numero Virtual ou Linha Brasileira (+55)
A Meta exige que o remetente seja um numero do Brasil para responder a usuarios brasileiros.
- **Opcao 1 (Numero Fixo Virtual / VoIP - Recomendado):** Contrate um numero fixo virtual brasileiro (ex: via Voip do Brasil, FalaHub ou Twilio). O custo medio e de R$ 15 a R$ 30/mes e dispensa qualquer chip fisico.
- **Opcao 2 (eSIM / Chip Digital):** Instale uma linha pre-paga digital via eSIM no seu proprio smartphone.
- *Requisito:* O numero precisa apenas ser capaz de receber uma **chamada de voz** ou um **SMS** com o codigo de verificacao de 6 digitos da Meta.

### Passo 2: Cadastrar o Numero na Meta Cloud API
1. Acesse o painel [Meta for Developers](https://developers.facebook.com/) -> Aplicativo **MinhaMemoria**.
2. No menu lateral, acesse **WhatsApp** -> **API Setup**.
3. Na secao **Step 1: Select phone numbers**, clique em **Add phone number**.
4. Informe o Nome do Perfil (ex: `Agente de Memoria`) e digite o numero brasileiro (`+55...`).
5. Selecione o metodo de verificacao (**Ligacao telefonica** para numeros VoIP/Fixos ou **SMS** para celulares).
6. Digite o codigo de 6 digitos recebido para validar a titularidade.
7. Apos a validacao, a Meta gerara um novo **Phone Number ID**. Copie esse identificador.

### Passo 3: Gerar o Token Permanente (System User)
Para evitar que o bot pare de funcionar quando o token temporario expirar:
1. Acesse as [Configuracoes do Negocio da Meta](https://business.facebook.com/settings).
2. Va em **Usuarios** -> **Usuarios do sistema** -> **Adicionar** (Nome: `AgenteMemoriaAdmin`, Funcao: *Admin*).
3. Clique em **Adicionar ativos** -> **Aplicativos** -> Selecione `MinhaMemoria` e conceda controle total.
4. Clique em **Gerar novo token**, selecione validade **Nunca** (*Never*) e marque as permissoes:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copie o token permanente gerado.

### Passo 4: Atualizar as Variaveis no Supabase
Atualize os segredos no painel do Supabase (**Project Settings** -> **Edge Functions** -> **Secrets**) ou via CLI:
```powershell
npx supabase secrets set `
  WHATSAPP_PHONE_NUMBER_ID="NOVO_PHONE_NUMBER_ID_BRASILEIRO" `
  WHATSAPP_ACCESS_TOKEN="SEU_TOKEN_PERMANENTE"
```

A partir desse momento, a restricao 130497 desaparece e o agente respondera instantaneamente no seu WhatsApp.

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

Para gerenciar, testar ou evoluir o codigo em qualquer nova maquina:

1. **Pre-requisitos:**
   - [Node.js](https://nodejs.org/) (versao 18 ou superior).
   - [Supabase CLI](https://supabase.com/docs/guides/cli) (ou executando via `npx supabase`).

2. **Clonar o Repositorio:**
   ```bash
   git clone https://github.com/viniciushzao/whatsapp-ai-memory.git
   cd whatsapp-ai-memory
   ```

3. **Executar Testes Unitarios Locais:**
   Os testes locais validam a allowlist com o 9o digito brasileiro, a gravacao em dupla camada e o algoritmo de versionamento temporal (`supersedes_id`):
   ```bash
   node test-local.mjs
   ```

4. **Fazer Deploy de Alteracoes nas Edge Functions:**
   ```bash
   npx supabase login
   npx supabase link --project-ref iuwzoefqwuopftbwquij
   npx supabase functions deploy whatsapp-webhook --no-verify-jwt
   ```
