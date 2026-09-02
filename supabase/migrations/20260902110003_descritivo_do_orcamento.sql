-- O orcamento ganha Descritivo, para adiantar o do envio para abertura.
--
-- O "Descritivo" que o financeiro le no job e `jobs.observacoes`, e hoje
-- so nasce no modal de envio para abertura — ou seja, no fim da linha,
-- quando quem escreve ja perdeu o contexto da negociacao.
--
-- Com o campo aqui, o GP escreve enquanto monta o orcamento e o modal de
-- envio abre PRE-PREENCHIDO com esse texto (pedido do Tiago, 02/09/2026).
-- Continua editavel la: o descritivo do orcamento e um ponto de partida,
-- nao um valor travado, e quem envia pode ajustar sem voltar aqui.
--
-- Mesmo teto de 500 caracteres do destino (`OBSERVACOES_MAX` em
-- lib/validations/abertura-job.ts e o CHECK de jobs.observacoes): deixar
-- este campo maior so criaria texto que nao caberia la adiante.

alter table public.orcamentos
  add column if not exists descritivo text;

alter table public.orcamentos
  drop constraint if exists orcamentos_descritivo_tamanho;
alter table public.orcamentos
  add constraint orcamentos_descritivo_tamanho
  check (descritivo is null or char_length(descritivo) <= 500);

comment on column public.orcamentos.descritivo is
  'Contexto do job escrito ja no orcamento. Pre-preenche o Descritivo (jobs.observacoes) no envio para abertura, onde segue editavel. Teto de 500 = OBSERVACOES_MAX.';
