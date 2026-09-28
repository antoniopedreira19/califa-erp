-- Decisão 114 — o código do job passa de JOB-NNNN para [SIGLA]-[SEQ_4]/[AA].
--
-- O formato que nomeava os projetos (AMB-0006/26) passa a nomear os jobs
-- (Tiago, 28/09/2026):
--   * SIGLA: o código curto ATUAL do cliente do projeto do job — não a
--     sigla gravada no código do projeto, que envelhece quando o projeto
--     troca de cliente (o HIT-0001/26 é da Universal, UER);
--   * AA: o ano em que o job foi criado, no fuso de São Paulo;
--   * SEQ: a ordem de criação dentro da sigla e do ano. Em 2026 começa em
--     1001 — o "1 no lugar do primeiro 0": o outro sistema da agência abre
--     jobs no mesmo formato e ainda não chegou no milhar, e assim nenhum
--     código se repete entre os dois. De 2027 em diante, 0001.
--
-- Cancelados e devolvidos também ganham código novo: a linha existe e o
-- número dela já foi visto.
--
-- ⚠️ DESTRUTIVA: sobrescreve `jobs.codigo`. O código anterior fica em
-- `jobs.codigo_anterior` (coluna nova), e cada troca vira um evento
-- `job.codigo_trocado` na auditoria. Aplicar só na hora combinada com a
-- frente do Antonio, com o código da decisão 114 publicado em seguida: as
-- telas novas leem `codigo_anterior`, e o gerador antigo (JOB-%) deixa de
-- achar códigos depois da troca.
--
-- Nada fora de `jobs.codigo` guarda o código como texto (levantado em
-- 28/09/2026): o resto do banco aponta para o job pela chave. O histórico
-- de auditoria e os arquivos já emitidos ficam com o código antigo.

-- 1. O código de antes da troca — aditivo.
alter table public.jobs add column if not exists codigo_anterior text;

comment on column public.jobs.codigo_anterior is
  'Código do job antes da decisão 114 (JOB-NNNN). PDFs, planilhas e conversas anteriores a 28/09/2026 citam este código; as buscas de job também olham esta coluna. Nulo nos jobs criados depois da troca.';

-- A busca pelo código anterior filtra por tenant; poucas linhas preenchidas.
create index if not exists idx_jobs_codigo_anterior
  on public.jobs (tenant_id, codigo_anterior)
  where codigo_anterior is not null;

-- 2. A troca. O código novo nunca é igual a um JOB-NNNN, então o índice
--    único (tenant_id, codigo) não esbarra no meio do update.
with depara as (
  select
    j.id,
    c.codigo_curto as sigla,
    to_char(j.created_at at time zone 'America/Sao_Paulo', 'YY') as ano,
    row_number() over (
      partition by
        j.tenant_id,
        c.codigo_curto,
        to_char(j.created_at at time zone 'America/Sao_Paulo', 'YY')
      order by j.created_at, j.codigo
    ) as ordem
  from public.jobs j
  join public.projetos p on p.id = j.projeto_id
  join public.clientes c on c.id = p.cliente_id
  where j.codigo ~ '^JOB-[0-9]+$'
)
update public.jobs j
set
  codigo_anterior = j.codigo,
  codigo = d.sigla || '-'
    || lpad(((case when d.ano = '26' then 1000 else 0 end) + d.ordem)::text, 4, '0')
    || '/' || d.ano
from depara d
where d.id = j.id;

-- 3. Auditoria: um evento por job trocado.
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select
  j.tenant_id,
  null,
  'job.codigo_trocado',
  'job',
  j.id::text,
  jsonb_build_object('codigo_anterior', j.codigo_anterior, 'codigo', j.codigo, 'decisao', '114')
from public.jobs j
where j.codigo_anterior ~ '^JOB-[0-9]+$';

-- 4. Conferência: nenhum job ficou no formato antigo (cliente sem código
--    curto deixaria o código nulo e o update já teria falhado no NOT NULL).
do $$
begin
  if exists (select 1 from public.jobs where codigo ~ '^JOB-[0-9]+$') then
    raise exception 'Ainda há job com código JOB-NNNN depois da troca.';
  end if;
end;
$$;
