-- O titular freela da verba passa a ser um registro de `freelancers` (o
-- cadastro do RH), não mais da lista provisória `freelas` (decisões 164 e 171).
--
-- O que aconteceu (19/10/2026): às 16h24 de Brasília a migration
-- `pessoas_para_verba_le_freelancers` trocou a origem da lista "Titular da
-- verba" de `freelas` (70 pessoas) para `freelancers` (221, migradas do RH).
-- As duas tabelas não têm id em comum, e as FKs `verba_freela_id` de
-- `pedidos_compra` e `pedidos_compra_a_emitir` continuavam apontando para
-- `freelas`. Desde então, salvar ou gerar qualquer verba com titular freela
-- dava
--   insert or update on table "pedidos_compra_a_emitir" violates foreign key
--   constraint "pedidos_compra_a_emitir_verba_freela_id_fkey"
-- (caso real: a reemissão da PP-00127, cujo titular só existe em
-- `freelancers`). Colaborador e terceiro seguiam funcionando.
--
-- A correção, autorizada pelo Tiago (destrutiva: muda a FK de coluna
-- preenchida e sobrescreve valores):
--   1. As duas FKs saem de `freelas` e passam a apontar para `freelancers`.
--   2. As referências antigas trocam para o mesmo freela em `freelancers`,
--      casado pelo CPF dentro do tenant: 13 de 14 PPs e 14 de 15 PPs a
--      emitir. A troca não é edição de ninguém: os gatilhos de usuário ficam
--      desligados durante o UPDATE (sem evento na linha do tempo da PP, sem
--      carimbo de edição, sem mexer no `updated_at` nem na foto).
--   3. As 2 linhas que apontam para a única freela sem CPF (a PP-00158,
--      cancelada, e uma PP a emitir) ficam como estão. Por isso as FKs novas
--      nascem `not valid`: valem para toda escrita nova e para a troca de
--      titular, mas não revalidam o passado. Ao abrir essa PP a emitir, o
--      servidor não acha o titular na lista e pede para escolher de novo.
-- `freelas` continua existindo (é dela o nome dessas 2 linhas e o histórico).

-- 1. Sai a FK para `freelas` ----------------------------------------------------
alter table public.pedidos_compra
  drop constraint if exists pedidos_compra_verba_freela_id_fkey;
alter table public.pedidos_compra_a_emitir
  drop constraint if exists pedidos_compra_a_emitir_verba_freela_id_fkey;

-- 2. Troca das referências pelo CPF -------------------------------------------
do $$
declare
  v_ambiguos int;
begin
  -- Um freela antigo que case com mais de um registro novo não é trocado às
  -- cegas: para tudo.
  select count(*) into v_ambiguos
    from public.freelas x
   where (select count(*)
            from public.freelancers f
           where f.tenant_id = x.tenant_id
             and f.cpf = nullif(regexp_replace(coalesce(x.cpf, ''), '\D', '', 'g'), '')) > 1;
  if v_ambiguos > 0 then
    raise exception 'Há % freela(s) de freelas com mais de um CPF igual em freelancers.', v_ambiguos;
  end if;
end;
$$;

create temporary table mapa_freela_titular on commit drop as
select x.id as antigo, f.id as novo
  from public.freelas x
  join public.freelancers f
    on f.tenant_id = x.tenant_id
   and f.cpf = nullif(regexp_replace(coalesce(x.cpf, ''), '\D', '', 'g'), '');

alter table public.pedidos_compra disable trigger user;
alter table public.pedidos_compra_a_emitir disable trigger user;

update public.pedidos_compra pc
   set verba_freela_id = m.novo
  from mapa_freela_titular m
 where pc.verba_freela_id = m.antigo;

update public.pedidos_compra_a_emitir a
   set verba_freela_id = m.novo
  from mapa_freela_titular m
 where a.verba_freela_id = m.antigo;

alter table public.pedidos_compra enable trigger user;
alter table public.pedidos_compra_a_emitir enable trigger user;

-- 3. FK para `freelancers` ----------------------------------------------------
-- RESTRICT como antes: freelancer que já é titular de PP não se apaga.
alter table public.pedidos_compra
  add constraint pedidos_compra_verba_freela_id_fkey
  foreign key (verba_freela_id) references public.freelancers(id)
  on delete restrict not valid;
alter table public.pedidos_compra_a_emitir
  add constraint pedidos_compra_a_emitir_verba_freela_id_fkey
  foreign key (verba_freela_id) references public.freelancers(id)
  on delete restrict not valid;

comment on column public.pedidos_compra.verba_freela_id is
  'Titular freela da verba (decisões 164 e 171): registro de freelancers desde 19/10/2026 (antes, da lista provisória freelas). FK not valid: a PP-00158, cancelada, segue com o id antigo de freelas.';
comment on column public.pedidos_compra_a_emitir.verba_freela_id is
  'Titular freela da verba (decisões 164 e 171): registro de freelancers desde 19/10/2026 (antes, da lista provisória freelas). FK not valid: uma PP a emitir segue com o id antigo de freelas e pede o titular de novo ao abrir.';
