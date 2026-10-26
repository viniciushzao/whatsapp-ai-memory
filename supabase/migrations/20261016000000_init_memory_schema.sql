-- Habilita a extensao pgvector para busca semantica
create extension if not exists vector;

-- ============================================================================
-- CAMADA 1: LOG EPISODICO BRUTO (raw_messages)
-- Registra de forma imutavel cada mensagem de texto ou audio enviada no WhatsApp
-- ============================================================================
create table if not exists public.raw_messages (
    id uuid primary key default gen_random_uuid(),
    whatsapp_message_id text unique not null,
    sender_phone text not null,
    media_type text not null check (media_type in ('text', 'audio')),
    raw_content text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_raw_messages_sender_created
    on public.raw_messages (sender_phone, created_at desc);

-- ============================================================================
-- CAMADA 2: FATOS SEMANTICOS VERSIONADOS (memories)
-- Inspirado na arquitetura do ai-memory: is_latest + cadeia supersedes_id
-- ============================================================================
create table if not exists public.memories (
    id uuid primary key default gen_random_uuid(),
    raw_message_id uuid references public.raw_messages(id) on delete set null,
    sender_phone text not null,
    topic_key text not null,
    category text not null check (category in ('fato', 'regra', 'gotcha', 'decisao', 'financeiro', 'lembrete', 'pessoal', 'projeto')),
    content text not null,
    embedding vector(768) not null,
    fts tsvector generated always as (to_tsvector('portuguese', coalesce(topic_key, '') || ' ' || coalesce(content, ''))) stored,
    is_latest boolean not null default true,
    supersedes_id uuid references public.memories(id) on delete set null,
    created_at timestamptz not null default now()
);

-- Indices para busca hibrida (Dense HNSW + Sparse GIN FTS) e filtragem temporal
create index if not exists idx_memories_embedding_hnsw
    on public.memories using hnsw (embedding vector_cosine_ops);

create index if not exists idx_memories_fts_gin
    on public.memories using gin (fts);

create index if not exists idx_memories_latest_sender
    on public.memories (sender_phone, is_latest, created_at desc);

create index if not exists idx_memories_supersedes
    on public.memories (supersedes_id);

-- ============================================================================
-- AUDITORIA E DEBUG: LOG DE WEBHOOKS (webhook_debug_logs)
-- Registra eventos assincronos da Meta (mensagens recebidas, status de entrega, erros)
-- ============================================================================
create table if not exists public.webhook_debug_logs (
    id bigint generated always as identity primary key,
    payload jsonb not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_webhook_debug_logs_created_at
    on public.webhook_debug_logs (created_at desc);

-- ============================================================================
-- FUNCAO RPC 1: Buscar memorias ativas candidatas sobre o mesmo assunto
-- Usada no momento do STORE para detectar se o usuario esta atualizando algo antigo
-- ============================================================================
create or replace function public.find_candidate_memories_for_update(
    p_sender_phone text,
    p_topic_key text,
    p_query_embedding vector(768),
    p_match_count int default 5
)
returns table (
    id uuid,
    topic_key text,
    category text,
    content text,
    similarity float,
    created_at timestamptz
)
language sql
stable
as $$
    select
        m.id,
        m.topic_key,
        m.category,
        m.content,
        1 - (m.embedding <=> p_query_embedding) as similarity,
        m.created_at
    from public.memories m
    where m.sender_phone = p_sender_phone
      and m.is_latest = true
      and (
          lower(m.topic_key) = lower(p_topic_key)
          or (1 - (m.embedding <=> p_query_embedding)) >= 0.72
      )
    order by
        case when lower(m.topic_key) = lower(p_topic_key) then 0 else 1 end,
        m.embedding <=> p_query_embedding asc
    limit p_match_count;
$$;

-- ============================================================================
-- FUNCAO RPC 2: Inserir nova versao de uma memoria substituindo a anterior
-- Garante atomicidade ao atualizar is_latest = false na antiga e criar a nova
-- ============================================================================
create or replace function public.supersede_memory(
    p_old_memory_id uuid,
    p_raw_message_id uuid,
    p_sender_phone text,
    p_topic_key text,
    p_category text,
    p_content text,
    p_embedding vector(768)
)
returns uuid
language plpgsql
security definer
as $$
declare
    v_new_id uuid;
begin
    update public.memories
       set is_latest = false
     where id = p_old_memory_id
       and sender_phone = p_sender_phone;

    insert into public.memories (
        raw_message_id,
        sender_phone,
        topic_key,
        category,
        content,
        embedding,
        is_latest,
        supersedes_id
    ) values (
        p_raw_message_id,
        p_sender_phone,
        p_topic_key,
        p_category,
        p_content,
        p_embedding,
        true,
        p_old_memory_id
    )
    returning id into v_new_id;

    return v_new_id;
end;
$$;

-- ============================================================================
-- FUNCAO RPC 3: Busca Hibrida (RRF k=60) + Historico Completo de Alteracoes
-- Combina busca semantica (pgvector) + busca lexica (FTS) e reconstroi a cadeia
-- de versoes anteriores (supersedes_id) para informar mudancas ao longo do tempo
-- ============================================================================
create or replace function public.search_memories_with_history(
    p_sender_phone text,
    p_query_text text,
    p_query_embedding vector(768),
    p_match_count int default 5,
    p_rrf_k int default 60
)
returns table (
    memory_id uuid,
    topic_key text,
    category text,
    latest_content text,
    latest_created_at timestamptz,
    rrf_score float,
    has_changes boolean,
    version_history jsonb
)
language sql
stable
as $$
with semantic_search as (
    select
        m.id,
        row_number() over (order by m.embedding <=> p_query_embedding asc) as rank_ix
    from public.memories m
    where m.sender_phone = p_sender_phone
      and m.is_latest = true
    order by m.embedding <=> p_query_embedding asc
    limit 25
),
lexical_search as (
    select
        m.id,
        row_number() over (
            order by ts_rank_cd(m.fts, websearch_to_tsquery('portuguese', p_query_text)) desc
        ) as rank_ix
    from public.memories m
    where m.sender_phone = p_sender_phone
      and m.is_latest = true
      and m.fts @@ websearch_to_tsquery('portuguese', p_query_text)
    limit 25
),
rrf_combined as (
    select
        coalesce(s.id, l.id) as id,
        coalesce(1.0 / (p_rrf_k + s.rank_ix), 0.0) +
        coalesce(1.0 / (p_rrf_k + l.rank_ix), 0.0) as score
    from semantic_search s
    full outer join lexical_search l on s.id = l.id
    order by score desc
    limit p_match_count
)
select
    m.id as memory_id,
    m.topic_key,
    m.category,
    m.content as latest_content,
    m.created_at as latest_created_at,
    r.score as rrf_score,
    (m.supersedes_id is not null) as has_changes,
    coalesce(
        (
            with recursive history_chain as (
                select
                    prev.id,
                    prev.content,
                    prev.created_at,
                    prev.supersedes_id,
                    1 as depth
                from public.memories prev
                where prev.id = m.supersedes_id
                union all
                select
                    older.id,
                    older.content,
                    older.created_at,
                    older.supersedes_id,
                    hc.depth + 1
                from public.memories older
                join history_chain hc on older.id = hc.supersedes_id
                where hc.depth < 20
            )
            select jsonb_agg(
                jsonb_build_object(
                    'id', hc.id,
                    'content', hc.content,
                    'created_at', hc.created_at
                )
                order by hc.created_at asc
            )
            from history_chain hc
        ),
        '[]'::jsonb
    ) as version_history
from rrf_combined r
join public.memories m on m.id = r.id
order by r.score desc;
$$;
