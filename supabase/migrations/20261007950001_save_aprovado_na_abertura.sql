-- =====================================================================
-- Decisão 155 — o save que vem com o job é aprovado na abertura
--
-- Até aqui (decisão 099 §2): os saves e consumos marcados no orçamento
-- viravam pedidos `aguardando` no "Sim, abrir job" (`save_enviar_pendentes`)
-- e iam para a faixa Saves da fila; cada um se aprovava numa revisão da
-- abertura própria, uma por linha. Com o save do orçamento inteiro
-- (decisão 154) isso virava uma revisão por linha do orçamento.
--
-- Agora (Tiago, 07/10/2026): o financeiro marca "Aprovar save gerado" e
-- "Aprovar consumo de save" no formulário da abertura — que é onde ele
-- confere exatamente esses números — e abrir o job aprova os pedidos. Para
-- recusar um save antes de abrir, o caminho é o "Reprovar job" de hoje.
--
-- Esta função cria os pedidos e os aprova numa transação só, reaproveitando
-- as duas funções que já existem:
--   • `save_enviar_pendentes` — confere o papel (administrador ou
--     financeiro), o status do job e cria um pedido por linha com save;
--   • `decidir_pedido_save(…, 'aprovar', …, p_totais => null, 'manter')` —
--     confere que a linha não mudou desde o pedido e o aprova. Com totais
--     nulos e revisão 'manter', ela não mexe nos números do job (o
--     financeiro já os contava desde o envio) nem na revisão da abertura.
-- Se qualquer pedido falhar, nada fica gravado: a Server Action então cai
-- no caminho de antes (pedidos aguardando na faixa Saves).
--
-- A errata de save do job já aberto (`job_aberto`) não muda: segue para a
-- faixa Saves e a revisão.
--
-- Aditiva: função nova. Nenhum dado muda.
-- =====================================================================

create or replace function public.save_aprovar_na_abertura(
  p_job_id uuid,
  p_momento text,
  p_numeros jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r     record;
  v_qtd integer := 0;
begin
  if p_momento not in ('abertura', 'reenvio') then
    raise exception 'A aprovação junto com a abertura vale só para a abertura e o reenvio do job.';
  end if;

  perform public.save_enviar_pendentes(p_job_id, p_momento, p_numeros);

  for r in
    select a.id
      from public.saves_aprovacoes a
     where a.job_id = p_job_id
       and a.situacao = 'aguardando'
       and a.momento = p_momento
     order by a.created_at, a.id
  loop
    perform public.decidir_pedido_save(r.id, 'aprovar', null, null, 'manter', null);
    v_qtd := v_qtd + 1;
  end loop;

  return v_qtd;
end;
$$;

comment on function public.save_aprovar_na_abertura(uuid, text, jsonb) is
  'Decisão 155: na abertura (ou no reenvio) do job, cria os pedidos de save das linhas que vieram com ele e os aprova numa transação só. Só administrador ou financeiro.';

revoke all on function public.save_aprovar_na_abertura(uuid, text, jsonb) from public;
revoke all on function public.save_aprovar_na_abertura(uuid, text, jsonb) from anon;
grant execute on function public.save_aprovar_na_abertura(uuid, text, jsonb) to authenticated;
