-- Unifica duas linhas duplicadas na tabela `freelancers`:
--   * winner = 10111473-21ae-4975-a356-5d567621e7bb
--     (cadastro completo via form público, com CPF/CNPJ/endereço/pagamento,
--      com contrato VIGENTE e todas as demais FKs já apontando pra ele).
--   * loser  = 5a5715b2-7f81-49fe-8fb7-b935d08ba53a
--     (importado do legado só com `nome_social` e `nome_completo`, sem
--      CPF nem dados de pagamento; apenas 1 contrato ENCERRADO pendurado).
--
-- A duplicata nasceu porque `freelancers.cpf` é unique parcial `when not
-- null`: nada impede 2 linhas sem CPF entrarem — foi exatamente o que
-- aconteceu quando a importação legada rodou antes do cadastro novo.
--
-- Decisões:
--   * Move o contrato do loser pro winner (vira histórico encerrado no
--     perfil unificado).
--   * NÃO sobrescreve `nome_completo` do winner. O valor atual não é
--     ideal, mas corrigir é tarefa separada — merge não é lugar de
--     editar dado operacional.
--   * loser é deletado ao final. As outras 3 FKs (solicitacoes, PCs) já
--     estão vazias pro loser, então nada a mover.
--
-- Como garantimos que não sobrou nada:
--   * Asserts no final checam (a) loser removido; (b) winner herdou os 2
--     contratos (1 já era dele + 1 vindo do loser).

begin;

-- 1. Reatribui contratos do loser pro winner.
update public.freelancer_contratos
   set freelancer_id = '10111473-21ae-4975-a356-5d567621e7bb'
 where freelancer_id = '5a5715b2-7f81-49fe-8fb7-b935d08ba53a';

-- 2. Remove o loser.
delete from public.freelancers
 where id = '5a5715b2-7f81-49fe-8fb7-b935d08ba53a';

-- 3. Guards pós-merge.
do $$
declare
  v_loser_count int;
  v_winner_contratos int;
begin
  select count(*) into v_loser_count
    from public.freelancers
   where id = '5a5715b2-7f81-49fe-8fb7-b935d08ba53a';
  if v_loser_count <> 0 then
    raise exception 'merge abortado: loser 5a5715b2… não foi removido';
  end if;

  select count(*) into v_winner_contratos
    from public.freelancer_contratos
   where freelancer_id = '10111473-21ae-4975-a356-5d567621e7bb';
  if v_winner_contratos < 2 then
    raise exception 'merge abortado: winner tem % contratos, esperado >= 2',
      v_winner_contratos;
  end if;
end $$;

commit;
