-- fix: desaplicar_fechamento_beneficios estava bloqueando por linhas de folha
-- que o aplicar sequer toca. Dois problemas no check folha_pj_ja_enviada:
--
-- 1) Nao filtrava tipo='salario'. A migration 20261126300002 ja havia
--    restringido o UPDATE do aplicar a tipo='salario' (13o, ferias e
--    rescisao tem fluxo separado), mas o desaplicar nao acompanhou. Uma
--    1a parcela de 13o aprovada travava o desaplicar do beneficio mensal
--    da folha de salario.
--
-- 2) Olhava status <> 'rascunho', pegando 'cancelada_rescisao' no filtro.
--    Linha de salario cancelada por rescisao nao pode travar: nao sera
--    nem enviada nem paga. O check correto e status in ('enviada','aprovada').
--
-- Tambem filtrando tipo='salario' no UPDATE de reversao por simetria (hoje
-- so linhas de salario tem desconto_beneficios > 0, mas fica explicito).

create or replace function public.desaplicar_fechamento_beneficios(p_fechamento_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
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

  -- Bloqueia so quando a folha de salario foi mesmo para o financeiro.
  -- rascunho = ainda editavel; cancelada_rescisao = anulada, nao conta.
  if exists (
    select 1 from public.folhas_pagamento
     where tenant_id = v_f.tenant_id
       and competencia_ano = v_f.ano
       and competencia_mes = v_f.mes
       and origem = 'california'
       and tipo = 'salario'
       and status in ('enviada','aprovada')
  ) then
    raise exception 'folha_pj_ja_enviada';
  end if;

  select coalesce(codigo, id::text) as ref
    into v_avulsa_paga
    from public.contas_avulsas
    where beneficio_fechamento_id = p_fechamento_id
      and pago_em is not null
    limit 1;
  if found then raise exception 'avulsa_ja_paga: %', v_avulsa_paga.ref; end if;

  update public.folhas_pagamento
     set salario_base = salario_base + desconto_beneficios,
         desconto_beneficios = 0
   where tenant_id = v_f.tenant_id
     and competencia_ano = v_f.ano
     and competencia_mes = v_f.mes
     and origem = 'california'
     and tipo = 'salario'
     and desconto_beneficios > 0;

  delete from public.contas_avulsas where beneficio_fechamento_id = p_fechamento_id;
  delete from public.beneficio_fechamento_linha where fechamento_id = p_fechamento_id;
  update public.beneficio_fechamento_mensal
     set reaberto_em = now(), reaberto_por = auth.uid()
   where id = p_fechamento_id;
end;
$$;
