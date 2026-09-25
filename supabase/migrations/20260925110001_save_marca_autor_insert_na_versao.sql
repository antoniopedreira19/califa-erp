-- =====================================================================
-- SAVE — item de versão que NASCE em save voltava a ser gravável
--
-- A migration 20260922140001 (aprovação de save, decisão 099) criou
-- `save_marca_autor_e_planejado()` com esta condição, no ramo do INSERT:
--
--     if tg_table_name = 'jobs_itens_orcado' and new.item_versao_id is not null
--
-- O PL/pgSQL não curto-circuita a referência a campo de registro: a
-- expressão inteira é preparada contra o tipo de NEW, e em
-- `versoes_orcamento_itens` não existe `item_versao_id`. Todo INSERT de
-- linha de versão com `em_save = true` morria com
--
--     42703  record "new" has no field "item_versao_id"
--
-- e o PostgREST devolvia 400. Na tela: "Não foi possível adicionar o item."
-- com o "Orçamento de save" ligado (o `trg_item_nasce_em_save` liga a
-- marca antes deste trigger), e "não foi possível gravar os itens." na
-- importação de planilha com linha em save. Marcar save numa linha que já
-- existe é UPDATE e não passava por aqui — por isso o teste da 099 não
-- pegou. A cópia do job (`jobs_itens_orcado`) tem a coluna e também
-- funcionava.
--
-- A correção só aninha o IF: a referência a `new.item_versao_id` passa a
-- ser preparada apenas quando o trigger roda em `jobs_itens_orcado`. O
-- resto do corpo é o mesmo, linha por linha. `create or replace` mantém
-- dono, SECURITY DEFINER e privilégios; os dois triggers seguem apontando
-- para a mesma função e não precisam ser recriados.
--
-- Aditiva: redefinição de corpo de função, sem tocar em dado.
-- =====================================================================

create or replace function public.save_marca_autor_e_planejado()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_antes jsonb;
  v_por   uuid;
  v_em    timestamptz;
begin
  if tg_op = 'INSERT' then
    if not new.em_save then
      new.save_marcado_por := null;
      new.save_marcado_em := null;
      new.planejado_antes_save := null;
      return new;
    end if;

    -- A cópia do job herda da linha da versão. ⚠️ Dois IFs, e não um com
    -- AND: `new.item_versao_id` não existe em `versoes_orcamento_itens`, e
    -- o PL/pgSQL prepara a expressão inteira antes de avaliar o AND.
    if tg_table_name = 'jobs_itens_orcado' then
      if new.item_versao_id is not null then
        select i.planejado_antes_save, i.save_marcado_por, i.save_marcado_em
          into v_antes, v_por, v_em
          from public.versoes_orcamento_itens i
         where i.id = new.item_versao_id;
        new.planejado_antes_save := coalesce(new.planejado_antes_save, v_antes);
        new.save_marcado_por := coalesce(new.save_marcado_por, v_por);
        new.save_marcado_em := coalesce(new.save_marcado_em, v_em);
      end if;
    end if;

    -- Linha que já nasce em save com planejado digitado (importação, save
    -- por padrão): guarda antes de o espelho zerar.
    if new.planejado_antes_save is null
       and (coalesce(new.valor_unitario_planejado, 0) <> 0
            or coalesce(new.quantidade_planejada, 0) <> 0
            or coalesce(new.dias_meses_planejado, 0) <> 0) then
      new.planejado_antes_save := jsonb_build_object(
        'valor_unitario', new.valor_unitario_planejado,
        'quantidade', new.quantidade_planejada,
        'dias_meses', new.dias_meses_planejado
      );
    end if;

    new.save_marcado_por := coalesce(new.save_marcado_por, (select auth.uid()));
    new.save_marcado_em := coalesce(new.save_marcado_em, now());
    return new;
  end if;

  if new.em_save and not old.em_save then
    new.save_marcado_por := coalesce((select auth.uid()), new.save_marcado_por);
    new.save_marcado_em := now();
    new.planejado_antes_save := jsonb_build_object(
      'valor_unitario', old.valor_unitario_planejado,
      'quantidade', old.quantidade_planejada,
      'dias_meses', old.dias_meses_planejado
    );
  elsif old.em_save and not new.em_save then
    -- Devolve o planejado guardado, se quem desmarcou não trouxe outro.
    if old.planejado_antes_save is not null
       and coalesce(new.valor_unitario_planejado, 0) = 0
       and coalesce(new.quantidade_planejada, 0) = 0
       and coalesce(new.dias_meses_planejado, 0) = 0 then
      new.valor_unitario_planejado := coalesce((old.planejado_antes_save->>'valor_unitario')::numeric, 0);
      new.quantidade_planejada := coalesce((old.planejado_antes_save->>'quantidade')::numeric, 0);
      new.dias_meses_planejado := coalesce((old.planejado_antes_save->>'dias_meses')::numeric, 0);
    end if;
    new.save_marcado_por := null;
    new.save_marcado_em := null;
    new.planejado_antes_save := null;
  else
    -- A marca não mudou: o registro de quem marcou não se edita por fora.
    new.save_marcado_por := old.save_marcado_por;
    new.save_marcado_em := old.save_marcado_em;
    new.planejado_antes_save := old.planejado_antes_save;
  end if;
  return new;
end;
$$;

comment on function public.save_marca_autor_e_planejado() is
  'Registra quem marcou o save e guarda o planejado que o save zera (decisão 099). No INSERT em versoes_orcamento_itens não lê item_versao_id, que só existe em jobs_itens_orcado (correção de 25/09/2026).';
