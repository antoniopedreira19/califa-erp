-- ---------------------------------------------------------------------------
-- O CNAE passa a ser da nota, e quem informa é o financeiro.
--
-- Migration irmã da 20260831090001, que tirou o CNAE do envio para
-- faturamento. Ele reaparece aqui, no lugar certo: na nota, preenchido por
-- quem a emite, no drawer "Faturar".
--
-- Obrigatório de verdade, e não só no formulário: CNAE errado é problema
-- fiscal, e a trava não pode viver só no navegador (`CLAUDE.md`). Segue
-- texto livre nesta fase — não existe cadastro de CNAE no projeto, mesma
-- decisão de 13/08/2026 que valia no envio.
--
-- BACKFILL DAS NOTAS QUE JÁ EXISTEM: as duas notas emitidas até aqui são de
-- teste e nasceram antes do campo, então não há CNAE verdadeiro para elas.
-- Recebem um marcador explícito em vez de um código inventado — um número
-- plausível seria lido como dado real por quem abrisse a nota depois.
-- Autorizado pelo Tiago em 31/08/2026: a base é de teste e será zerada
-- antes da implantação; o que precisa estar certo agora é a lógica.
-- ---------------------------------------------------------------------------

alter table public.faturamentos
  add column if not exists cnae text;

-- Preenche o que está vazio; não sobrescreve nada já informado, para a
-- migration poder rodar de novo sem estrago.
update public.faturamentos
   set cnae = 'NAO INFORMADO — nota anterior a 31/08/2026'
 where cnae is null;

alter table public.faturamentos
  alter column cnae set not null;

alter table public.faturamentos
  drop constraint if exists chk_faturamento_cnae;

alter table public.faturamentos
  add constraint chk_faturamento_cnae check (length(trim(cnae)) > 0);

comment on column public.faturamentos.cnae is
  'CNAE usado na emissao da nota, informado pelo financeiro no drawer Faturar. Texto livre - nao existe cadastro de CNAE no projeto. Antes de 31/08/2026 o campo era pedido a producao no envio para faturamento (jobs_envio_faturamento.cnae), que virou historico.';
