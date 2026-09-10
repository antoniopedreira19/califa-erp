-- A PP fotografa os dados de pagamento do fornecedor no envio ao
-- financeiro — decisão 067, 09/09/2026.
--
-- O problema que isso resolve: desde a decisão 067 o campo de fornecedor
-- da PP tem um lápis que abre o cadastro daquele fornecedor. Quem gera a
-- PP passou a poder trocar banco, agência, conta e PIX de alguém que JÁ
-- tem PP esperando pagamento no financeiro. Como o financeiro pagava
-- lendo o cadastro ao vivo, a PP passaria a apontar para uma conta que
-- não era a combinada quando ela foi aprovada.
--
-- A regra que o Tiago escolheu:
--   * a PP guarda os dados de pagamento;
--   * o financeiro paga PELA FOTO, não pelo cadastro de hoje;
--   * o cadastro novo vale para as PRÓXIMAS PPs;
--   * a PP cujo cadastro mudou depois ganha um ASTERISCO, que a tela
--     calcula comparando a foto com o cadastro atual — por isso não há
--     coluna de "mudou": comparar é exato e pega o caso de mudar e voltar
--     atrás, que um `updated_at` não pega.
--
-- QUANDO a foto é tirada: junto do PDF da PP, nas três rotas que o
-- montam (emitir, editar a gerada, reenviar a rejeitada). É o PDF que o
-- financeiro confere na hora de pagar — foto e documento saem do MESMO
-- `select` do fornecedor para não poderem divergir. O congelamento
-- acontece no envio porque a partir dali nada mais re-monta o PDF nem
-- re-tira a foto.
--
-- Os nomes espelham `fornecedores` com o prefixo `fornecedor_`, e os dois
-- enums são os mesmos da tabela de origem (`tipo_conta_bancaria`,
-- `pix_tipo_chave`) para a foto não poder guardar um valor que o cadastro
-- não aceitaria.
--
-- Aditiva: dez colunas novas, todas null-áveis. Nenhuma linha existente
-- perde valor — o backfill do fim só PREENCHE o que está vazio.
-- GRANT: `pedidos_compra` tem grant no nível da TABELA
-- (`authenticated=arwd`), sem grant por coluna; coluna nova já entra
-- coberta. Índice: nenhum — as colunas não são filtro nem FK, são leitura
-- junto da linha da PP.

alter table public.pedidos_compra
  add column if not exists fornecedor_banco_codigo text,
  add column if not exists fornecedor_banco_nome text,
  add column if not exists fornecedor_agencia text,
  add column if not exists fornecedor_agencia_dv text,
  add column if not exists fornecedor_conta text,
  add column if not exists fornecedor_conta_dv text,
  add column if not exists fornecedor_tipo_conta public.tipo_conta_bancaria,
  add column if not exists fornecedor_pix_tipo public.pix_tipo_chave,
  add column if not exists fornecedor_pix_chave text,
  add column if not exists dados_pagamento_congelados_em timestamptz;

comment on column public.pedidos_compra.fornecedor_banco_codigo is
  'Foto do cadastro do fornecedor no envio ao financeiro (decisão 067). O financeiro paga por estas colunas, não pelo cadastro ao vivo.';
comment on column public.pedidos_compra.fornecedor_pix_chave is
  'Foto da chave PIX no envio ao financeiro (decisão 067). Ver `dados_pagamento_congelados_em`.';
comment on column public.pedidos_compra.dados_pagamento_congelados_em is
  'Quando a foto foi tirada — o mesmo instante em que o PDF da PP foi montado. Enviada ao financeiro, nada mais re-monta o PDF, e é aí que a foto congela. Null = verba de produção (sem fornecedor) ou linha anterior à decisão 067.';

-- Backfill das PPs que já estão no financeiro.
--
-- Não existe histórico do cadastro: a única foto possível para elas é o
-- cadastro de HOJE, que é também o que o financeiro estava lendo até
-- agora — ou seja, o backfill não muda o que ninguém vê, só passa a
-- guardar. `dados_pagamento_congelados_em` recebe `enviada_financeiro_em`
-- e não `now()`, para não mentir sobre quando a foto valeria.
--
-- Só toca linha com as dez colunas vazias e com fornecedor: verba de
-- produção não tem fornecedor, e PP nunca enviada não tem foto a tirar.
update public.pedidos_compra pc
set
  fornecedor_banco_codigo = f.banco_codigo,
  fornecedor_banco_nome = f.banco_nome,
  fornecedor_agencia = f.agencia,
  fornecedor_agencia_dv = f.agencia_dv,
  fornecedor_conta = f.conta,
  fornecedor_conta_dv = f.conta_dv,
  fornecedor_tipo_conta = f.tipo_conta,
  fornecedor_pix_tipo = f.pix_tipo,
  fornecedor_pix_chave = f.pix_chave,
  dados_pagamento_congelados_em = pc.enviada_financeiro_em
from public.fornecedores f
where f.id = pc.fornecedor_id
  and pc.enviada_financeiro_em is not null
  and pc.dados_pagamento_congelados_em is null;
