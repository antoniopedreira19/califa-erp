-- ============================================================================
-- Fix do check `pp_fora_do_cadastro_formato` no ramo 'link' (16/11/2026).
--
-- Por quê: a migration 20261116800001 criou o ramo 'link' com o regex
--   `^https?://.{3,2045}$`. O motor de regex do Postgres limita o
-- quantificador `{n,m}` a 255 (DUPINF); qualquer valor acima aborta a
-- avaliação com "invalid regular expression: invalid repetition count(s)".
-- O erro só aparecia ao salvar PP com meio = 'link' (os outros ramos não
-- compilam esse pedaço do regex), e travou o primeiro salvamento real.
--
-- O que muda: o quantificador superior sai (`{3,}` em vez de `{3,2045}`).
-- O teto de 2048 caracteres continua sendo feito pelo `length(...) <= 2048`
-- logo depois, que é o guarda real do tamanho do link.
--
-- Mudança no constraint de check, sem tocar linha nenhuma: nenhuma PP foi
-- gravada com meio = 'link' até agora (o próprio bug impediu).
-- ============================================================================

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
          and pagamento_fora_do_cadastro_link ~ '^https?://.{3,}$'
          and length(pagamento_fora_do_cadastro_link) <= 2048
        )
      ),
      false
    )
  );
