-- Decisão 161 (09/10/2026): PP paga por boleto ou chave aleatória, e
-- fornecedor sem conta nem PIX no cadastro.
--
-- Por quê: há fornecedor que não tem meio de pagamento fixo — na hora de
-- cobrar ele manda um boleto ou uma chave PIX aleatória temporária. A PP
-- já trocava o meio "só nesta PP" (decisão 127: outro PIX / outra conta);
-- agora as opções são chave aleatória e boleto, sem motivo (o motivo é o
-- meio que o fornecedor escolheu), e o cadastro ganha a marcação "Sem conta
-- nem PIX", que obriga a PP a escolher uma das duas.
--
-- O que muda no banco (tudo aditivo, nada de dado é tocado):
--   1. fornecedores.sem_dados_pagamento — a marcação, com a trava de que
--      marcado não tem conta nem chave PIX. Os 49 ativos de hoje nascem
--      desmarcados (todos têm conta, PIX ou os dois).
--   2. pedidos_compra.pagamento_fora_do_cadastro_meio aceita 'boleto'. O
--      'conta' continua aceito para o legado (nenhuma PP o usou até hoje;
--      a tela não oferece mais).
--   3. O motivo passa a ser opcional quando há meio, e continua vazio
--      quando não há. Os motivos já gravados ficam como estão.
--   4. O formato da foto aceita 'boleto': a foto do boleto é o cadastro
--      como está — o PDF troca só a linha do PIX por "Boleto".
--
-- Fora daqui, de propósito: a regra de que a chave da PP é só aleatória e
-- a de que o boleto exige o anexo do tipo Boleto ficam no servidor (Zod e
-- actions), como as demais regras do envio. A remessa não paga boleto
-- (segmento J ainda não existe): a PP paga por boleto sai pelo arquivo.

-- 1. A marcação no cadastro -------------------------------------------------
alter table public.fornecedores
  add column if not exists sem_dados_pagamento boolean not null default false;

comment on column public.fornecedores.sem_dados_pagamento is
  'Decisão 161: o fornecedor não tem conta nem PIX fixos — a cada PP ele manda um boleto ou uma chave aleatória, e a PP precisa escolher um dos dois.';

alter table public.fornecedores
  drop constraint if exists fornecedores_sem_dados_pagamento_vazio;
alter table public.fornecedores
  add constraint fornecedores_sem_dados_pagamento_vazio
  check (
    not sem_dados_pagamento
    or (banco_codigo is null and pix_tipo is null and pix_chave is null)
  );

-- 2. O meio 'boleto' ------------------------------------------------------
alter table public.pedidos_compra
  drop constraint if exists pp_fora_do_cadastro_meio_valido;
alter table public.pedidos_compra
  add constraint pp_fora_do_cadastro_meio_valido
  check (
    pagamento_fora_do_cadastro_meio is null
    or (
      pagamento_fora_do_cadastro_meio = any (array['pix'::text, 'conta'::text, 'boleto'::text])
      and verba_producao = false
    )
  );

-- 3. Motivo opcional --------------------------------------------------------
alter table public.pedidos_compra
  drop constraint if exists pp_fora_do_cadastro_motivo;
alter table public.pedidos_compra
  add constraint pp_fora_do_cadastro_motivo
  check (
    pagamento_fora_do_cadastro_meio is not null
    or pagamento_fora_do_cadastro_motivo is null
  );

-- 4. O formato da foto aceita o boleto ------------------------------------
-- Os ramos de PIX e de conta são os da decisão 127, sem mudança.
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
      ),
      false
    )
  );
