-- ============================================================================
-- PP com pagamento fora do cadastro do fornecedor (decisão 127, 29/09/2026)
-- ============================================================================
--
-- O caso: o fornecedor passa uma chave PIX TEMPORÁRIA (ou uma conta) para um
-- pagamento. Ela não pode ir para o cadastro, e a chave do cadastro não pode
-- ser usada nesta PP.
--
-- A PP já guarda uma FOTO dos dados de pagamento desde a decisão 067
-- (`fornecedor_pix_*`, `fornecedor_banco_*`…, `dados_pagamento_congelados_em`).
-- Esta migration NÃO cria outro lugar para o dado: quando a produção escolhe
-- "Outro PIX" ou "Outra conta", a foto é o cadastro com só aquele meio
-- trocado. O PDF continua o mesmo documento de sempre, só com a chave (ou a
-- conta) escolhida — regra do Tiago: "o documento em si deverá permanecer
-- igual, apenas com a chave escolhida".
--
-- O que entra aqui:
--   * `pagamento_fora_do_cadastro_meio`  — 'pix' | 'conta'; null = a PP paga
--     pelo cadastro, como toda PP até hoje.
--   * `pagamento_fora_do_cadastro_motivo` — obrigatório quando há meio
--     (mín. 10 caracteres), o que o financeiro lê antes de aprovar.
--   * `pagamento_fora_do_cadastro_aprovado_por/_em` — a marcação explícita
--     "Aprovar pagamento fora do cadastro" no pop-up de aprovação.
--
-- As travas moram no banco, e não só na tela:
--   * a PP de verba não usa isto (paga o responsável interno);
--   * o meio trocado tem de estar no formato da remessa — as MESMAS
--     expressões das CHECKs de `fornecedores` (decisão 101);
--   * PP fora do cadastro só vira `aprovada`/`pago` com a marcação
--     registrada. A aprovação passa pela RPC `aprovar_pp_com_data`, que esta
--     migration não toca: a server action grava a marcação antes de
--     chamá-la, e a CHECK garante que nenhum outro caminho aprova sem ela.
--
-- Fora daqui, de propósito:
--   * a remessa CNAB continua lendo o cadastro ao vivo (módulo do Antonio);
--     a PP fora do cadastro é recusada na geração do arquivo e paga pelo
--     PDF (decisão do Tiago em 29/09/2026).
--
-- Aditiva: quatro colunas nulas e CHECKs que toda linha existente satisfaz
-- (nenhuma tem meio). Nenhum backfill. A tabela já tem GRANT e RLS; as
-- colunas herdam os dois.
-- ============================================================================

alter table public.pedidos_compra
  add column if not exists pagamento_fora_do_cadastro_meio text,
  add column if not exists pagamento_fora_do_cadastro_motivo text,
  add column if not exists pagamento_fora_do_cadastro_aprovado_por uuid
    references public.profiles(id),
  add column if not exists pagamento_fora_do_cadastro_aprovado_em timestamptz;

comment on column public.pedidos_compra.pagamento_fora_do_cadastro_meio is
  'Decisão 127: ''pix'' ou ''conta'' quando esta PP paga fora do cadastro do fornecedor (a foto fornecedor_* é o cadastro com só esse meio trocado). Null = paga pelo cadastro.';
comment on column public.pedidos_compra.pagamento_fora_do_cadastro_motivo is
  'Decisão 127: por que esta PP não paga pelo cadastro (ex.: chave temporária). Obrigatório quando há meio.';
comment on column public.pedidos_compra.pagamento_fora_do_cadastro_aprovado_por is
  'Decisão 127: quem marcou "Aprovar pagamento fora do cadastro" na aprovação.';
comment on column public.pedidos_compra.pagamento_fora_do_cadastro_aprovado_em is
  'Decisão 127: quando a marcação foi registrada. PP fora do cadastro só vira aprovada/pago com ela.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pp_fora_do_cadastro_meio_valido') then
    alter table public.pedidos_compra
      add constraint pp_fora_do_cadastro_meio_valido check (
        pagamento_fora_do_cadastro_meio is null
        or (pagamento_fora_do_cadastro_meio in ('pix', 'conta') and verba_producao = false)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pp_fora_do_cadastro_motivo') then
    alter table public.pedidos_compra
      add constraint pp_fora_do_cadastro_motivo check (
        (pagamento_fora_do_cadastro_meio is null and pagamento_fora_do_cadastro_motivo is null)
        or (
          pagamento_fora_do_cadastro_meio is not null
          and coalesce(char_length(btrim(pagamento_fora_do_cadastro_motivo)), 0) >= 10
        )
      );
  end if;

  -- O meio trocado sai no arquivo do banco e no PDF: mesma régua das CHECKs
  -- `fornecedores_pix_formato` e `fornecedores_banco_completo` (decisão 101).
  -- `coalesce(…, false)`: CHECK com NULL passa, e foi isso que a 180002
  -- precisou consertar no cadastro.
  if not exists (select 1 from pg_constraint where conname = 'pp_fora_do_cadastro_formato') then
    alter table public.pedidos_compra
      add constraint pp_fora_do_cadastro_formato check (
        pagamento_fora_do_cadastro_meio is null
        or coalesce(
          (
            pagamento_fora_do_cadastro_meio = 'pix'
            and (
              (fornecedor_pix_tipo = 'cpf' and fornecedor_pix_chave ~ '^[0-9]{11}$')
              or (fornecedor_pix_tipo = 'cnpj' and fornecedor_pix_chave ~ '^[0-9]{14}$')
              or (fornecedor_pix_tipo = 'telefone' and fornecedor_pix_chave ~ '^\+55[1-9]{2}9[0-9]{8}$')
              or (
                fornecedor_pix_tipo = 'email'
                and length(fornecedor_pix_chave) <= 77
                and fornecedor_pix_chave ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$'
              )
              or (
                fornecedor_pix_tipo = 'aleatoria'
                and fornecedor_pix_chave ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              )
            )
          )
          or (
            pagamento_fora_do_cadastro_meio = 'conta'
            and fornecedor_banco_codigo ~ '^[0-9]{3}$'
            and fornecedor_banco_nome is not null
            and fornecedor_agencia ~ '^[0-9]{3,5}$'
            and (fornecedor_agencia_dv is null or fornecedor_agencia_dv ~ '^[0-9X]$')
            and fornecedor_conta ~ '^[0-9]{4,12}$'
            and fornecedor_conta_dv ~ '^[0-9X]$'
            and fornecedor_tipo_conta is not null
          ),
          false
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pp_fora_do_cadastro_aprovado') then
    alter table public.pedidos_compra
      add constraint pp_fora_do_cadastro_aprovado check (
        pagamento_fora_do_cadastro_meio is null
        or status not in ('aprovada', 'pago')
        or pagamento_fora_do_cadastro_aprovado_em is not null
      );
  end if;
end $$;
