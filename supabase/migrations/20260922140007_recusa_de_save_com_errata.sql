-- =============================================================================
-- Recusa de save que o financeiro já contava grava errata (decisão 099)
-- =============================================================================
--
-- Achado da revisão de 22/09/2026. Recusar um pedido que o financeiro já
-- contava (momento abertura, reenvio ou legado) muda os espelhos do job e
-- abria a revisão da abertura SEM errata. A regra "revisão só de save"
-- (`revisaoPendenteDoJob`) só olha erratas: uma recusa ou um cancelamento
-- seguinte de pedido do job aberto via só a errata dele, achava que era a
-- única pendência e fechava a revisão — e a previsão de recebimento e a
-- curva ficavam montadas sobre os números de antes da primeira recusa.
--
-- Agora essa recusa é errata de save, como o cancelamento já era: a RPC
-- recebe `p_errata` e grava pelo mesmo `save_registrar_errata` (que também
-- põe o job em revisão). A errata não fica ligada a pedido nenhum, então
-- conta como errata de verdade e segura a revisão.
--
-- A assinatura muda (parâmetro novo no fim, com padrão nulo para a
-- aprovação continuar chamando como antes). A função é de hoje e só o
-- código desta feature a chama; a versão de cinco parâmetros sai.
-- =============================================================================

drop function public.decidir_pedido_save(uuid, text, text, jsonb, text);

create function public.decidir_pedido_save(
  p_id uuid,
  p_decisao text,
  p_justificativa text,
  p_totais jsonb,
  p_revisao text,
  p_errata jsonb default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a public.saves_aprovacoes%rowtype;
begin
  select * into a from public.saves_aprovacoes where id = p_id for update;
  if not found then
    raise exception 'Pedido de save não encontrado.';
  end if;
  if not (public.is_tenant_admin(a.tenant_id) or public.is_tenant_financeiro(a.tenant_id)) then
    raise exception 'Só o administrador ou o financeiro aprova ou recusa save.';
  end if;
  if not public.save_job_visivel(a.job_id) then
    raise exception 'Sem acesso ao job deste pedido de save.';
  end if;
  if a.situacao <> 'aguardando' then
    raise exception 'Este pedido de save já foi decidido.';
  end if;
  if a.job_item_orcado_id is null then
    raise exception 'A linha deste pedido de save foi removida: ele não pode ser decidido.';
  end if;
  perform 1 from public.jobs_itens_orcado where id = a.job_item_orcado_id for update;

  perform set_config('app.save_fluxo', 'on', true);

  if p_decisao = 'aprovar' then
    if p_errata is not null then
      raise exception 'Aprovar save não grava errata: a revisão da abertura é o registro.';
    end if;
    if a.tipo = 'gera' and not exists (
         select 1 from public.jobs_itens_orcado o
          where o.id = a.job_item_orcado_id
            and o.em_save
            and abs(coalesce(o.total_orcado, 0) - a.valor) < 0.005) then
      raise exception 'A linha mudou depois do pedido de save: peça à produção para cancelar e enviar de novo.';
    end if;
    if a.tipo = 'consome' and public.save_origens_da_linha(a.job_item_orcado_id) <> (
         select coalesce(jsonb_agg(jsonb_build_object('job_origem_id', s.job_origem_id, 'valor', s.valor)
                                   order by s.job_origem_id), '[]'::jsonb)
           from (
             select (x->>'job_origem_id')::uuid as job_origem_id,
                    sum((x->>'valor')::numeric)::numeric(14,2) as valor
               from jsonb_array_elements(a.origens) x
              group by 1
           ) s) then
      raise exception 'O consumo da linha mudou depois do pedido: peça à produção para cancelar e enviar de novo.';
    end if;
    if a.momento = 'job_aberto' and p_totais is null then
      raise exception 'Totais do job ausentes na aprovação do save.';
    end if;

    if a.substitui_id is not null then
      update public.saves_aprovacoes
         set situacao = 'substituido'
       where id = a.substitui_id
         and situacao = 'aprovado'
         and tipo = 'consome'
         and job_item_orcado_id = a.job_item_orcado_id;
      if not found then
        raise exception 'O consumo aprovado que esta edição substitui não é desta linha.';
      end if;
    end if;
    update public.saves_aprovacoes set situacao = 'aprovado' where id = p_id;
  elsif p_decisao = 'recusar' then
    if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
      raise exception 'Escreva a justificativa da recusa com pelo menos 10 caracteres.';
    end if;
    -- O financeiro já contava o pedido: recusar muda os números dele, e
    -- isso é errata de save (com os espelhos na hora).
    if a.momento <> 'job_aberto' and (p_totais is null or p_errata is null) then
      raise exception 'Este pedido já contava para o financeiro: recusar é errata de save e precisa dos números do job.';
    end if;
    if a.momento = 'job_aberto' and p_errata is not null then
      raise exception 'Este pedido ainda não contava para o financeiro: recusar não grava errata.';
    end if;
    update public.saves_aprovacoes
       set situacao = 'recusado', justificativa = btrim(p_justificativa)
     where id = p_id;
    perform public.save_reverter_pedido(p_id);
    if p_errata is not null then
      perform public.save_registrar_errata(a.job_item_orcado_id, p_errata);
    end if;
  else
    raise exception 'Decisão inválida.';
  end if;

  perform public.save_gravar_totais(a.job_id, p_totais);
  perform public.save_revisao(a.job_id, p_revisao);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

revoke all on function public.decidir_pedido_save(uuid, text, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.decidir_pedido_save(uuid, text, text, jsonb, text, jsonb) to authenticated;
