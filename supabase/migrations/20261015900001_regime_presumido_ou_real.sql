-- ============================================================================
-- Decisão 179 (15/10/2026): "Lucro Presumido ou Real" volta a ser uma opção
-- só no regime tributário do fornecedor (revê a 166, §1 e §3).
--
-- A 166 separou Lucro Real e Lucro Presumido. O Tiago pediu a volta: a
-- Receita não diz qual dos dois — conferir exigiria perguntar a cada
-- fornecedor —, e para as retenções da aprovação da PP é a mesma regra (só
-- Simples e MEI não sofrem). Com a opção única, a consulta do CNPJ preenche
-- o regime nos três casos: MEI, Simples ou "nenhum dos dois", que é
-- `normal` ("Lucro Presumido ou Real").
--
-- O que muda no banco, e só isto:
--
--   1. Os cadastros com `lucro_real` ou `lucro_presumido` passam a `normal`.
--      Eram 4 em 15/10/2026, todos escolhidos à mão depois da 166: BOA
--      MUSICA BRASIL e Mercado Livre (Real), JK INGRESSOS e o Fornecedor
--      Teste (Presumido). Os três reais tinham a consulta gravada dizendo
--      "nenhum dos dois" (`regime_consulta = 'normal'`), que agora bate com
--      o regime. Sobrescreve valor gravado: o Tiago confirmou a conversão
--      em 15/10/2026.
--
--   2. A CHECK `chk_fornecedor_regime` volta a aceitar só `normal`,
--      `simples` e `mei` — os mesmos valores de `regime_consulta`.
--
-- Nenhuma função nem view lê `regime_tributario` (conferido em 15/10/2026);
-- a aprovação da PP lê pelo código (`lib/fiscal/nf-da-pp.ts`). O histórico
-- de auditoria guarda os valores antigos e fica como está.
-- ============================================================================

update public.fornecedores
   set regime_tributario = 'normal'
 where regime_tributario in ('lucro_real', 'lucro_presumido');

alter table public.fornecedores
  drop constraint if exists chk_fornecedor_regime;

alter table public.fornecedores
  add constraint chk_fornecedor_regime check (
    regime_tributario is null
    or regime_tributario in ('normal', 'simples', 'mei')
  );

comment on column public.fornecedores.regime_tributario is
  'Regime tributario da pessoa juridica: normal ("Lucro Presumido ou Real"), simples ou mei. Obrigatorio na pessoa juridica pelo schema do servidor (decisao 166); Real e Presumido numa opcao so, preenchida pela consulta do CNPJ (decisao 179, 15/10/2026).';
