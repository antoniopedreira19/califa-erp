-- Decisão 206: a exceção no fechamento do orçamento internacional.
--
-- Caso que motivou: o SOF-P002/26-01 (22/10/2026). A planilha da produção
-- fecha sem IR retido no exterior, com o ISS abatido e uma taxa cambial fixa;
-- no sistema, o GP tinha zerado as int. taxes no "Editar" (tirando o IOF
-- junto) e os Impostos BR só aceitavam 19,53%. A regra nova:
--
-- 1. O fechamento padrão do internacional é fixo: int. taxes 18,02%
--    (IR 17,64% + IOF 0,37%), Impostos BR 19,53% (a lista da decisão 096;
--    0 é a versão ainda sem alíquota escolhida) e nenhum custo de transação.
-- 2. Fugir dele é uma EXCEÇÃO daquela versão, registrada só pelo
--    administrador, com motivo, quem e quando — as três colunas abaixo. Não
--    vira regra: versão nova nasce no padrão, sem herdar a exceção.
--
-- Esta migration cria só as colunas. O gatilho que garante a regra fora
-- da tela vem em `20261022860002`, aplicado junto do deploy do código que
-- traduz as recusas dele (lição da decisão 204: recusa nova no banco antes
-- do código abre uma janela de erro genérico em produção). O gatilho:
-- - INSERT de versão internacional sem exceção nasce no padrão (int. taxes
--   18,02, custo de transação 0, alíquota fora da lista vira 19,53). A
--   coluna `percentual_int_taxes` tem default 0, e mais de um caminho cria
--   versão (orçamento novo, nova versão, duplicar, importar, planilha do
--   projeto): normalizar aqui é o que impede uma cópia de herdar a exceção.
-- - UPDATE que tira as três taxas do padrão sem exceção é recusado, e só o
--   administrador grava, troca ou remove a exceção.
-- Vale só para a sessão `authenticated`; migration e service role passam.
-- NÃO é `security definer` (a lição da decisão 072): lá dentro
-- `current_user` seria o dono da função e a trava não valeria nunca.
--
-- Aditiva: três colunas nulas, um CHECK que as linhas atuais já cumprem
-- (todas nulas) e um índice parcial. Sem backfill: o 0% do SOF
-- continua gravado na versão aprovada e se resolve pelo fluxo (devolução,
-- "Cancelar aprovação" e a exceção de 0,37%).

alter table public.versoes_orcamento
  add column if not exists excecao_fechamento_motivo text,
  -- `profiles`, como as outras autorias (`jobs.enviado_abertura_por`): o
  -- nome chega por embed na fila e na abertura do financeiro.
  add column if not exists excecao_fechamento_por uuid references public.profiles(id) on delete set null,
  add column if not exists excecao_fechamento_em timestamptz;

comment on column public.versoes_orcamento.excecao_fechamento_motivo is
  'Decisão 206: por que esta versão internacional fecha fora do padrão (int. taxes 18,02%, impostos BR 19,53%, sem custo de transação). Nulo = versão no padrão.';
comment on column public.versoes_orcamento.excecao_fechamento_por is
  'Decisão 206: o administrador que registrou a exceção no fechamento.';
comment on column public.versoes_orcamento.excecao_fechamento_em is
  'Decisão 206: quando a exceção no fechamento foi registrada.';

alter table public.versoes_orcamento
  drop constraint if exists versoes_orcamento_excecao_fechamento_completa;
alter table public.versoes_orcamento
  add constraint versoes_orcamento_excecao_fechamento_completa check (
    (excecao_fechamento_motivo is null and excecao_fechamento_em is null)
    or (
      excecao_fechamento_motivo is not null
      and btrim(excecao_fechamento_motivo) <> ''
      and excecao_fechamento_em is not null
    )
  );

-- Quase toda linha fica nula: o índice só cobre as exceções.
create index if not exists idx_versoes_orcamento_excecao_fechamento_por
  on public.versoes_orcamento (excecao_fechamento_por)
  where excecao_fechamento_por is not null;
