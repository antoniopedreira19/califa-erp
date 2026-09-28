-- Decisão 114 (parte 2) — o projeto troca o primeiro zero por P, e o
-- projeto do financeiro por F.
--
-- O formato "[SIGLA]-[SEQ_4]/[AA]" passou a ser o do job (migration
-- 20260928200001). Para nenhum código de job, de projeto e do financeiro
-- jamais ser igual, o projeto troca o primeiro zero do número por uma
-- letra, e o número fica o mesmo (Tiago, 28/09/2026):
--   * projeto da produção:  AMB-0006/26    → AMB-P006/26
--   * orçamento acompanha:  AMB-0006/26-01 → AMB-P006/26-01
--   * projeto do financeiro: AMB-0004/26   → AMB-F004/26
-- Os dois cadastros de projeto continuam separados, cada um com a sua
-- numeração: o financeiro agrupa os jobs do jeito dele. Hoje 8 códigos
-- existem nos dois lados apontando para projetos diferentes; a letra
-- desfaz a coincidência.
--
-- ⚠️ DESTRUTIVA: sobrescreve `projetos.codigo`, `orcamentos.codigo` e
-- `projetos_financeiro.codigo`. O código de antes fica em `codigo_anterior`
-- (coluna nova nas três), e cada troca vira um evento `*.codigo_trocado`
-- na auditoria. Aplicar junto da 20260928200001, na hora combinada com a
-- frente do Antonio, com o código da decisão 114 publicado em seguida.
--
-- Levantado em 28/09/2026: os 16 projetos, 39 orçamentos e 17 projetos do
-- financeiro estão todos no formato "[SIGLA]-0NNN/AA" (e o orçamento com
-- "-NN" no fim); todo orçamento começa com o código do próprio projeto;
-- nenhuma função ou view do banco monta ou lê o formato — as views só
-- repassam a coluna. O resto do banco aponta para projeto e orçamento pela
-- chave. As planilhas exportadas voltam pelo Importar como antes: o
-- Importar acha os orçamentos pelos ids escondidos, não pelo código.

-- 1. O código de antes da troca — aditivo. Sem índice: tabelas pequenas,
--    e as buscas por projeto filtram na tela.
alter table public.projetos add column if not exists codigo_anterior text;
alter table public.orcamentos add column if not exists codigo_anterior text;
alter table public.projetos_financeiro add column if not exists codigo_anterior text;

comment on column public.projetos.codigo_anterior is
  'Código do projeto antes da decisão 114 (AMB-0006/26, hoje AMB-P006/26). Planilhas e conversas anteriores a 28/09/2026 citam este código; a busca de projetos também olha esta coluna. Nulo nos projetos criados depois da troca.';
comment on column public.orcamentos.codigo_anterior is
  'Código do orçamento antes da decisão 114 (AMB-0006/26-01, hoje AMB-P006/26-01). Nulo nos orçamentos criados depois da troca.';
comment on column public.projetos_financeiro.codigo_anterior is
  'Código do projeto do financeiro antes da decisão 114 (AMB-0004/26, hoje AMB-F004/26). A busca de projeto da abertura também olha esta coluna. Nulo nos projetos criados depois da troca.';

-- 2. A troca. Só o primeiro zero depois do hífen vira letra; o resto do
--    código fica igual. O código novo nunca é igual a um "0NNN", então os
--    índices únicos (tenant_id, codigo) não esbarram no meio do update.
update public.projetos
set
  codigo_anterior = codigo,
  codigo = regexp_replace(codigo, '^([A-Z0-9]+)-0([0-9]{3})/([0-9]{2})$', '\1-P\2/\3')
where codigo ~ '^[A-Z0-9]+-0[0-9]{3}/[0-9]{2}$';

update public.orcamentos
set
  codigo_anterior = codigo,
  codigo = regexp_replace(codigo, '^([A-Z0-9]+)-0([0-9]{3})/([0-9]{2})-([0-9]{2})$', '\1-P\2/\3-\4')
where codigo ~ '^[A-Z0-9]+-0[0-9]{3}/[0-9]{2}-[0-9]{2}$';

update public.projetos_financeiro
set
  codigo_anterior = codigo,
  codigo = regexp_replace(codigo, '^([A-Z0-9]+)-0([0-9]{3})/([0-9]{2})$', '\1-F\2/\3')
where codigo ~ '^[A-Z0-9]+-0[0-9]{3}/[0-9]{2}$';

-- 3. Auditoria: um evento por código trocado.
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select p.tenant_id, null::uuid, 'projeto.codigo_trocado', 'projeto', p.id::text,
       jsonb_build_object('codigo_anterior', p.codigo_anterior, 'codigo', p.codigo, 'decisao', '114')
from public.projetos p
where p.codigo_anterior ~ '^[A-Z0-9]+-0[0-9]{3}/[0-9]{2}$'
union all
select o.tenant_id, null::uuid, 'orcamento.codigo_trocado', 'orcamento', o.id::text,
       jsonb_build_object('codigo_anterior', o.codigo_anterior, 'codigo', o.codigo, 'decisao', '114')
from public.orcamentos o
where o.codigo_anterior ~ '^[A-Z0-9]+-0[0-9]{3}/[0-9]{2}-[0-9]{2}$'
union all
select f.tenant_id, null::uuid, 'projeto_financeiro.codigo_trocado', 'projeto_financeiro', f.id::text,
       jsonb_build_object('codigo_anterior', f.codigo_anterior, 'codigo', f.codigo, 'decisao', '114')
from public.projetos_financeiro f
where f.codigo_anterior ~ '^[A-Z0-9]+-0[0-9]{3}/[0-9]{2}$';

-- 4. Conferência: nenhum código ficou no formato antigo, e todo orçamento
--    continua começando pelo código do próprio projeto.
do $$
begin
  if exists (select 1 from public.projetos where codigo ~ '^[A-Z0-9]+-[0-9]{4}/[0-9]{2}$')
     or exists (select 1 from public.projetos_financeiro where codigo ~ '^[A-Z0-9]+-[0-9]{4}/[0-9]{2}$')
     or exists (select 1 from public.orcamentos where codigo ~ '^[A-Z0-9]+-[0-9]{4}/[0-9]{2}-[0-9]{2}$') then
    raise exception 'Ainda há projeto ou orçamento com o código no formato antigo depois da troca.';
  end if;
  if exists (
    select 1
    from public.orcamentos o
    join public.projetos p on p.id = o.projeto_id
    where left(o.codigo, length(p.codigo) + 1) <> p.codigo || '-'
  ) then
    raise exception 'Há orçamento que não começa pelo código do próprio projeto depois da troca.';
  end if;
end;
$$;
