-- Errata na própria planilha: linha nova, linha vermelha e linha removida.
--
-- Até aqui a errata só sabia corrigir R$ unitário e tipo de custo de uma
-- linha que já existia. O modo errata da Planilha Interna passa a criar e
-- apagar linha, e isso esbarra num acoplamento antigo: a planilha inteira
-- do job é chaveada por `versoes_orcamento_itens.id`. `jobs_itens_realizado`
-- e `itens_bv` são FK para lá, e `jobs_itens_orcado.item_versao_id` é NOT
-- NULL. Uma linha que nasce na errata NÃO tem contrapartida na versão — e
-- não deve ter: a versão é o registro do que o cliente aprovou.
--
-- A saída é a que o módulo de save já tomou (`saves_consumos` carrega as
-- duas chaves, e a abertura transfere uma para a outra): o realizado e o BV
-- passam a se pendurar na CÓPIA do job, `jobs_itens_orcado.id`.
--
-- Tudo aqui é aditivo. `item_versao_id` continua preenchido nas linhas que
-- vieram da versão — some só a obrigatoriedade, que a linha de errata não
-- tem como cumprir. O backfill foi conferido antes: 123 realizados e 6 BVs,
-- mapeamento 1:1, nenhum item de versão em mais de um job.

-- ---------------------------------------------------------------------
-- 1. A cópia do job aceita linha que não veio da versão
-- ---------------------------------------------------------------------

alter table public.jobs_itens_orcado
  alter column item_versao_id drop not null;

alter table public.jobs_itens_orcado
  add column if not exists linha_vermelha boolean not null default false,
  add column if not exists errata_origem_id uuid
    references public.jobs_erratas (id) on delete set null;

comment on column public.jobs_itens_orcado.item_versao_id is
  'Item de origem na versão aprovada. Nulo na linha criada por errata, que não existe na versão.';
comment on column public.jobs_itens_orcado.linha_vermelha is
  'Linha que só recebe REALIZADO, por PP. Orçado e planejado ficam zerados e não são editáveis.';
comment on column public.jobs_itens_orcado.errata_origem_id is
  'Errata que criou esta linha. Nulo na linha que veio da versão aprovada.';

-- A linha vermelha é, por definição, orçado e planejado zerados. A trava
-- fica no banco porque o total é o que alimenta valor do job e faturamento:
-- uma linha vermelha com orçado furaria os dois sem ninguém perceber.
--
-- A trava é no UNITÁRIO, não no total: `total_orcado` e `total_planejado`
-- são GENERATED ALWAYS a partir dele, e unitário zero já zera os dois.
alter table public.jobs_itens_orcado
  drop constraint if exists chk_jio_linha_vermelha_zerada;
alter table public.jobs_itens_orcado
  add constraint chk_jio_linha_vermelha_zerada check (
    not linha_vermelha
    or (valor_unitario_orcado = 0 and valor_unitario_planejado = 0)
  );

-- ---------------------------------------------------------------------
-- 2. Âncora do realizado na cópia do job
-- ---------------------------------------------------------------------

alter table public.jobs_itens_realizado
  add column if not exists job_item_orcado_id uuid
    references public.jobs_itens_orcado (id) on delete cascade;

update public.jobs_itens_realizado r
   set job_item_orcado_id = o.id
  from public.jobs_itens_orcado o
 where o.job_id = r.job_id
   and o.item_versao_id = r.item_id
   and r.job_item_orcado_id is null;

-- Uma âncora por linha da planilha — o mesmo papel que
-- `uniq_realizado_por_job_item` cumpria pela chave antiga.
create unique index if not exists uniq_realizado_por_copia
  on public.jobs_itens_realizado (job_id, job_item_orcado_id);

create index if not exists idx_realizado_copia
  on public.jobs_itens_realizado (job_item_orcado_id);

-- A linha de errata não tem item de versão a que se ligar.
alter table public.jobs_itens_realizado
  alter column item_id drop not null;

comment on column public.jobs_itens_realizado.job_item_orcado_id is
  'Linha da planilha do job a que este realizado pertence. Chave nova; `item_id` fica como rede das linhas vindas da versão.';

-- ---------------------------------------------------------------------
-- 3. O BV segue a mesma chave
-- ---------------------------------------------------------------------
-- O BV vive nos dois mundos: na planilha do orçamento ele é do item da
-- VERSÃO, e é assim que as telas de orçamento continuam lendo. No job ele
-- passa a ser da cópia — senão uma linha A criada por errata não teria
-- onde lançar comissão.

alter table public.itens_bv
  add column if not exists job_item_orcado_id uuid
    references public.jobs_itens_orcado (id) on delete cascade;

update public.itens_bv b
   set job_item_orcado_id = o.id
  from public.jobs_itens_orcado o
 where o.item_versao_id = b.item_versao_id
   and b.job_item_orcado_id is null;

create unique index if not exists uniq_bv_por_copia
  on public.itens_bv (job_item_orcado_id);

alter table public.itens_bv
  alter column item_versao_id drop not null;

comment on column public.itens_bv.job_item_orcado_id is
  'Linha da planilha do job. Preenchida quando o BV é do job; nula enquanto ele existe só na versão.';

-- ---------------------------------------------------------------------
-- 4. A errata registra o que fez com a linha
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'errata_acao') then
    create type public.errata_acao as enum ('alterada', 'nova', 'removida');
  end if;
end
$$;

alter table public.jobs_erratas_itens
  add column if not exists acao public.errata_acao not null default 'alterada',
  add column if not exists linha_vermelha boolean not null default false,
  add column if not exists quantidade_de numeric,
  add column if not exists quantidade_para numeric,
  add column if not exists dias_meses_de numeric,
  add column if not exists dias_meses_para numeric,
  add column if not exists grupo_id uuid
    references public.versoes_orcamento_grupos (id) on delete set null;

comment on column public.jobs_erratas_itens.acao is
  'O que a errata fez com a linha: corrigiu, criou ou removeu.';
comment on column public.jobs_erratas_itens.quantidade_de is
  'QT antes. Nula nas erratas anteriores a 27/08/2026, quando QT não era editável.';
comment on column public.jobs_erratas_itens.grupo_id is
  'Grupo da linha. `grupo_nome` continua congelado para o histórico sobreviver ao rename do grupo.';

-- ---------------------------------------------------------------------
-- 5. A errata devolve o job ao mural de abertura
-- ---------------------------------------------------------------------
-- O job NÃO muda de status: ele continua aberto, a produção continua
-- gerando PP e BV. O que a errata faz é reabrir a conferência do
-- financeiro — previsão de recebimento, curva de desembolso e competência
-- foram calculadas sobre números que a errata acabou de mudar. Enquanto a
-- revisão não é salva, o envio para faturamento fica fechado.

alter table public.jobs
  add column if not exists abertura_em_revisao boolean not null default false,
  add column if not exists abertura_revisao_desde timestamptz,
  add column if not exists abertura_revisao_errata_id uuid
    references public.jobs_erratas (id) on delete set null;

comment on column public.jobs.abertura_em_revisao is
  'Errata mexeu no orçado depois da abertura: o financeiro precisa reconferir. Some quando a abertura é salva de novo.';
comment on column public.jobs.abertura_revisao_desde is
  'Quando a revisão foi aberta pela errata.';
comment on column public.jobs.abertura_revisao_errata_id is
  'Errata que devolveu o job ao mural.';

-- O mural lê a fila por este filtro; sem índice ele varre `jobs` inteira.
create index if not exists idx_jobs_abertura_em_revisao
  on public.jobs (tenant_id, abertura_em_revisao)
  where abertura_em_revisao;

-- ---------------------------------------------------------------------
-- 6. Permissões — nada para `anon`
-- ---------------------------------------------------------------------

grant select, insert, update, delete on public.jobs_itens_orcado to authenticated;
grant select, insert, update, delete on public.jobs_itens_realizado to authenticated;
grant select, insert, update, delete on public.itens_bv to authenticated;
grant select, insert, update, delete on public.jobs_erratas_itens to authenticated;
grant select, update on public.jobs to authenticated;
