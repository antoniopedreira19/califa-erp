-- =====================================================================
-- Decisão 122 (Tiago, 29/09/2026): o cliente do projeto só muda antes de
-- algum orçamento ser aprovado, e a troca leva os códigos junto.
--
-- Até aqui o "Editar projeto" gravava `cliente_id` a qualquer momento e o
-- código ficava: o projeto de um cliente seguia com a sigla de outro
-- (HITLAB com "NOV-0001/26"), e os orçamentos com ele. E depois da
-- aprovação a troca descasava o projeto do job, que já tem a sigla do
-- cliente no código e a marca copiada como texto.
--
-- 1) Guarda em `projetos`: `cliente_id` não muda se o projeto tem
--    orçamento aprovado ou com job, ou job que não foi cancelado antes da
--    abertura. É a mesma régua do arquivar (decisões 116 e 118).
-- 2) `trocar_cliente_do_projeto`: troca cliente, marca e código do projeto
--    e reescreve o prefixo do código de cada orçamento dele, numa
--    transação só. O código novo vem do app (`gerarCodigoProjeto`, que
--    conhece a sequência por sigla); o índice único do código segura a
--    corrida entre dois cadastros. `security invoker`: vale a RLS de quem
--    chama, a mesma do "Editar projeto".
-- 3) `orcamentos_guarda_arquivado` passa a aceitar, no orçamento
--    arquivado, a troca SÓ do código: sem isso, projeto com orçamento
--    arquivado não trocaria de cliente, ou o arquivado ficaria com a sigla
--    velha — e um projeto novo que herdasse o número colidiria com ele no
--    índice único.
--
-- Aditiva: função e gatilho novos, e uma exceção a mais numa guarda. Nada
-- é apagado nem reescrito agora; os códigos só mudam quando alguém troca
-- o cliente na tela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Guarda do cliente
-- ---------------------------------------------------------------------
create or replace function public.projetos_guarda_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Migrations e service role passam, como nas outras guardas.
  if auth.uid() is null then
    return new;
  end if;

  if new.cliente_id is distinct from old.cliente_id then
    if exists (
      select 1 from public.orcamentos o
       where o.projeto_id = new.id
         and o.status in ('aprovado', 'job_criado')
    ) or exists (
      select 1 from public.jobs j
       where j.projeto_id = new.id
         and (j.status <> 'cancelado' or j.data_abertura_financeiro is not null)
    ) then
      raise exception 'O cliente do projeto não muda depois que um orçamento é aprovado.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.projetos_guarda_cliente() from public, anon;

drop trigger if exists trg_projetos_b_guarda_cliente on public.projetos;
create trigger trg_projetos_b_guarda_cliente
  before update of cliente_id on public.projetos
  for each row execute function public.projetos_guarda_cliente();

-- ---------------------------------------------------------------------
-- 2) Troca de cliente com os códigos
-- ---------------------------------------------------------------------
create or replace function public.trocar_cliente_do_projeto(
  p_projeto_id uuid,
  p_cliente_id uuid,
  p_produto_id uuid,
  p_codigo text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_codigo_antigo text;
  v_orcamentos jsonb;
begin
  select p.codigo
    into v_codigo_antigo
    from public.projetos p
   where p.id = p_projeto_id
   for update;

  if v_codigo_antigo is null then
    raise exception 'Projeto não encontrado.' using errcode = 'P0002';
  end if;

  -- A guarda do item 1 dispara aqui e recusa se já houver aprovação.
  update public.projetos
     set cliente_id = p_cliente_id,
         produto_id = p_produto_id,
         codigo = p_codigo
   where id = p_projeto_id;

  -- Prefixo por comparação de texto, não LIKE: um "_" na sigla seria
  -- curinga. Todo código de orçamento segue "[código do projeto]-NN"
  -- (conferido em 29/09/2026: nenhum fora do padrão).
  with trocados as (
    update public.orcamentos o
       set codigo = p_codigo || substr(o.codigo, length(v_codigo_antigo) + 1)
     where o.projeto_id = p_projeto_id
       and left(o.codigo, length(v_codigo_antigo) + 1) = v_codigo_antigo || '-'
     returning o.id, o.codigo
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'codigo', t.codigo)), '[]'::jsonb)
    into v_orcamentos
    from trocados t;

  return jsonb_build_object(
    'codigo_anterior', v_codigo_antigo,
    'codigo', p_codigo,
    'orcamentos', v_orcamentos
  );
end;
$$;

revoke all on function public.trocar_cliente_do_projeto(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.trocar_cliente_do_projeto(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Orçamento arquivado aceita a troca só do código
-- ---------------------------------------------------------------------
-- Mesmo corpo de 20260928400002, com a exceção marcada abaixo.
create or replace function public.orcamentos_guarda_arquivado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projeto_arquivado boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select p.status = 'arquivado'
    into v_projeto_arquivado
    from public.projetos p
   where p.id = new.projeto_id;

  if tg_op = 'INSERT' then
    if coalesce(v_projeto_arquivado, false) then
      raise exception 'Projeto arquivado não recebe orçamento novo. Reative o projeto primeiro.'
        using errcode = '42501';
    end if;
    if new.arquivado_em is not null then
      raise exception 'O orçamento nasce ativo.' using errcode = '42501';
    end if;
    return new;
  end if;

  if coalesce(v_projeto_arquivado, false) then
    raise exception 'Projeto arquivado é só leitura. Reative o projeto para editar.'
      using errcode = '42501';
  end if;

  if old.arquivado_em is not null then
    -- Arquivado só sai do arquivo: nada mais muda junto.
    if new.arquivado_em is not null then
      -- Exceção da decisão 122: o código acompanha a troca de cliente do
      -- projeto. Só ele muda; qualquer outra coluna junto é recusada.
      if (to_jsonb(new) - 'codigo') = (to_jsonb(old) - 'codigo') then
        return new;
      end if;
      raise exception 'Orçamento arquivado é só leitura. Reative o orçamento para editar.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.arquivado_em is not null then
    if old.status in ('aprovado', 'job_criado') then
      raise exception 'Orçamento aprovado ou com job não se arquiva. Desfaça a aprovação antes.'
        using errcode = '42501';
    end if;
    if exists (
      select 1 from public.jobs j
       where j.orcamento_id = new.id
         and (j.status <> 'cancelado' or j.data_abertura_financeiro is not null)
    ) then
      raise exception 'Orçamento com job não se arquiva.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.orcamentos_guarda_arquivado() from public, anon;
