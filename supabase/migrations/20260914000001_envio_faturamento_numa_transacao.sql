-- 20260914000001 — o envio para faturamento grava envio e parcelas numa transação só
--
-- O DEFEITO (confirmado em 14/09/2026, decisão 075)
--
-- `enviarJobParaFaturamento` fazia dois INSERTs seguidos pelo PostgREST —
-- duas transações. Se o segundo (as parcelas) falhasse, a action tentava
-- desfazer o primeiro com um DELETE em `jobs_envio_faturamento`, sem
-- conferir o erro. Só que `authenticated` não tem DELETE nessa tabela, nem
-- policy para ele: a 20260813000018 decidiu que envio é evento, não
-- rascunho. O DELETE voltava `42501 permission denied` em silêncio.
--
-- Resultado: um envio gravado SEM parcela. A `vw_faturamento_pendente` lê as
-- parcelas, então o job some da fila do financeiro; e o `unique (job_id)`
-- impede o GP de reenviar. Travado dos dois lados.
--
-- Reproduzido como `authenticated`, numa transação com rollback, no JOB-0033
-- do Projeto Teste: envio gravado; parcelas recusadas com a data
-- `2026-02-30` (passa no regex do Zod, o Postgres recusa); DELETE negado;
-- reenvio barrado pelo unique. Na data da correção havia 0 envios sem
-- parcela no banco — nada a limpar.
--
-- A CORREÇÃO
--
-- Uma RPC que faz os dois INSERTs dentro da mesma transação. Se as parcelas
-- falham, o envio não chega a existir. Nenhum DELETE é aberto para o cliente.
--
-- SECURITY INVOKER (o default, explicitado): roda com o papel de quem
-- chamou, então o RLS de tenant e os GRANTs valem exatamente como nos
-- INSERTs diretos de antes. Não é bypass — é só empacotamento transacional,
-- a mesma mecânica da 20260904100001 (`deletar_grupo_orcamento`).
--
-- As regras de negócio (job aberto, errata pendente, valor relido de
-- `jobs.faturamento_previsto`, soma das parcelas, portal do cliente do job)
-- continuam na server action, que é quem devolve a frase certa para a tela.
-- A única regra que mora aqui é a que o próprio defeito expôs: envio sem
-- parcela não pode existir.
--
-- DELIBERADAMENTE DE FORA
--
-- A unicidade do envio por job fica como está. Há uma frente de design para
-- vários envios por job nos jobs Fee/Always On; esta migration não a
-- antecipa.
--
-- Mudança ADITIVA: cria função nova, não altera tabela nem dado.

create or replace function public.enviar_job_para_faturamento(payload jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_tenant_id uuid := (payload->>'tenant_id')::uuid;
  v_job_id    uuid := (payload->>'job_id')::uuid;
  v_envio_id  uuid;
  v_parcelas  integer;
begin
  if jsonb_typeof(payload->'parcelas') is distinct from 'array'
     or jsonb_array_length(payload->'parcelas') = 0 then
    raise exception 'Informe ao menos uma parcela de faturamento.'
      using errcode = 'check_violation';
  end if;

  insert into jobs_envio_faturamento (
    tenant_id, job_id, valor_faturado, numero_po, data_faturamento,
    descricao_nf, portal_id, portal_url, enviado_por
  ) values (
    v_tenant_id,
    v_job_id,
    (payload->>'valor_faturado')::numeric,
    nullif(payload->>'numero_po', ''),
    (payload->>'data_faturamento')::date,
    payload->>'descricao_nf',
    nullif(payload->>'portal_id', '')::uuid,
    nullif(payload->>'portal_url', ''),
    nullif(payload->>'enviado_por', '')::uuid
  )
  returning id into v_envio_id;

  insert into jobs_envio_faturamento_parcelas (
    tenant_id, envio_id, job_id, ordem, valor, data_vencimento
  )
  select v_tenant_id, v_envio_id, v_job_id, p.ordem, p.valor, p.data_vencimento
    from jsonb_to_recordset(payload->'parcelas')
      as p(ordem smallint, valor numeric, data_vencimento date);

  get diagnostics v_parcelas = row_count;
  if v_parcelas = 0 then
    raise exception 'O envio para faturamento precisa de ao menos uma parcela.'
      using errcode = 'check_violation';
  end if;

  return v_envio_id;
end;
$$;

comment on function public.enviar_job_para_faturamento(jsonb) is
  'Grava o envio do job para faturamento e as parcelas numa transacao so: se as parcelas falham, o envio nao existe. SECURITY INVOKER: RLS e GRANT valem como nos INSERTs diretos. Regras de negocio ficam na server action enviarJobParaFaturamento. Decisao 075.';

revoke all on function public.enviar_job_para_faturamento(jsonb) from public;
revoke all on function public.enviar_job_para_faturamento(jsonb) from anon;
grant execute on function public.enviar_job_para_faturamento(jsonb) to authenticated;
