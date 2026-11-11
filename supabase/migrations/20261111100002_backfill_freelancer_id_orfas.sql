-- Backfill: resolve freelancer_id das solicitações órfãs que o trigger
-- security-invoker tinha deixado passar.
--
-- Contexto: a migration 20261103300001 criou o trigger + backfill, mas a
-- função nasceu security-invoker. Isso fez com que solicitações criadas
-- por GPs (sem permissão de SELECT em freelancers pra freelas fora da
-- responsabilidade direta) continuassem com freelancer_id = NULL, mesmo
-- quando o CPF digitado batia com um cadastro existente.
--
-- A migration 20261111100001 ajustou a função pra security-definer, o
-- que resolve do presente pra frente. Esta migration limpa o passado:
-- repete o backfill com a identidade correta (owner da função, bypassa
-- RLS) e pega as 5 solicitações órfãs identificadas no tenant Agência
-- California (todas criadas entre 06/11 e 11/11).
--
-- Efeito colateral: solicitações aprovadas que estavam classificadas
-- como "contratação" na listagem passam a aparecer como "renovação"
-- (regra em page.tsx:220 / novidades.ts:284). Não cria contrato — as
-- aprovadas sem contrato_id continuam precisando de intervenção manual
-- (chamar criar_contrato_de_renovacao) pra subir pra Novidades.
--
-- Backfill idempotente: só toca linhas com freelancer_id IS NULL;
-- re-execução é no-op.

update public.freelancer_solicitacoes s
set freelancer_id = f.id
from public.freelancers f
where f.cpf = s.cpf_freela
  and f.tenant_id = s.tenant_id
  and s.freelancer_id is null
  and s.cpf_freela is not null;
