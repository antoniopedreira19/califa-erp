-- Decisão de produto (2026-11-25, RH): todo abono (inclusive avulso)
-- deve abater do saldo de um aquisitivo específico. A diferença entre
-- abono_avulso e usufruto NUNCA foi "saldo de férias" — é apenas
-- comportamento de folha (usufruto antecipa salário do mês; abono paga
-- como extra por fora). O schema original tinha essa confusão: forçava
-- `abono_avulso` com `periodo_id = null`, e por isso venda de 10 dias
-- não derrubava saldo de ninguém.
--
-- Casos vivos encontrados (consulta de 25/11/2026):
--   1. Lanc ed6136bc... — concluido, 10d, aquisitivo 7 2025/2026 (saldo 17→7)
--   2. Lanc 52bbe832... — concluido, 10d, aquisitivo 3 2025/2026 (saldo 10→0, em_alerta)
--   3. Lanc 5ea40718... — concluido, 10d, aquisitivo 3 2025/2026 (saldo 20→10)
--   4. Lanc b604a062... — aguardando_gestor, 10d, aquisitivo 3 2025/2026 (saldo 30→20)
--
-- Essa migration:
--   1. Backup dos 4 lançamentos em _backup_20261125800_califa_abono_avulso_orfaos.
--   2. Solta a constraint `chk_ferias_lancamento_abono_avulso_sem_periodo` que
--      forçava periodo_id = null em avulso.
--   3. Desabilita trigger de validação de saldo (os 4 novos vínculos cabem
--      nos aquisitivos, mas o trigger faria aprovado+novo somar — já
--      conferido que nenhum ultrapassa 30; trigger fica off por segurança).
--   4. UPDATE nos 4 lançamentos mantendo tipo = 'abono_avulso' (não vira
--      excepcional — ≤10 dias continua sendo avulso) e setando periodo_id
--      pro aquisitivo correto.
--   5. Reabilita trigger.
--   6. Nova constraint: `periodo_id IS NOT NULL` em QUALQUER tipo.
--   7. Atualiza comment da coluna.
--   8. Força recálculo de status dos aquisitivos tocados.
--
-- Diferente da migration 20261114400001 (que trocou avulso→excepcional
-- nos 4 órfãos legados do import), aqui o tipo original é preservado:
-- com a constraint relaxada não precisamos mais trocar o tipo pra fugir
-- dela. Avulso continua significando "≤10 dias por acordo normal"
-- e excepcional "venda acima do padrão por acordo administrativo".

begin;

-- Guarda do tenant
do $$
declare v_nome text;
begin
  select nome into v_nome from public.tenants where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome is null then raise exception 'Tenant não encontrado'; end if;
  if v_nome <> 'Agência California' then raise exception 'Tenant errado: %', v_nome; end if;
end $$;

-- 1. Backup dos 4 lançamentos a serem alterados
create table if not exists public._backup_20261125800_califa_abono_avulso_orfaos as
  select * from public.colaboradores_ferias_lancamentos
   where tipo = 'abono_avulso'
     and periodo_id is null
     and tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

-- 2. Solta a constraint velha que forçava periodo_id = null em avulso
alter table public.colaboradores_ferias_lancamentos
  drop constraint if exists chk_ferias_lancamento_abono_avulso_sem_periodo;

-- 3. Desabilita trigger de validação de saldo (precaução — já conferido)
alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

-- 4. Correção pontual: seta periodo_id nos 4 lançamentos conhecidos.
--    Mantém tipo = 'abono_avulso' (todos ≤10 dias).

-- Caso 1 (aquisitivo 7 — 2025/2026)
update public.colaboradores_ferias_lancamentos
   set periodo_id = 'af696cf0-a068-4cb3-96d8-8184deb7e7b1'
 where id = 'ed6136bc-0959-40cb-ac4f-e6f6384edd2a';

-- Caso 2 (aquisitivo 3 — 2025/2026, em alerta)
update public.colaboradores_ferias_lancamentos
   set periodo_id = '5c3e41ab-4503-4151-a67a-8e334be8995b'
 where id = '52bbe832-e0c1-46ae-9032-e34bb1c34860';

-- Caso 3 (aquisitivo 3 — 2025/2026)
update public.colaboradores_ferias_lancamentos
   set periodo_id = '22e90b98-541d-4018-a88a-0f62e369768d'
 where id = '5ea40718-b323-4ef0-a02e-473cdda43e37';

-- Caso 4 (aquisitivo 3 — 2025/2026; ainda em aguardando_gestor)
update public.colaboradores_ferias_lancamentos
   set periodo_id = 'e942f6de-632b-4595-a979-73942d99a0fe'
 where id = 'b604a062-3fb1-4391-9273-772cdb718a6e';

-- 5. Reabilita o trigger
alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;

-- 6. Nova constraint: periodo_id é obrigatório em qualquer tipo de lançamento
alter table public.colaboradores_ferias_lancamentos
  add constraint chk_ferias_lancamento_periodo_obrigatorio
  check (periodo_id is not null);

-- 7. Atualiza comment da coluna periodo_id refletindo a nova regra
comment on column public.colaboradores_ferias_lancamentos.periodo_id is
  'FK obrigatória pro período aquisitivo. Todo lançamento (usufruto, abono_combinado, abono_avulso, abono_excepcional) abate dias do aquisitivo correspondente. Antes de 2026-11-25, abono_avulso tinha periodo_id = null e por isso não abatia — corrigido na migration 20261125800001.';

comment on type public.ferias_lancamento_tipo is
  'Tipo de lançamento de férias. usufruto=dias de folga; abono_combinado=férias+venda no mesmo bloco (CLT clássico); abono_avulso=venda ≤10 dias sem gozar (modelo PJ California); abono_excepcional=venda acima de 10 dias por acordo administrativo. Todos abatem dias do período aquisitivo.';

-- 8. Força recálculo de status dos 4 aquisitivos afetados
update public.colaboradores_ferias_periodos
   set updated_at = now()
 where id in (
   'af696cf0-a068-4cb3-96d8-8184deb7e7b1',
   '5c3e41ab-4503-4151-a67a-8e334be8995b',
   '22e90b98-541d-4018-a88a-0f62e369768d',
   'e942f6de-632b-4595-a979-73942d99a0fe'
 );

commit;
