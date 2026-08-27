-- =====================================================================
-- Backfill: previsão de recebimento dos jobs anteriores a 17/08/2026
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- `jobs_previsao_recebimento` nasceu em 17/08/2026 (migration
-- 20260817000003). Todo job aberto no financeiro ANTES disso ficou sem
-- nenhuma linha nela — e, como o branch 7 da `vw_fluxo_caixa` projeta a
-- entrada por essa tabela, a aba "Fluxo de Caixa do Job" desses jobs
-- nasce com a coluna Entradas inteira vazia. Foi exatamente o que
-- apareceu no JOB-0013 e abriu a investigação de 26/08/2026.
--
-- São 10 jobs abertos sem previsão. Destes, 8 têm
-- `jobs.data_prevista_faturamento` preenchida e entram aqui.
--
-- DECISÃO DO TIAGO (26/08/2026): uma parcela única, no valor de
-- `jobs.faturamento_previsto`, na data de `jobs.data_prevista_faturamento`.
--
-- Não existe coluna de prazo de recebimento em lugar nenhum do banco —
-- conferido em `jobs`, `clientes`, `projetos`, `projetos_financeiro`,
-- `orcamentos` e `versoes_orcamento` —, então a data prevista de
-- faturamento do próprio job é a única régua real disponível. Somar um
-- prazo por cima seria inventar número.
--
-- FICAM DE FORA, e de propósito:
--
--   • JOB-0001 e JOB-0002 — `data_prevista_faturamento` NULA. Sem data
--     não há o que gravar, e chutar uma seria pior que a coluna vazia.
--     Os dois seguem sem previsão até alguém informar a data pela tela
--     "editar registro de abertura".
--   • Job que já TEM previsão — o `not exists` protege JOB-0015 e
--     JOB-0016, que foram abertos depois da tabela existir.
--   • Job fora de `aberto`/`em_producao` — encerrado, cancelado e
--     aguardando abertura não projetam entrada nenhuma na view.
--
-- ⚠️ Vale notar: JOB-0001 e JOB-0010 já têm envio para faturamento, e
-- pela decisão 018 §1 o envio SOBRESCREVE a previsão da abertura na
-- leitura. A linha gravada aqui para o JOB-0010 não vai aparecer no
-- fluxo enquanto o envio existir — ela entra como registro do que se
-- previa na abertura, que é a função da tabela, e volta a valer se o
-- envio for desfeito.
--
-- LADO DESTRUTIVO: NENHUM. É INSERT que só preenche o que estava vazio —
-- o `not exists` garante que nenhuma previsão existente é sobrescrita, e
-- nenhuma linha é apagada ou alterada. `created_by` fica NULO de
-- propósito: não houve pessoa decidindo esta data, e o nulo é o que
-- distingue o backfill de uma previsão informada na abertura.
-- =====================================================================

insert into public.jobs_previsao_recebimento
  (tenant_id, job_id, ordem, data_prevista, valor, created_by)
select
  j.tenant_id,
  j.id,
  1,
  j.data_prevista_faturamento,
  j.faturamento_previsto,
  null
from public.jobs j
where j.status in ('aberto', 'em_producao')
  and j.data_prevista_faturamento is not null
  and coalesce(j.faturamento_previsto, 0) > 0
  and not exists (
    select 1
      from public.jobs_previsao_recebimento p
     where p.job_id = j.id
  );
