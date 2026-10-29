-- ============================================================================
-- Decisão 227 (29/10/2026): a PP paga por guia — taxa, licença ou alvará de
-- órgão público, sem NF.
--
-- Por quê: licença de filmagem, uso de espaço público e taxas parecidas são
-- pagas por uma guia que a prefeitura (ou outro órgão) emite. Não existe NF
-- nesse pagamento, e a PP paga por boleto exige a NF (decisão 161). O Tiago
-- decidiu um quarto meio no Pagamento da PP, "Guia", ao lado de Cadastro do
-- fornecedor, Chave aleatória e Boleto, e um tipo de documento novo, "Guia".
-- O envio ao financeiro pede o anexo do tipo Guia e não pede NF.
--
-- O que muda no banco (tudo aditivo, nenhuma linha é tocada):
--   1. O valor `guia` no enum `documento_tipo`, depois de `boleto`. Vale nas
--      cinco tabelas de anexo; a prestação de verba não muda (a trava dela é
--      das funções da prestação, que não aceitam o tipo novo como gasto).
--   2. `pedidos_compra.pagamento_fora_do_cadastro_meio` aceita 'guia', com a
--      mesma exigência de fornecedor que os outros meios.
--   3. O formato da foto aceita 'guia' como aceita 'boleto': a foto é o
--      cadastro como está, e o PDF troca só a linha do PIX por "Guia".
--
-- Fora daqui, de propósito: a regra de que o envio pede o anexo do tipo Guia
-- e não pede NF fica no servidor (Zod e actions), como a do boleto. O código
-- de barras da guia e a forma como ela chega ao Contas a Pagar ficam para
-- depois (Tiago, 29/10). A remessa não paga guia, como não paga boleto.
--
-- Sem tabela, função ou policy nova: GRANT, RLS e índices ficam como estão.
-- ============================================================================

-- 1. O tipo de documento ----------------------------------------------------
alter type public.documento_tipo add value if not exists 'guia' after 'boleto';

comment on type public.documento_tipo is
  'Que documento o anexo é. Acrescentar valor aqui é aditivo — o enum começou no conjunto mínimo que o time nomeou (28/08/2026). "fatura" entrou na decisão 178 (15/10/2026); "guia" (taxa, licença ou alvará de órgão público), na decisão 227 (29/10/2026).';

-- 2. O meio 'guia' --------------------------------------------------------
alter table public.pedidos_compra
  drop constraint if exists pp_fora_do_cadastro_meio_valido;
alter table public.pedidos_compra
  add constraint pp_fora_do_cadastro_meio_valido
  check (
    pagamento_fora_do_cadastro_meio is null
    or (
      pagamento_fora_do_cadastro_meio = any (array['pix'::text, 'conta'::text, 'boleto'::text, 'guia'::text])
      and fornecedor_id is not null
    )
  );

comment on column public.pedidos_compra.pagamento_fora_do_cadastro_meio is
  'Decisão 127: ''pix'' ou ''conta'' quando esta PP paga fora do cadastro do fornecedor (a foto fornecedor_* é o cadastro com só esse meio trocado). Decisão 161: ''boleto'', pago pelo boleto anexado. Decisão 227: ''guia'', taxa ou licença de órgão público paga pela guia anexada, sem NF. Null = paga pelo cadastro.';

-- 3. O formato da foto aceita a guia --------------------------------------
-- Os ramos de PIX, conta e boleto são os das decisões 127 e 161, sem mudança.
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
      ),
      false
    )
  );
