-- ===========================================================================
-- A PP congela QUAIS documentos estavam anexados quando foi aprovada
-- ===========================================================================
-- Pedido do Tiago em 10/09/2026, dentro da reforma da tela de aprovação.
--
-- O que já existia: `aprovada_por` e `aprovada_em` na própria PP, mais um
-- evento `pedido_compra.aprovada` em `audit_events` com valor, job, data de
-- pagamento e forma. **Quem** liberou e **quando** nunca foi o problema.
--
-- O que faltava: COM QUAL DOCUMENTO. Sem isso não há como responder "que
-- nota o financeiro estava vendo quando liberou esses R$ 9.000?".
--
-- ⚠️ O Tiago observou, com razão, que PP aprovada trava: `editarPP` e
-- `reenviarPP` só aceitam status `gerada` ou `rejeitada`, então a produção
-- não troca anexo de PP aprovada. Isso REDUZ o valor deste registro, e é
-- honesto dizer. Ele continua valendo por dois casos estreitos:
--
--   1. provar que uma PP foi aprovada **sem documento nenhum** — o registro
--      mais valioso dos dois, e o único que nenhuma outra tabela guarda;
--   2. o ciclo desaprovar → reenviar com OUTRO documento → aprovar de novo.
--      `desaprovarPP` existe e devolve a PP para `em_avaliacao`; a partir
--      daí o anexo pode mudar, e sem este congelamento a troca não deixa
--      rastro.
--
-- Por que na PP, e não só no `audit_events`: a RLS de `audit_events` libera
-- SELECT apenas para admin do tenant (`is_tenant_admin`) ou para o próprio
-- ator. Hoje os 10 profiles são administradores e ninguém sentiria; no dia
-- em que existir um papel `financeiro` puro, a seção "Histórico" da tela da
-- PP ficaria VAZIA, sem explicar por quê. Lido da PP, quem enxerga a PP
-- enxerga o histórico dela. O evento de auditoria continua sendo gravado —
-- ele é o registro canônico e imutável; a coluna é a cópia que a tela lê.
--
-- É o mesmo padrão da decisão 067, que congelou os dados bancários do
-- fornecedor na PP: guardar no registro operacional o que valia no momento
-- da decisão, para que o passado não mude quando o cadastro mudar.

alter table public.pedidos_compra
  add column if not exists anexos_na_aprovacao jsonb;

comment on column public.pedidos_compra.anexos_na_aprovacao is
  'Foto dos documentos anexados no instante da aprovação: [{id, nome, tamanho_bytes}]. `[]` = aprovada sem documento nenhum. NULL = aprovada antes de 11/09/2026, quando o registro passou a existir — as duas coisas são diferentes e a tela as distingue.';

-- Sem backfill de propósito: para as 8 PPs aprovadas antes desta migration
-- não existe registro do que estava anexado NAQUELE momento, e inventar a
-- lista atual seria fabricar uma prova. `NULL` diz "não registrado"; `[]`
-- diz "aprovada sem documento". A tela mostra as duas com textos
-- diferentes.
