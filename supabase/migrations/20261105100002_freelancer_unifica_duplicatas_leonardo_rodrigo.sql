-- Unifica mais 2 duplicatas detectadas no mesmo padrão da migration anterior
-- (20261105100001_freelancer_unifica_duplicata_legado): linha importada do
-- legado em 2026-04-13 sem CPF + cadastro novo via form_publico com CPF.
-- Em ambos os casos o `nome_completo` do winner bate literalmente com o
-- `nome_social` do loser, confirmando que são a mesma pessoa.
--
-- Pares:
--   LEONARDO
--     loser  = 4bea6ff4-6951-403f-8fbd-af1cffcd52a8  (2 contratos)
--     winner = 9961deb7-8840-4704-ba11-3df2f3ad31bb  (1 contrato)
--   RODRIGO
--     loser  = 11df5048-b8f4-464b-893b-c52523e39707  (2 contratos)
--     winner = ba9d20bf-ff79-446b-b01e-1d0b2cf10061  (1 contrato)
--
-- Os dois losers têm 0 em freelancer_solicitacoes, pedidos_compra.verba_freela_id
-- e pedidos_compra_a_emitir.verba_freela_id — nada além de contratos a mover.
-- `nome_completo` dos winners não é sobrescrito (merge não é lugar de editar).

begin;

-- 1. Reatribui contratos dos losers pros respectivos winners.
update public.freelancer_contratos
   set freelancer_id = '9961deb7-8840-4704-ba11-3df2f3ad31bb'
 where freelancer_id = '4bea6ff4-6951-403f-8fbd-af1cffcd52a8';

update public.freelancer_contratos
   set freelancer_id = 'ba9d20bf-ff79-446b-b01e-1d0b2cf10061'
 where freelancer_id = '11df5048-b8f4-464b-893b-c52523e39707';

-- 2. Remove os losers.
delete from public.freelancers
 where id in (
   '4bea6ff4-6951-403f-8fbd-af1cffcd52a8',
   '11df5048-b8f4-464b-893b-c52523e39707'
 );

-- 3. Guards pós-merge.
do $$
declare
  v_losers_restantes int;
  v_contratos_leo int;
  v_contratos_rod int;
begin
  select count(*) into v_losers_restantes
    from public.freelancers
   where id in (
     '4bea6ff4-6951-403f-8fbd-af1cffcd52a8',
     '11df5048-b8f4-464b-893b-c52523e39707'
   );
  if v_losers_restantes <> 0 then
    raise exception 'merge abortado: % loser(s) ainda em freelancers', v_losers_restantes;
  end if;

  select count(*) into v_contratos_leo
    from public.freelancer_contratos
   where freelancer_id = '9961deb7-8840-4704-ba11-3df2f3ad31bb';
  if v_contratos_leo < 3 then
    raise exception 'merge abortado: winner LEONARDO tem % contratos, esperado >= 3', v_contratos_leo;
  end if;

  select count(*) into v_contratos_rod
    from public.freelancer_contratos
   where freelancer_id = 'ba9d20bf-ff79-446b-b01e-1d0b2cf10061';
  if v_contratos_rod < 3 then
    raise exception 'merge abortado: winner RODRIGO tem % contratos, esperado >= 3', v_contratos_rod;
  end if;
end $$;

commit;
