-- 06/10/2026: apaga as 36 cópias de orçamento do AMB-P017/26 (AMBEV I
-- CORONA I WSL CHALLENGER MARESIAS 2026).
--
-- Em 05/10/2026, entre 18:25 e 19:37, a produtora criou 9 orçamentos pela
-- visão agregada, salvando a cada um. A tela não passava o orçamento novo
-- para "gravado" depois do salvamento, e cada "Salvar alterações" criou de
-- novo todos os orçamentos novos da sessão: 1 + 2 + … + 9 = 45 rascunhos,
-- 9 de verdade e 36 cópias. A causa foi corrigida no mesmo dia (o servidor
-- devolve os ids, e `orcamentos.chave_rascunho` — migration 20261006600001
-- — recusa o mesmo rascunho duas vezes).
--
-- Fica o PRIMEIRO de cada um: é o que nasceu com a importação da planilha
-- (a linha de `orcamento_importacoes`); as cópias nasceram sem ela. O
-- conteúdo é idêntico — cadastro, parâmetros da versão e itens —, e o
-- código dos que ficam preserva a ordem de criação, que é a das listas.
--
--   mantidos: -02 TRIAL, -04 AFTER DIA 01, -07 AFTER DIA 02, -11 AFTER DIA 03,
--             -16 VERBA, -22 GS DIA 1, -29 GS DIA 2, -37 LOGÍSTICA,
--             -46 INGRESSOS (e o -01 FRETE, aprovado, fora do caso)
--   apagados: os outros 36 rascunhos
--
-- Destrutiva: o Tiago pediu em 06/10/2026 ("apague as cópias"). Os códigos
-- apagados ficam como buraco na sequência; desde 06/10/2026 o próximo
-- código é o maior + 1, não a contagem + 1 — por isso esta migration só
-- foi aplicada depois de a correção estar publicada. A auditoria de
-- criação (`orcamento.criado`) fica, como na limpeza de 21/09/2026.
--
-- Só age se tudo ainda estiver como no levantamento: cada cópia é rascunho,
-- não está arquivada, tem uma versão só, em rascunho, sem job, BV, save,
-- realizado nem importação, e tem o conteúdo igual ao do original que
-- fica. Se não, falha e nada é apagado.

do $$
declare
  v_projeto  constant uuid := 'b6ec5de7-f640-47bb-8294-d08f66718829';
  v_tiago    constant uuid := 'fa61a319-6409-4d02-93c5-8d8be2746673';
  v_mantidos constant text[] := array[
    'AMB-P017/26-02', 'AMB-P017/26-04', 'AMB-P017/26-07', 'AMB-P017/26-11',
    'AMB-P017/26-16', 'AMB-P017/26-22', 'AMB-P017/26-29', 'AMB-P017/26-37',
    'AMB-P017/26-46'
  ];
  v_copias   constant text[] := array[
    'AMB-P017/26-03', 'AMB-P017/26-05', 'AMB-P017/26-06', 'AMB-P017/26-08',
    'AMB-P017/26-09', 'AMB-P017/26-10', 'AMB-P017/26-12', 'AMB-P017/26-13',
    'AMB-P017/26-14', 'AMB-P017/26-15', 'AMB-P017/26-17', 'AMB-P017/26-18',
    'AMB-P017/26-19', 'AMB-P017/26-20', 'AMB-P017/26-21', 'AMB-P017/26-23',
    'AMB-P017/26-24', 'AMB-P017/26-25', 'AMB-P017/26-26', 'AMB-P017/26-27',
    'AMB-P017/26-28', 'AMB-P017/26-30', 'AMB-P017/26-31', 'AMB-P017/26-32',
    'AMB-P017/26-33', 'AMB-P017/26-34', 'AMB-P017/26-35', 'AMB-P017/26-36',
    'AMB-P017/26-38', 'AMB-P017/26-39', 'AMB-P017/26-40', 'AMB-P017/26-41',
    'AMB-P017/26-42', 'AMB-P017/26-43', 'AMB-P017/26-44', 'AMB-P017/26-45'
  ];
  v_tenant   uuid;
  v_ids      uuid[];
  v_versoes  uuid[];
  v_n        int;
  v_retrato  jsonb;
begin
  select tenant_id into v_tenant from public.projetos where id = v_projeto;
  if v_tenant is null then
    raise exception 'Projeto AMB-P017/26 não encontrado.';
  end if;

  select array_agg(id) into v_ids
    from public.orcamentos
   where projeto_id = v_projeto and codigo = any (v_copias);
  if coalesce(array_length(v_ids, 1), 0) <> 36 then
    raise exception 'Esperava 36 cópias no AMB-P017/26, achei %.', coalesce(array_length(v_ids, 1), 0);
  end if;

  if (select count(*) from public.orcamentos
       where projeto_id = v_projeto and codigo = any (v_mantidos)) <> 9 then
    raise exception 'Um dos 9 originais do AMB-P017/26 não está mais lá.';
  end if;

  -- Cada cópia ainda é rascunho intocado, sem nada pendurado.
  if exists (
    select 1 from public.orcamentos o
     where o.id = any (v_ids)
       and (o.status <> 'rascunho' or o.arquivado_em is not null
            or o.versao_aprovada_id is not null)
  ) then
    raise exception 'Uma das cópias saiu de rascunho ou foi arquivada.';
  end if;

  select array_agg(v.id) into v_versoes
    from public.versoes_orcamento v where v.orcamento_id = any (v_ids);
  if coalesce(array_length(v_versoes, 1), 0) <> 36
     or exists (select 1 from public.versoes_orcamento v
                 where v.id = any (v_versoes) and v.status <> 'rascunho') then
    raise exception 'Uma das cópias ganhou versão nova ou mudou o status da v1.';
  end if;

  if exists (select 1 from public.jobs where orcamento_id = any (v_ids))
     or exists (select 1 from public.orcamento_importacoes where orcamento_id = any (v_ids))
     or exists (select 1 from public.versoes_orcamento_meses where versao_orcamento_id = any (v_versoes))
     or exists (
       select 1 from public.versoes_orcamento_itens i
        where i.versao_orcamento_id = any (v_versoes)
          and (exists (select 1 from public.itens_bv b where b.item_versao_id = i.id)
               or exists (select 1 from public.saves_consumos s where s.item_versao_id = i.id)
               or exists (select 1 from public.jobs_itens_realizado r where r.item_id = i.id)
               or exists (select 1 from public.jobs_itens_orcado jo where jo.item_versao_id = i.id))
     ) then
    raise exception 'Uma das cópias tem job, importação, mês, BV, save ou realizado.';
  end if;

  -- Cada cópia é igual ao original do mesmo nome: cadastro, parâmetros da
  -- versão e itens, na ordem.
  with retrato as (
    select o.id, o.codigo, o.nome,
           md5(concat_ws('|', o.categoria_id, o.servico_id, o.regional_id, o.cidade_id,
                         o.gp_responsavel_id, o.produtor_id, o.data_inicio_prevista,
                         o.data_fim_prevista, o.descritivo, o.empresa_id,
                         v.moeda, v.taxa_cambio, v.percentual_honorarios, v.percentual_imposto,
                         (select string_agg(concat_ws('|', g.nome, i.item, i.tipo_custo, i.categoria_id,
                                   i.valor_unitario_orcado, i.quantidade_orcada, i.dias_meses_orcado,
                                   i.valor_unitario_planejado, i.quantidade_planejada,
                                   i.dias_meses_planejado, i.planilha_origem, i.observacoes,
                                   i.fornecedor_id), '#' order by i.ordem)
                            from public.versoes_orcamento_itens i
                            join public.versoes_orcamento_grupos g on g.id = i.grupo_id
                           where i.versao_orcamento_id = v.id))) as assinatura
      from public.orcamentos o
      join public.versoes_orcamento v on v.orcamento_id = o.id
     where o.projeto_id = v_projeto
       and (o.codigo = any (v_copias) or o.codigo = any (v_mantidos))
  )
  select count(*) into v_n
    from retrato c
    join retrato m on m.nome = c.nome and m.codigo = any (v_mantidos)
   where c.codigo = any (v_copias) and c.assinatura = m.assinatura;
  if v_n <> 36 then
    raise exception 'Só % das 36 cópias batem com o original; alguma foi editada.', v_n;
  end if;

  -- O que sai, para a auditoria.
  select jsonb_agg(jsonb_build_object(
           'id', o.id, 'codigo', o.codigo, 'nome', o.nome,
           'criado_em', o.created_at,
           'original_mantido', (select m.codigo from public.orcamentos m
                                 where m.projeto_id = v_projeto and m.nome = o.nome
                                   and m.codigo = any (v_mantidos)))
           order by o.codigo)
    into v_retrato
    from public.orcamentos o where o.id = any (v_ids);

  -- Itens antes: a FK item → grupo é `on delete restrict`. O resto (versão,
  -- grupos) vai em cascata com o orçamento.
  delete from public.versoes_orcamento_itens where versao_orcamento_id = any (v_versoes);
  delete from public.orcamentos where id = any (v_ids);

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (
    v_tenant, v_tiago, 'orcamento.copias_apagadas', 'projeto', v_projeto::text,
    jsonb_build_object(
      'projeto', 'AMB-P017/26',
      'motivo', 'Cópias criadas pela visão agregada em 05/10/2026: cada "Salvar alterações" recriava os orçamentos novos da sessão. Conteúdo idêntico ao original; fica o primeiro de cada um.',
      'apagados', v_retrato,
      'mantidos', to_jsonb(v_mantidos),
      'origem', 'migration 20261006600002'
    )
  );
end
$$;
