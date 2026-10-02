-- =============================================================================
-- Módulo fiscal · entrega 1 (02/10/2026): dois parâmetros que faltavam na
-- aba Parâmetros do cadastro de impostos.
--
-- Racional
-- • O protótipo aprovado em 02/10/2026 (tela Cadastros do Financeiro ›
--   Impostos, aba Parâmetros) mostra nove linhas. Sete já estão em
--   `fiscal_parametros` (migration 20261002100001); faltam a Selic estimada
--   para a 3ª cota do IRPJ/CSLL ("1,1% + 1%") e o DARF mínimo (R$ 10,00).
--   Sem as duas chaves, a tela simplesmente não mostra essas linhas.
-- • A Apuração (entrega seguinte) usa os dois: a Selic estimada só na
--   previsão dos juros da 3ª cota (o valor da guia manda) e o DARF mínimo
--   para acumular para o mês seguinte o imposto abaixo de R$ 10,00.
-- • Mudança ADITIVA: duas linhas novas por tenant, com vigência desde
--   01/01/2026 como as demais; `on conflict do nothing` (rodar de novo não
--   duplica). Tabela, RLS, policies e GRANTs já existem (20261002100001):
--   leitura para o tenant, escrita para admin e financeiro, nada para anon.
-- =============================================================================

insert into public.fiscal_parametros (tenant_id, chave, valor, descricao, vigencia_inicio)
select t.id, v.chave, v.valor, v.descricao, date '2026-01-01'
  from (values
    ('selic_estimada_mes', 1.1, 'Selic estimada ao mês, para a previsão dos juros da 3ª cota do IRPJ e da CSLL (o valor da guia manda)'),
    ('darf_minimo',        10,  'DARF mínimo: abaixo dele, o imposto acumula para o mês seguinte')
  ) as v(chave, valor, descricao)
  cross join (select distinct tenant_id as id from public.fiscal_parametros) t
on conflict (tenant_id, chave, vigencia_inicio) do nothing;
