-- =====================================================================
-- O lançamento volta a ter FK para a conta bancária
--
-- ⚠️ CONSERTA UMA REGRESSÃO DE 28/08/2026, INTRODUZIDA POR MIM.
--
-- A migration `20260828200001` derrubou a FK COMPOSTA
-- `fk_lancamento_conta_empresa (conta_bancaria_id, empresa_id)` para
-- soltar a conta da empresa. O que passou batido: aquela era a ÚNICA
-- chave estrangeira entre `lancamentos_financeiros` e
-- `contas_bancarias`. Derrubá-la não soltou só a empresa — soltou a
-- conta inteira.
--
-- Duas consequências, e a segunda é a que apareceu primeiro:
--
-- 1. INTEGRIDADE: por ~1 dia, nada impediu um lançamento de apontar para
--    uma conta que não existe. (Nenhuma linha ficou órfã — conferido
--    antes de recriar a FK; o `validate` abaixo teria recusado.)
--
-- 2. POSTGREST: sem FK, o PostgREST não conhece a relação, e TODO embed
--    `conta:contas_bancarias(...)` a partir de lançamentos passou a
--    responder "Could not find a relationship ... in the schema cache".
--    A query inteira falha, não só o embed. Na aba Títulos a Pagar isso
--    apagou o "Pago em · conta · centro de custo" das linhas pagas, e a
--    conferência da baixa abria com três travessões.
--
-- A FK volta simples: só `conta_bancaria_id`. É o que sempre deveria ter
-- existido ao lado da composta — a composta carregava duas regras
-- diferentes no mesmo objeto, e por isso derrubar uma derrubou a outra.
--
-- ⚠️ Lição para a próxima: ao derrubar constraint da outra frente,
-- verifique o que MAIS ela sustentava. FK composta costuma ser duas
-- regras coladas.
-- =====================================================================

-- Guarda: se houver lançamento apontando para conta inexistente, aborta
-- em vez de criar uma FK que não vale.
do $$
declare v_orfaos integer;
begin
  select count(*) into v_orfaos
    from public.lancamentos_financeiros l
   where l.conta_bancaria_id is not null
     and not exists (
       select 1 from public.contas_bancarias cb where cb.id = l.conta_bancaria_id
     );
  if v_orfaos > 0 then
    raise exception
      'Existem % lançamentos apontando para conta bancária inexistente. Resolva-os antes de recriar a FK.',
      v_orfaos;
  end if;
end $$;

alter table public.lancamentos_financeiros
  drop constraint if exists lancamentos_financeiros_conta_bancaria_id_fkey;

alter table public.lancamentos_financeiros
  add constraint lancamentos_financeiros_conta_bancaria_id_fkey
  foreign key (conta_bancaria_id)
  references public.contas_bancarias(id)
  on delete restrict;

-- A FK dá índice do lado referenciado, não do referenciador. Este é o
-- lado que a Conciliação varre o tempo todo (extrato por conta).
create index if not exists idx_lancamentos_conta_bancaria
  on public.lancamentos_financeiros (conta_bancaria_id, data_movimento);
