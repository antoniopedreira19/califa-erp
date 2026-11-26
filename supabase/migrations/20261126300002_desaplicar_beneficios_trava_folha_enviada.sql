-- Migration: Trava desaplicar_fechamento_beneficios quando PJ já saiu de rascunho.
-- Spec: docs/superpowers/specs/2026-11-26-folha-pj-clt-fluxos-independentes-design.md
-- Racional: no fluxo novo (PJ e CLT envio independentes), o salario_base de linha PJ
-- é descontado automaticamente no "Enviar PJ". Permitir desaplicar depois que a linha
-- saiu de rascunho reverteria o salario_base de linhas já analisadas pelo financeiro,
-- quebrando a aprovação. Bloqueia todos os estados != rascunho (incluindo pendente_correcao).
-- 100% aditiva. CREATE OR REPLACE só da função.

begin;
create or replace function public.desaplicar_fechamento_beneficios(p_fechamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f public.beneficio_fechamento_mensal%rowtype;
  v_avulsa_paga record;
begin
  select * into v_f from public.beneficio_fechamento_mensal where id = p_fechamento_id;
  if not found then raise exception 'fechamento_nao_encontrado'; end if;
  if not (public.is_tenant_admin(v_f.tenant_id) or public.is_tenant_rh(v_f.tenant_id)) then
    raise exception 'permissao_negada';
  end if;
  if v_f.reaberto_em is not null then raise exception 'ja_reaberto'; end if;

  -- NOVA trava: linha PJ já saiu de rascunho (enviada/aprovada/paga/pendente_correcao)
  if exists (
    select 1 from public.folhas_pagamento
     where competencia_ano = v_f.ano
       and competencia_mes = v_f.mes
       and origem = 'california'
       and status <> 'rascunho'
  ) then
    raise exception 'folha_pj_ja_enviada';
  end if;

  -- Trava existente: avulsa deste fechamento já foi paga
  select coalesce(codigo, id::text) as ref
    into v_avulsa_paga
    from public.contas_avulsas
    where beneficio_fechamento_id = p_fechamento_id
      and pago_em is not null
    limit 1;
  if found then raise exception 'avulsa_ja_paga: %', v_avulsa_paga.ref; end if;

  -- Reverte salario_base PJ
  update public.folhas_pagamento
     set salario_base = salario_base + desconto_beneficios,
         desconto_beneficios = 0
   where competencia_ano = v_f.ano and competencia_mes = v_f.mes
     and origem = 'california' and desconto_beneficios > 0;

  -- Apaga avulsas geradas (se houver)
  delete from public.contas_avulsas where beneficio_fechamento_id = p_fechamento_id;
  -- Apaga linhas do snapshot
  delete from public.beneficio_fechamento_linha where fechamento_id = p_fechamento_id;
  -- Marca reaberto
  update public.beneficio_fechamento_mensal
     set reaberto_em = now(), reaberto_por = auth.uid()
   where id = p_fechamento_id;
end;
$$;

grant execute on function public.desaplicar_fechamento_beneficios(uuid) to authenticated;
commit;
