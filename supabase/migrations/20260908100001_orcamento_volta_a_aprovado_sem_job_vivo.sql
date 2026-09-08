-- 20260908100001 — o orçamento sem job vivo volta a `aprovado`
--
-- Decisão 057 (docs/decisions/057-rejeicao-e-cancelamento-do-envio-a-abertura.md).
--
-- Regra que o código passa a garantir a partir desta data:
--
--   orcamentos.status = 'job_criado'  <=>  existe job do orçamento fora de `cancelado`
--   orcamentos.status = 'aprovado'    <=>  versão aprovada e nenhum job vivo
--
-- Até aqui o "Cancelar job" da página do job (pré-abertura) cancelava o
-- job e deixava o orçamento em `job_criado`. O orçamento ficava preso:
-- não conseguia reenviar (o envio exige `aprovado`) nem desaprovar (a
-- tela lê "Job criado"). Aconteceu com TESTE-0005/26-01 (JOB-0019).
--
-- Este backfill devolve a `aprovado` só os orçamentos que estão em
-- `job_criado` SEM nenhum job vivo. Hoje isso é exatamente uma linha.
-- Idempotente: rodar de novo não encontra nada.
--
-- Autorizado pelo Tiago em 08/09/2026 (é sobrescrita de valor existente).
--
-- Deliberadamente de fora: saves e BVs pendurados no job cancelado.
-- O JOB-0019 não tem nenhum dos dois; a action nova
-- `cancelarEnvioParaAbertura` devolve os dois à versão daqui em diante.

update public.orcamentos o
set status = 'aprovado'
where o.status = 'job_criado'
  and o.versao_aprovada_id is not null
  and not exists (
    select 1
    from public.jobs j
    where j.orcamento_id = o.id
      and j.status <> 'cancelado'
  );
