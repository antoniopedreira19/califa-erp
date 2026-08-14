-- =====================================================================
-- Plano de contas — passo 1 (aditivo)
--
-- Racional:
--   Estamos migrando a UI do Plano de contas pra uma árvore hierárquica
--   com código numérico padded (ex.: tipo "01", subtipo "01.001"). Isso
--   é padrão de chart of accounts (SPED, ERPs contábeis) e resolve a
--   ordenação sem precisar de coluna `ordem`.
--
--   Este passo é ADITIVO: só adiciona a coluna `codigo` ao subtipo, com
--   backfill baseado na `ordem` atual (por tipo), e cria a unique
--   (tenant_id, tipo_id, codigo). NOT NULL entra no próximo passo,
--   junto com o rename de tipos alfa→numérico e o drop de `ordem`.
-- =====================================================================

-- 1) Coluna codigo (nullable, temporariamente)
alter table public.plano_contas_subtipos
  add column if not exists codigo varchar(3);

-- 2) Formato: exatamente 3 dígitos (001..999)
--    Constraint valida quando codigo não é nulo (aditivo — não invalida linhas antigas ainda vazias)
do $$ begin
  alter table public.plano_contas_subtipos
    add constraint chk_subtipo_codigo_formato check (codigo is null or codigo ~ '^[0-9]{3}$');
exception when duplicate_object then null;
end $$;

-- 3) Backfill: pra cada tipo, numera os subtipos pela ordem atual
--    (row_number sobre ordem, nome como tiebreak) — resulta em 001, 002, ...
with numerados as (
  select
    id,
    lpad(
      row_number() over (partition by tipo_id order by ordem, nome, id)::text,
      3,
      '0'
    ) as novo_codigo
  from public.plano_contas_subtipos
  where codigo is null
)
update public.plano_contas_subtipos s
   set codigo = n.novo_codigo
  from numerados n
 where s.id = n.id;

-- 4) Unique por tenant + tipo + codigo (subtipo)
do $$ begin
  alter table public.plano_contas_subtipos
    add constraint uniq_subtipo_codigo_por_tipo unique (tenant_id, tipo_id, codigo);
exception when duplicate_object then null;
end $$;
