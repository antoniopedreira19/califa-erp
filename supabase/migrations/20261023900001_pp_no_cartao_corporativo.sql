-- ============================================================================
-- PP no cartão corporativo (decisão 209, 23/10/2026)
-- ============================================================================
--
-- Um quarto tipo de PP, ao lado de Normal, Verba e Reembolso: a compra que
-- o FINANCEIRO paga no cartão de crédito da empresa (uma plataforma ou site,
-- pelo link que a produção manda). Regras do Tiago (23/10/2026):
--   1. quem passa o cartão é o financeiro;
--   2. as parcelas são as da fatura, definidas pelo financeiro — a PP nasce
--      com uma parcela só, no prazo das janelas (08 e 20) como as outras;
--   3. o envio ao financeiro não exige nota (anexá-la depois é fase futura);
--   4. NÃO há fornecedor: no lugar dele, a plataforma e o link da compra.
--
-- O que entra aqui:
--   * `cartao_corporativo`, `cartao_plataforma` e `cartao_link` em
--     `pedidos_compra` e em `pedidos_compra_a_emitir` (a PP a emitir já tem
--     colunas próprias para quem recebe; o cartão segue o mesmo desenho);
--   * `pp_cartao_corporativo` / `chk_ppae_cartao_corporativo`: a PP no
--     cartão é PP comum (sem verba), sem fornecedor, sem pagamento fora do
--     cadastro, com plataforma e link preenchidos — e a PP comum segue
--     sem nenhum dos dois campos;
--   * `pp_cartao_corporativo_aprovada`: aprovada ou paga, a PP no cartão
--     tem a forma "cartão de crédito" registrada. A server action grava a
--     intenção ANTES da RPC `aprovar_pp_com_data`, que não muda — o mesmo
--     desenho da marcação do pagamento fora do cadastro (decisão 127);
--   * `chk_pp_verba_coerencia` e `chk_ppae_verba` trocam só o primeiro
--     ramo: a PP comum tem fornecedor, OU é do cartão corporativo e não tem.
--     Os ramos da verba ficam como estavam (texto copiado da definição
--     viva). Afrouxa a regra — nenhuma linha existente deixa de valer —, e
--     o reteste de todas as linhas na recriação passa porque nenhuma é do
--     cartão.
--
-- Fora daqui, de propósito:
--   * a remessa CNAB: a PP no cartão é recusada na geração do arquivo pelo
--     código (não tem conta para onde pagar);
--   * a NF anexada depois pelo financeiro (próxima fase).
--
-- Aditiva no dado: colunas novas com default, nenhum backfill. As tabelas
-- já têm GRANT e RLS; as colunas herdam os dois.
-- ============================================================================

alter table public.pedidos_compra
  add column if not exists cartao_corporativo boolean not null default false,
  add column if not exists cartao_plataforma text,
  add column if not exists cartao_link text;

alter table public.pedidos_compra_a_emitir
  add column if not exists cartao_corporativo boolean not null default false,
  add column if not exists cartao_plataforma text,
  add column if not exists cartao_link text;

comment on column public.pedidos_compra.cartao_corporativo is
  'Decisão 209: a PP é paga pelo financeiro no cartão de crédito da empresa. Sem fornecedor; plataforma e link no lugar dele.';
comment on column public.pedidos_compra.cartao_plataforma is
  'Decisão 209: a plataforma ou o site da compra no cartão corporativo (ex.: Mercado Livre).';
comment on column public.pedidos_compra.cartao_link is
  'Decisão 209: o link da compra no cartão corporativo (produto ou carrinho).';
comment on column public.pedidos_compra_a_emitir.cartao_corporativo is
  'Decisão 209: a PP a emitir é do cartão corporativo (sem fornecedor).';
comment on column public.pedidos_compra_a_emitir.cartao_plataforma is
  'Decisão 209: a plataforma ou o site da compra no cartão corporativo.';
comment on column public.pedidos_compra_a_emitir.cartao_link is
  'Decisão 209: o link da compra no cartão corporativo.';

do $$
begin
  -- `coalesce(…, '')` em vez de confiar na coluna: CHECK com NULL passa.
  if not exists (select 1 from pg_constraint where conname = 'pp_cartao_corporativo') then
    alter table public.pedidos_compra
      add constraint pp_cartao_corporativo check (
        (not cartao_corporativo and cartao_plataforma is null and cartao_link is null)
        or (
          cartao_corporativo
          and not verba_producao
          and fornecedor_id is null
          and pagamento_fora_do_cadastro_meio is null
          and char_length(btrim(coalesce(cartao_plataforma, ''))) between 1 and 200
          and char_length(btrim(coalesce(cartao_link, ''))) between 1 and 2000
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_ppae_cartao_corporativo') then
    alter table public.pedidos_compra_a_emitir
      add constraint chk_ppae_cartao_corporativo check (
        (not cartao_corporativo and cartao_plataforma is null and cartao_link is null)
        or (
          cartao_corporativo
          and not verba_producao
          and fornecedor_id is null
          and char_length(btrim(coalesce(cartao_plataforma, ''))) between 1 and 200
          and char_length(btrim(coalesce(cartao_link, ''))) between 1 and 2000
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pp_cartao_corporativo_aprovada') then
    alter table public.pedidos_compra
      add constraint pp_cartao_corporativo_aprovada check (
        not cartao_corporativo
        or status not in ('aprovada', 'pago')
        or forma_pagamento is not distinct from 'cartao_credito'::forma_pagamento
      );
  end if;
end $$;

-- A PP comum: fornecedor, ou cartão corporativo sem fornecedor. O resto da
-- regra é a definição viva, sem mudança.
alter table public.pedidos_compra drop constraint if exists chk_pp_verba_coerencia;
alter table public.pedidos_compra
  add constraint chk_pp_verba_coerencia check (
    ((not verba_producao) and (tipo_verba is null) and (verba_titular_tipo is null)
      and ((fornecedor_id is not null) <> cartao_corporativo)
      and (responsavel_verba_id is null) and (verba_colaborador_id is null) and (verba_freela_id is null))
    or (verba_producao and (coalesce(tipo_verba, 'producao') = 'producao') and (verba_titular_tipo is null)
      and (fornecedor_id is null) and (responsavel_verba_id is not null)
      and (verba_colaborador_id is null) and (verba_freela_id is null))
    or (verba_producao and (tipo_verba = any (array['producao', 'alimentacao', 'transporte']))
      and (responsavel_verba_id is null) and (length(btrim(coalesce(verba_titular_nome, ''))) > 0)
      and (((verba_titular_tipo = 'colaborador') and (fornecedor_id is null) and (verba_freela_id is null))
        or ((verba_titular_tipo = 'freela') and (fornecedor_id is null) and (verba_colaborador_id is null) and (verba_freela_id is not null))
        or ((verba_titular_tipo = 'fornecedor') and (fornecedor_id is not null) and (verba_colaborador_id is null) and (verba_freela_id is null))))
    or (verba_producao and (coalesce(tipo_verba, '') = 'reembolso')
      and (responsavel_verba_id is null) and (length(btrim(coalesce(verba_titular_nome, ''))) > 0)
      and (((verba_titular_tipo = 'colaborador') and (fornecedor_id is null) and (verba_freela_id is null))
        or ((verba_titular_tipo = 'freela') and (fornecedor_id is null) and (verba_colaborador_id is null) and (verba_freela_id is not null))))
  );

alter table public.pedidos_compra_a_emitir drop constraint if exists chk_ppae_verba;
alter table public.pedidos_compra_a_emitir
  add constraint chk_ppae_verba check (
    ((not verba_producao) and (tipo_verba is null) and (verba_titular_tipo is null)
      and ((fornecedor_id is not null) <> cartao_corporativo)
      and (responsavel_verba_id is null) and (verba_colaborador_id is null) and (verba_freela_id is null))
    or (verba_producao and (coalesce(tipo_verba, 'producao') = 'producao') and (verba_titular_tipo is null)
      and (fornecedor_id is null) and (responsavel_verba_id is not null)
      and (verba_colaborador_id is null) and (verba_freela_id is null))
    or (verba_producao and (tipo_verba = any (array['producao', 'alimentacao', 'transporte']))
      and (responsavel_verba_id is null) and (length(btrim(coalesce(verba_titular_nome, ''))) > 0)
      and (((verba_titular_tipo = 'colaborador') and (fornecedor_id is null) and (verba_freela_id is null))
        or ((verba_titular_tipo = 'freela') and (fornecedor_id is null) and (verba_colaborador_id is null) and (verba_freela_id is not null))
        or ((verba_titular_tipo = 'fornecedor') and (fornecedor_id is not null) and (verba_colaborador_id is null) and (verba_freela_id is null))))
    or (verba_producao and (coalesce(tipo_verba, '') = 'reembolso')
      and (responsavel_verba_id is null) and (length(btrim(coalesce(verba_titular_nome, ''))) > 0)
      and (((verba_titular_tipo = 'colaborador') and (fornecedor_id is null) and (verba_freela_id is null))
        or ((verba_titular_tipo = 'freela') and (fornecedor_id is null) and (verba_colaborador_id is null) and (verba_freela_id is not null))))
  );
