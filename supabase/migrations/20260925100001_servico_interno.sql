-- =====================================================================
-- 105 — O serviço Interno: investimento da agência, só custo FI e
--       planejado igual ao orçado
--
-- Pedido do Tiago em 25/09/2026 (docs/decisions/105). Até aqui "Interno"
-- era só um rótulo na lista de Serviço (decisão 037): nenhuma conta nem
-- trava olhava para ele. Passa a ser o investimento que a própria California
-- faz — não fatura nada ao cliente, e por isso:
--
--   1. Toda linha do orçamento Interno é F · Interno (FI), em todas as
--      versões e na cópia do job. FI é o custo que a California paga por
--      PP e não fatura (decisão 003).
--   2. O planejado acompanha o orçado e não se digita: é o investimento,
--      não há rentabilidade a planejar linha a linha.
--   3. Save não existe no Interno (nem gerar, nem consumir): save é crédito
--      do cliente, e aqui não há cliente pagando.
--   4. Orçamento que já tinha linhas e passa a ser Interno é CONVERTIDO
--      (resposta 1-b do Tiago): tudo vira FI e o planejado vira o orçado.
--      O BV em negociação dessas linhas é cancelado (FI não aceita BV); BV
--      confirmado ou recebido recusa a troca, e linha em save também — o
--      save tem pedido e aprovação próprios (decisão 099) e não se desfaz
--      por efeito colateral.
--   5. Serviço Interno não aceita categoria internacional, e aceita a
--      categoria Always On (planilha mensal) — que até aqui era exclusiva
--      do serviço Always On.
--   6. Na abertura, o financeiro não troca o job para dentro ou para fora
--      do Interno, nem troca a categoria por outra de modelo de planilha
--      diferente (resposta 3-a): as duas coisas decidiriam uma planilha que
--      o job não tem.
--
-- ONDE a regra mora: nos gatilhos. São mais de dez caminhos de escrita de
-- item (célula, linha nova, importação, sobrescrever, editor agregado,
-- cópia de mês, duplicar versão, abertura, errata) — é o mesmo motivo que
-- pôs o espelho de A e D no gatilho em 21/08/2026 (decisão 022). A tela
-- trava as células; o banco garante.
--
-- COMO se reconhece o Interno: pela marca `investimento_interno` no
-- serviço, nunca pelo nome — a categoria "Ativação" já foi renomeada para
-- "Evento" uma vez (037 §4).
--
-- Aditiva. Duas colunas novas com default, backfill que só PREENCHE as
-- marcas novas (uma linha em cada), funções substituídas por versões que
-- fazem o mesmo e mais, e gatilhos novos. Nenhum dado existente muda: o
-- único orçamento Interno hoje ("Audiovisual Raízes do Futuro",
-- HIT-0002/26) já tem as 22 linhas em FI com planejado = orçado, e nenhuma
-- versão dele usa save.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. As duas marcas no cadastro
-- ---------------------------------------------------------------------

alter table public.categorias_dominio
  add column if not exists investimento_interno boolean not null default false,
  add column if not exists aceita_servico_interno boolean not null default false;

comment on column public.categorias_dominio.investimento_interno is
  'Serviço (escopo projeto) de investimento interno da California (decisão 105): o orçamento só aceita custo FI, o planejado acompanha o orçado e não há save. Hoje só o serviço Interno. Só muda por migration.';

comment on column public.categorias_dominio.aceita_servico_interno is
  'Categoria (escopo orcamento) exclusiva de outro serviço que TAMBÉM vale para os serviços de investimento interno (decisão 105). Hoje só a categoria Always On: o Interno pode ter planilha mensal. Só muda por migration.';

update public.categorias_dominio
   set investimento_interno = true
 where escopo = 'projeto'
   and nome = 'Interno'
   and not investimento_interno;

update public.categorias_dominio
   set aceita_servico_interno = true
 where escopo = 'orcamento'
   and nome = 'Always On'
   and modelo_planilha = 'mensal'
   and not aceita_servico_interno;

-- As marcas mudam contas e travas: não se editam pela tela, como o
-- `modelo_planilha` e o `servico_exclusivo_id` (decisão 078).
create or replace function public.categoria_marcas_do_interno_travadas()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.investimento_interno or new.aceita_servico_interno then
      raise exception 'As marcas do serviço Interno só podem ser definidas por migration.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.investimento_interno is distinct from old.investimento_interno
     or new.aceita_servico_interno is distinct from old.aceita_servico_interno then
    raise exception 'As marcas do serviço Interno da categoria "%" só podem ser alteradas por migration.', old.nome
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_categoria_marcas_do_interno_travadas on public.categorias_dominio;
create trigger trg_categoria_marcas_do_interno_travadas
before insert or update of investimento_interno, aceita_servico_interno
on public.categorias_dominio
for each row execute function public.categoria_marcas_do_interno_travadas();

-- ---------------------------------------------------------------------
-- 2. Quem é Interno
-- ---------------------------------------------------------------------

create or replace function public.servico_de_investimento_interno(p_servico_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select investimento_interno from public.categorias_dominio where id = p_servico_id),
    false
  );
$$;

comment on function public.servico_de_investimento_interno(uuid) is
  'O serviço é de investimento interno (decisão 105)? Nulo ou inexistente dá false.';

create or replace function public.orcamento_de_investimento_interno(p_orcamento_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.servico_de_investimento_interno(
    (select servico_id from public.orcamentos where id = p_orcamento_id)
  );
$$;

comment on function public.orcamento_de_investimento_interno(uuid) is
  'O orçamento é de serviço de investimento interno (decisão 105)? O job segue o orçamento de origem: na abertura o financeiro não troca o job para dentro ou para fora do Interno.';

revoke all on function public.servico_de_investimento_interno(uuid) from public, anon, authenticated;
revoke all on function public.orcamento_de_investimento_interno(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. O par serviço × categoria do orçamento
-- ---------------------------------------------------------------------
-- Mesma função da 078, com o ramo do Interno antes das regras de sempre:
-- ele recusa a categoria internacional e aceita a exclusiva de outro
-- serviço quando ela está marcada `aceita_servico_interno` (Always On).

create or replace function public.orcamento_servico_e_categoria_coerentes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_exclusivo uuid;
  v_modelo text;
  v_aceita_interno boolean;
  v_interno boolean;
  v_nome_servico text;
  v_servico_tem_exclusiva boolean;
begin
  if tg_op = 'UPDATE'
     and new.servico_id is not distinct from old.servico_id
     and new.categoria_id is not distinct from old.categoria_id then
    return new;
  end if;
  if new.categoria_id is null or new.servico_id is null then
    return new;
  end if;

  select servico_exclusivo_id, modelo_planilha::text, aceita_servico_interno
    into v_exclusivo, v_modelo, v_aceita_interno
    from categorias_dominio
   where id = new.categoria_id;

  select investimento_interno, nome
    into v_interno, v_nome_servico
    from categorias_dominio
   where id = new.servico_id;

  -- Decisão 105: o Interno escolhe entre as categorias nacionais e a
  -- Always On (mensal). Internacional, não.
  if coalesce(v_interno, false) then
    if v_modelo = 'internacional' then
      raise exception 'O serviço % não aceita categoria de planilha internacional.', v_nome_servico
        using errcode = 'check_violation';
    end if;
    if v_exclusivo is not null
       and v_exclusivo <> new.servico_id
       and not coalesce(v_aceita_interno, false) then
      raise exception 'A categoria escolhida é exclusiva de outro serviço.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if v_exclusivo is not null and v_exclusivo <> new.servico_id then
    raise exception 'A categoria escolhida é exclusiva de outro serviço.'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from categorias_dominio where servico_exclusivo_id = new.servico_id
  ) into v_servico_tem_exclusiva;

  if v_servico_tem_exclusiva and v_exclusivo is distinct from new.servico_id then
    raise exception 'Este serviço só aceita a categoria dele.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. O orçamento que passa a ser Interno é convertido
-- ---------------------------------------------------------------------
-- AFTER: o serviço novo já está gravado quando as linhas são regravadas,
-- então o gatilho das linhas (seção 5) enxerga o Interno e faz o resto —
-- FI e planejado = orçado. Vale para os dois caminhos que trocam o
-- serviço: `atualizarOrcamento` e a RPC `trocar_modelo_mensal_do_orcamento`.
--
-- Todas as versões do orçamento, não só a em edição: a regra é do
-- orçamento. A troca só é possível antes da aprovação (a action recusa
-- `aprovado` e `job_criado`), então nenhuma cópia de job é tocada.

create or replace function public.orcamento_entra_no_interno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bv record;
begin
  if new.servico_id is not distinct from old.servico_id then
    return null;
  end if;
  if not public.servico_de_investimento_interno(new.servico_id)
     or public.servico_de_investimento_interno(old.servico_id) then
    return null;
  end if;

  if exists (
    select 1
      from versoes_orcamento_itens i
      join versoes_orcamento v on v.id = i.versao_orcamento_id
     where v.orcamento_id = new.id
       and (i.em_save or coalesce(i.save_consumido, 0) > 0)
  ) then
    raise exception 'O serviço Interno não usa save. Tire o save das linhas do orçamento antes de trocar o serviço.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
      from itens_bv b
      join versoes_orcamento_itens i on i.id = b.item_versao_id
      join versoes_orcamento v on v.id = i.versao_orcamento_id
     where v.orcamento_id = new.id
       and b.situacao in ('confirmado', 'recebido')
  ) then
    raise exception 'Este orçamento tem BV confirmado ou recebido. O serviço Interno só usa custo F · Interno, que não tem BV — não é possível trocar o serviço.'
      using errcode = 'check_violation';
  end if;

  -- BV em negociação: cancelado, como na troca de tipo de uma linha
  -- (`resolverBvAoSairDoTipoComBv`), com a mesma auditoria.
  for v_bv in
    update itens_bv b
       set situacao = 'cancelado'
      from versoes_orcamento_itens i
      join versoes_orcamento v on v.id = i.versao_orcamento_id
     where b.item_versao_id = i.id
       and v.orcamento_id = new.id
       and b.situacao = 'a_negociar'
    returning b.id, b.tenant_id, b.valor, b.item_versao_id, i.item
  loop
    -- `log_audit_event` exige usuário; sem ele (migration, script) o
    -- cancelamento vale do mesmo jeito.
    if auth.uid() is not null then
      perform public.log_audit_event(
        'item_bv.cancelado', v_bv.tenant_id, 'item_bv', v_bv.id::text,
        jsonb_build_object(
          'item_versao_id', v_bv.item_versao_id,
          'item', v_bv.item,
          'valor', v_bv.valor,
          'motivo', 'orcamento_virou_interno'
        )
      );
    end if;
  end loop;

  update versoes_orcamento
     set save_por_padrao = false
   where orcamento_id = new.id
     and save_por_padrao;

  -- Regrava o tipo em TODAS as linhas (inclusive as que já eram FI): o
  -- gatilho das linhas iguala o planejado ao orçado em cada uma.
  update versoes_orcamento_itens i
     set tipo_custo = 'FI'
    from versoes_orcamento v
   where v.id = i.versao_orcamento_id
     and v.orcamento_id = new.id;

  return null;
end;
$$;

revoke all on function public.orcamento_entra_no_interno() from public, anon, authenticated;

drop trigger if exists trg_orcamento_entra_no_interno on public.orcamentos;
create trigger trg_orcamento_entra_no_interno
after update of servico_id on public.orcamentos
for each row execute function public.orcamento_entra_no_interno();

-- ---------------------------------------------------------------------
-- 5. As linhas: FI, planejado = orçado, sem save
-- ---------------------------------------------------------------------
-- A função é a do espelho histórico (nome mantido de propósito — ver a
-- migration 20260908160002). Ganha o ramo do Interno ANTES do ramo do
-- save, e vira SECURITY DEFINER: ela lê orçamento, versão e job para saber
-- se a linha é do Interno, e uma leitura barrada por RLS devolveria nulo e
-- deixaria a regra passar em silêncio.
--
-- O save RECUSA em vez de ser desfeito: desmarcar sem avisar apagaria o
-- pedido de quem marcou. A tela nem oferece save no Interno.

create or replace function public.planejado_espelha_orcado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_interno boolean;
begin
  if tg_table_name = 'versoes_orcamento_itens' then
    select public.orcamento_de_investimento_interno(v.orcamento_id)
      into v_interno
      from versoes_orcamento v
     where v.id = new.versao_orcamento_id;
  else
    select public.orcamento_de_investimento_interno(j.orcamento_id)
      into v_interno
      from jobs j
     where j.id = new.job_id;
  end if;

  if coalesce(v_interno, false) then
    if new.em_save or coalesce(new.save_consumido, 0) > 0 then
      raise exception 'O serviço Interno não usa save: é investimento da California, sem crédito de cliente a gerar ou consumir.'
        using errcode = 'check_violation';
    end if;
    new.tipo_custo               := 'FI';
    new.valor_unitario_planejado := coalesce(new.valor_unitario_orcado, 0);
    new.quantidade_planejada     := coalesce(new.quantidade_orcada, 0);
    new.dias_meses_planejado     := coalesce(new.dias_meses_orcado, 0);
    return new;
  end if;

  -- Linha em save não tem custo neste projeto: o serviço não acontece
  -- aqui, então não há fornecedor a pagar (decisão 028 §9).
  if new.em_save then
    new.valor_unitario_planejado := 0;
    new.quantidade_planejada     := 0;
    new.dias_meses_planejado     := 0;
  end if;
  return new;
end;
$$;

comment on function public.planejado_espelha_orcado() is
  'Linha de orçamento de serviço Interno (decisão 105): vira FI, o planejado acompanha o orçado e save é recusado. Nas demais, zera o planejado da linha em SAVE (decisão 028 §9). O nome é histórico: até 08/09/2026 ela também fazia o planejado de A e D espelhar o orçado (decisão 062).';

revoke all on function public.planejado_espelha_orcado() from public, anon, authenticated;

-- A lista de colunas ganha `save_consumido`: consumir save também é save.
drop trigger if exists trg_planejado_espelha_orcado on public.versoes_orcamento_itens;
create trigger trg_planejado_espelha_orcado
before insert or update of
  em_save, save_consumido, tipo_custo,
  valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.versoes_orcamento_itens
for each row execute function public.planejado_espelha_orcado();

drop trigger if exists trg_planejado_espelha_orcado_job on public.jobs_itens_orcado;
create trigger trg_planejado_espelha_orcado_job
before insert or update of
  em_save, save_consumido, tipo_custo,
  valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.jobs_itens_orcado
for each row execute function public.planejado_espelha_orcado();

-- "Save por padrão" da versão: sem save no Interno, também não há padrão.
create or replace function public.versao_do_interno_sem_save_por_padrao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.save_por_padrao
     and public.orcamento_de_investimento_interno(new.orcamento_id) then
    raise exception 'O serviço Interno não usa save.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.versao_do_interno_sem_save_por_padrao() from public, anon, authenticated;

drop trigger if exists trg_versao_do_interno_sem_save_por_padrao on public.versoes_orcamento;
create trigger trg_versao_do_interno_sem_save_por_padrao
before insert or update of save_por_padrao on public.versoes_orcamento
for each row execute function public.versao_do_interno_sem_save_por_padrao();

-- ---------------------------------------------------------------------
-- 6. O job não troca de planilha na abertura
-- ---------------------------------------------------------------------
-- Desde a decisão 055 o financeiro troca serviço e categoria do job sem
-- mexer no orçamento. A troca continua livre DENTRO do que não muda a
-- planilha; o que muda é recusado (resposta 3-a do Tiago):
--   - serviço: não entra nem sai do Interno;
--   - categoria: só por outra do mesmo `modelo_planilha` (nacional,
--     internacional, mensal — Fee e Always On são o mesmo mensal).
-- Só confere o que mudou: nenhum job hoje diverge do seu orçamento
-- (conferido em 25/09/2026), e o registro antigo continua editável.

create or replace function public.job_servico_e_categoria_seguem_a_planilha()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orc_servico uuid;
  v_orc_categoria uuid;
  v_modelo_job text;
  v_modelo_orc text;
begin
  select servico_id, categoria_id
    into v_orc_servico, v_orc_categoria
    from orcamentos
   where id = new.orcamento_id;

  if new.servico_id is not null
     and (tg_op = 'INSERT' or new.servico_id is distinct from old.servico_id)
     and public.servico_de_investimento_interno(new.servico_id)
         <> public.servico_de_investimento_interno(v_orc_servico) then
    raise exception 'O serviço Interno decide a planilha do job (só custo F · Interno, planejado igual ao orçado) e não pode ser trocado na abertura: o job segue o serviço do orçamento.'
      using errcode = 'check_violation';
  end if;

  if new.categoria_id is not null
     and v_orc_categoria is not null
     and (tg_op = 'INSERT' or new.categoria_id is distinct from old.categoria_id) then
    select modelo_planilha::text into v_modelo_job from categorias_dominio where id = new.categoria_id;
    select modelo_planilha::text into v_modelo_orc from categorias_dominio where id = v_orc_categoria;
    if v_modelo_job is distinct from v_modelo_orc then
      raise exception 'A categoria decide o modelo da planilha do job (nacional, internacional ou mensal) e só pode ser trocada por outra do mesmo modelo.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.job_servico_e_categoria_seguem_a_planilha() from public, anon, authenticated;

drop trigger if exists trg_job_servico_e_categoria_seguem_a_planilha on public.jobs;
create trigger trg_job_servico_e_categoria_seguem_a_planilha
before insert or update of servico_id, categoria_id on public.jobs
for each row execute function public.job_servico_e_categoria_seguem_a_planilha();
