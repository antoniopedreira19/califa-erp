-- Decisão 187 (17/10/2026) — PP de reembolso, parte 2 de 2.
--
-- Pedido do Tiago (16/10, protótipo aprovado em 17/10): um terceiro tipo de
-- PP, além da normal e da verba, para devolver a alguém da equipe o que ele
-- pagou do próprio bolso. Dois tipos de reembolso:
--
--   - despesas: os comprovantes (cupom, NF, recibo) são obrigatórios no
--     ENVIO ao financeiro, cada um com número, data e valor, e a soma fecha
--     o valor da PP;
--   - veiculo_proprio: deslocamento com o carro da pessoa, com a conta da
--     planilha "Reembolso de Gasolina" — km ida e volta × vezes ÷ consumo
--     (km/l) × preço do litro + km × desgaste por km. O anexo (foto da
--     quilometragem, print do mapa…) é obrigatório no envio, sem tipo.
--
-- Modelo: o reembolso é `tipo_verba = 'reembolso'` com `verba_producao =
-- true`. Assim ele herda o que a verba já tem de "não fornecedor": o
-- titular (colaborador do RH ou freela — sem terceiro), a foto da conta e
-- do PIX do colaborador copiada pelo gatilho `trg_pp_foto_do_colaborador`,
-- a baixa só do valor inteiro, a aprovação sem registro de NF de fornecedor
-- (`registrar_notas_fiscais_da_pp`) e a remessa de fora. O que é só da
-- verba — prestação de contas, devolução de saldo e a trava do encerramento
-- — não vale para o reembolso: a aplicação filtra pelo tipo, e o gatilho
-- abaixo recusa a prestação no banco.
--
-- O que muda:
--   1. `pedidos_compra.reembolso_tipo` e `reembolso_deslocamentos` (jsonb
--      com o consumo, o preço do litro, o desgaste por km da data da PP e
--      os deslocamentos), com a coerência num CHECK próprio;
--   2. os CHECKs de verba de `pedidos_compra` e `pedidos_compra_a_emitir`
--      ganham o ramo do reembolso — só alargam: toda linha que passava
--      continua passando (o mesmo caminho das decisões 164 e 171);
--   3. o gatilho que recusa prestação de contas de reembolso;
--   4. `financeiro_parametros`: o desgaste por km (R$ 0,40 na planilha) é
--      um valor da casa que só o financeiro altera (resposta 1 do Tiago).
--
-- Fica de fora: a PP a emitir guarda o tipo e os deslocamentos dentro de
-- `dados` (como o resto do formulário), sem coluna nova.

-- 1. As colunas do reembolso -------------------------------------------------

alter table public.pedidos_compra
  add column if not exists reembolso_tipo text,
  add column if not exists reembolso_deslocamentos jsonb;

comment on column public.pedidos_compra.reembolso_tipo is
  'Decisão 187: despesas | veiculo_proprio. Só na PP de reembolso (tipo_verba = reembolso).';
comment on column public.pedidos_compra.reembolso_deslocamentos is
  'Decisão 187: no reembolso de veículo próprio, {consumo_km_l, preco_litro, desgaste_por_km, linhas: [{data, trajeto, km_ida_volta, vezes}]}. O desgaste é o da data da PP.';

alter table public.pedidos_compra drop constraint if exists chk_pp_reembolso;
alter table public.pedidos_compra add constraint chk_pp_reembolso check (
  (coalesce(tipo_verba, '') = 'reembolso') = (reembolso_tipo is not null)
  and (reembolso_tipo is null or reembolso_tipo in ('despesas', 'veiculo_proprio'))
  and ((reembolso_deslocamentos is not null) = (coalesce(reembolso_tipo, '') = 'veiculo_proprio'))
  and (reembolso_deslocamentos is null or jsonb_typeof(reembolso_deslocamentos) = 'object')
);

-- 2. Os CHECKs de verba ganham o ramo do reembolso ----------------------------
-- Os três primeiros ramos são os de hoje, sem mudança. O quarto é o
-- reembolso: titular colaborador ou freela, sem fornecedor (sem terceiro).

alter table public.pedidos_compra drop constraint if exists chk_pp_verba_coerencia;
alter table public.pedidos_compra add constraint chk_pp_verba_coerencia check (
  (
    (not verba_producao) and tipo_verba is null and verba_titular_tipo is null
    and fornecedor_id is not null and responsavel_verba_id is null
    and verba_colaborador_id is null and verba_freela_id is null
  )
  or (
    verba_producao and coalesce(tipo_verba, 'producao') = 'producao'
    and verba_titular_tipo is null and fornecedor_id is null
    and responsavel_verba_id is not null
    and verba_colaborador_id is null and verba_freela_id is null
  )
  or (
    verba_producao and tipo_verba = any (array['producao', 'alimentacao', 'transporte'])
    and responsavel_verba_id is null
    and length(btrim(coalesce(verba_titular_nome, ''))) > 0
    and (
      (verba_titular_tipo = 'colaborador' and fornecedor_id is null and verba_freela_id is null)
      or (verba_titular_tipo = 'freela' and fornecedor_id is null and verba_colaborador_id is null and verba_freela_id is not null)
      or (verba_titular_tipo = 'fornecedor' and fornecedor_id is not null and verba_colaborador_id is null and verba_freela_id is null)
    )
  )
  or (
    verba_producao and coalesce(tipo_verba, '') = 'reembolso'
    and responsavel_verba_id is null
    and length(btrim(coalesce(verba_titular_nome, ''))) > 0
    and (
      (verba_titular_tipo = 'colaborador' and fornecedor_id is null and verba_freela_id is null)
      or (verba_titular_tipo = 'freela' and fornecedor_id is null and verba_colaborador_id is null and verba_freela_id is not null)
    )
  )
);

alter table public.pedidos_compra_a_emitir drop constraint if exists chk_ppae_verba;
alter table public.pedidos_compra_a_emitir add constraint chk_ppae_verba check (
  (
    (not verba_producao) and tipo_verba is null and verba_titular_tipo is null
    and fornecedor_id is not null and responsavel_verba_id is null
    and verba_colaborador_id is null and verba_freela_id is null
  )
  or (
    verba_producao and coalesce(tipo_verba, 'producao') = 'producao'
    and verba_titular_tipo is null and fornecedor_id is null
    and responsavel_verba_id is not null
    and verba_colaborador_id is null and verba_freela_id is null
  )
  or (
    verba_producao and tipo_verba = any (array['producao', 'alimentacao', 'transporte'])
    and responsavel_verba_id is null
    and length(btrim(coalesce(verba_titular_nome, ''))) > 0
    and (
      (verba_titular_tipo = 'colaborador' and fornecedor_id is null and verba_freela_id is null)
      or (verba_titular_tipo = 'freela' and fornecedor_id is null and verba_colaborador_id is null and verba_freela_id is not null)
      or (verba_titular_tipo = 'fornecedor' and fornecedor_id is not null and verba_colaborador_id is null and verba_freela_id is null)
    )
  )
  or (
    verba_producao and coalesce(tipo_verba, '') = 'reembolso'
    and responsavel_verba_id is null
    and length(btrim(coalesce(verba_titular_nome, ''))) > 0
    and (
      (verba_titular_tipo = 'colaborador' and fornecedor_id is null and verba_freela_id is null)
      or (verba_titular_tipo = 'freela' and fornecedor_id is null and verba_colaborador_id is null and verba_freela_id is not null)
    )
  )
);

-- 3. Reembolso não presta contas ---------------------------------------------
-- A prestação nasce em `enviar_prestacao_verba`, que insere em
-- `pp_verba_prestacoes`. Um gatilho aqui recusa a de reembolso sem
-- reescrever a função.

create or replace function public.pp_prestacao_recusa_reembolso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.pedidos_compra
     where id = new.pedido_compra_id
       and tipo_verba = 'reembolso'
  ) then
    raise exception 'Reembolso não tem prestação de contas: os comprovantes vão no envio da PP.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prestacao_recusa_reembolso on public.pp_verba_prestacoes;
create trigger trg_prestacao_recusa_reembolso
  before insert on public.pp_verba_prestacoes
  for each row execute function public.pp_prestacao_recusa_reembolso();

revoke all on function public.pp_prestacao_recusa_reembolso() from public, anon;

-- 4. Parâmetros do financeiro: o desgaste por km --------------------------------

create table if not exists public.financeiro_parametros (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  chave text not null check (chave in ('reembolso_desgaste_por_km')),
  valor numeric(12, 4) not null check (valor >= 0),
  atualizado_por uuid references public.profiles(id),
  atualizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, chave)
);

comment on table public.financeiro_parametros is
  'Decisão 187: valores da casa que só o financeiro (ou o administrador) altera. Hoje, o desgaste por km do reembolso de veículo próprio.';

alter table public.financeiro_parametros enable row level security;

drop policy if exists financeiro_parametros_select on public.financeiro_parametros;
create policy financeiro_parametros_select on public.financeiro_parametros
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists financeiro_parametros_insert on public.financeiro_parametros;
create policy financeiro_parametros_insert on public.financeiro_parametros
  for insert to authenticated
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );

drop policy if exists financeiro_parametros_update on public.financeiro_parametros;
create policy financeiro_parametros_update on public.financeiro_parametros
  for update to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  )
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );

revoke all on public.financeiro_parametros from anon;
grant select, insert, update on public.financeiro_parametros to authenticated;

-- O valor da planilha de hoje, para cada tenant (preenche o vazio).
insert into public.financeiro_parametros (tenant_id, chave, valor)
select t.id, 'reembolso_desgaste_por_km', 0.40
  from public.tenants t
 where not exists (
   select 1 from public.financeiro_parametros p
    where p.tenant_id = t.id and p.chave = 'reembolso_desgaste_por_km'
 );
