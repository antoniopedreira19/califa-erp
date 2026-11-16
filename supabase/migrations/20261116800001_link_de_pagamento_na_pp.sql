-- ============================================================================
-- Link de pagamento na PP (16/11/2026).
--
-- Por quê: alguns fornecedores, em vez de PIX aleatória ou boleto, mandam um
-- link de pagamento (Mercado Pago, Stripe, PagSeguro, Asaas…) que o
-- financeiro abre no navegador e paga ali mesmo. O Pagamento da PP ganha
-- "Link de pagamento" ao lado de Cadastro do fornecedor, Chave aleatória,
-- Boleto e Guia. Não é anexo: é uma URL que a produção cola no formulário e
-- que sai no PDF para o financeiro clicar/digitar.
--
-- O que muda no banco (tudo aditivo, nenhuma linha é tocada):
--   1. Nova coluna `pedidos_compra.pagamento_fora_do_cadastro_link` (text,
--      nullable). Guarda a URL colada na PP. Fora dos 9 campos de foto do
--      cadastro (que a chave aleatória, a conta etc. espelham) porque o link
--      não vem do cadastro — é dado só desta PP.
--   2. `pp_fora_do_cadastro_meio_valido` aceita 'link', com a mesma
--      exigência de fornecedor dos outros meios.
--   3. `pp_fora_do_cadastro_formato` aceita o ramo link: URL http/https com
--      até 2048 caracteres. O ramo de link NÃO olha para os campos de conta
--      ou PIX (como boleto e guia).
--   4. CHECK novo `pp_fora_do_cadastro_link_coerente`: a coluna link SÓ
--      pode ter valor quando o meio é 'link'. Nos outros meios, fica nula.
--
-- Fora daqui, de propósito: a regra de que o envio ao financeiro pede NF
-- quando o meio é 'link' (mesmo tratamento da chave aleatória) fica no
-- servidor (Zod e actions). A remessa não paga link, como não paga boleto
-- nem guia — isso também fica fora deste arquivo.
--
-- Sem tabela, função ou policy nova: GRANT, RLS e índices ficam como estão.
-- ============================================================================

-- 1. A coluna --------------------------------------------------------------
alter table public.pedidos_compra
  add column if not exists pagamento_fora_do_cadastro_link text;

comment on column public.pedidos_compra.pagamento_fora_do_cadastro_link is
  'Decisão 16/11/2026: a URL do link de pagamento que o fornecedor mandou, quando pagamento_fora_do_cadastro_meio = ''link''. http/https, até 2048 caracteres. Null nos demais meios.';

-- 2. O meio 'link' --------------------------------------------------------
alter table public.pedidos_compra
  drop constraint if exists pp_fora_do_cadastro_meio_valido;
alter table public.pedidos_compra
  add constraint pp_fora_do_cadastro_meio_valido
  check (
    pagamento_fora_do_cadastro_meio is null
    or (
      pagamento_fora_do_cadastro_meio = any (array['pix'::text, 'conta'::text, 'boleto'::text, 'guia'::text, 'link'::text])
      and fornecedor_id is not null
    )
  );

comment on column public.pedidos_compra.pagamento_fora_do_cadastro_meio is
  'Decisão 127: ''pix'' ou ''conta'' quando esta PP paga fora do cadastro do fornecedor (a foto fornecedor_* é o cadastro com só esse meio trocado). Decisão 161: ''boleto'', pago pelo boleto anexado. Decisão 227: ''guia'', taxa ou licença de órgão público paga pela guia anexada, sem NF. 16/11/2026: ''link'', pago pelo link que a produção cola em pagamento_fora_do_cadastro_link. Null = paga pelo cadastro.';

-- 3. O formato da foto aceita o link --------------------------------------
-- Os ramos de PIX, conta, boleto e guia seguem iguais às decisões 127, 161 e 227.
alter table public.pedidos_compra
  drop constraint if exists pp_fora_do_cadastro_formato;
alter table public.pedidos_compra
  add constraint pp_fora_do_cadastro_formato
  check (
    pagamento_fora_do_cadastro_meio is null
    or coalesce(
      (
        (
          pagamento_fora_do_cadastro_meio = 'pix'
          and (
            (fornecedor_pix_tipo = 'cpf'::pix_tipo_chave and fornecedor_pix_chave ~ '^[0-9]{11}$')
            or (fornecedor_pix_tipo = 'cnpj'::pix_tipo_chave and fornecedor_pix_chave ~ '^[0-9]{14}$')
            or (fornecedor_pix_tipo = 'telefone'::pix_tipo_chave and fornecedor_pix_chave ~ '^\+55[1-9]{2}9[0-9]{8}$')
            or (
              fornecedor_pix_tipo = 'email'::pix_tipo_chave
              and length(fornecedor_pix_chave) <= 77
              and fornecedor_pix_chave ~ '^[a-z0-9.!#$&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$'
            )
            or (
              fornecedor_pix_tipo = 'aleatoria'::pix_tipo_chave
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
        )
        or pagamento_fora_do_cadastro_meio = 'boleto'
        or pagamento_fora_do_cadastro_meio = 'guia'
        or (
          pagamento_fora_do_cadastro_meio = 'link'
          and pagamento_fora_do_cadastro_link ~ '^https?://.{3,2045}$'
          and length(pagamento_fora_do_cadastro_link) <= 2048
        )
      ),
      false
    )
  );

-- 4. O link só existe quando o meio é 'link' -------------------------------
alter table public.pedidos_compra
  drop constraint if exists pp_fora_do_cadastro_link_coerente;
alter table public.pedidos_compra
  add constraint pp_fora_do_cadastro_link_coerente
  check (
    pagamento_fora_do_cadastro_link is null
    or pagamento_fora_do_cadastro_meio = 'link'
  );
