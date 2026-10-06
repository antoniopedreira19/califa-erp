-- 06/10/2026: o mesmo rascunho não vira dois orçamentos.
--
-- Em 05/10/2026 a produtora criou 9 orçamentos no AMB-P017/26 pela visão
-- agregada, salvando a cada um. A tela não trocava o orçamento novo pelo
-- gravado depois do "Salvar alterações": o próximo salvamento o mandava de
-- novo como novo, e o servidor o criava outra vez. Nove salvamentos deram
-- 45 orçamentos — 36 cópias idênticas.
--
-- A tela foi corrigida (o servidor devolve os ids e o editor passa a tratar
-- o orçamento como gravado). Esta coluna é a trava do banco, para o caso de
-- a tela voltar a errar ou de a resposta do salvamento se perder no caminho:
-- cada orçamento novo da agregada leva o uuid gerado na tela ao ser criado,
-- e o índice único recusa o segundo insert do mesmo rascunho.
--
-- Nulo nos orçamentos de antes e nos que nascem pela tela "Novo orçamento",
-- que só cria um por envio do formulário. Aditiva: coluna nova e índice.

alter table public.orcamentos
  add column if not exists chave_rascunho uuid;

comment on column public.orcamentos.chave_rascunho is
  'Uuid do rascunho que criou o orçamento na visão agregada. O índice único '
  'uniq_orcamentos_chave_rascunho impede que o mesmo rascunho vire dois '
  'orçamentos (36 cópias no AMB-P017/26 em 05/10/2026). Nulo quando o '
  'orçamento nasceu por outro caminho.';

create unique index if not exists uniq_orcamentos_chave_rascunho
  on public.orcamentos (tenant_id, chave_rascunho)
  where chave_rascunho is not null;
