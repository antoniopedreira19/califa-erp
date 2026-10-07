-- Revisão da decisão 149 (07/10/2026): a versão só aprova com o par
-- serviço × categoria do orçamento dentro da regra da decisão 078.
--
-- Quatro orçamentos são de antes da 078 e ficaram com serviço Always On e
-- categoria Conteúdo ou Extra. Em 14/09/2026 o Tiago decidiu deixá-los como
-- estavam (o editor não os força a trocar), e o gatilho
-- `orcamento_servico_e_categoria_coerentes` só confere quando serviço ou
-- categoria MUDAM. Em 07/10/2026 ele pediu: eles seguem editáveis, mas não
-- aprovam assim — antes, troca-se a categoria ou o serviço.
--
-- A tela (`bloqueioAprovacaoVersao`) e a action (`aprovarVersao`) já
-- recusam com a mesma frase. Este gatilho é a última porta: vale para
-- qualquer caminho que aprove uma versão, inclusive os que ainda não
-- existem.
--
-- `erro_do_par_servico_categoria` espelha `erroDoParServicoCategoria`
-- (lib/categorias-do-servico.ts), com as mesmas frases. Lê todas as
-- categorias do escopo, inclusive as inativas, como a action.
--
-- Aditiva: função e gatilho novos. Só dispara na passagem para
-- `aprovada`; versão já aprovada não é tocada.

create or replace function public.erro_do_par_servico_categoria(
  p_servico uuid,
  p_categoria uuid
)
returns text
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cat record;
  v_serv record;
  v_tem_exclusiva boolean;
  v_nomes text;
begin
  if p_servico is null or p_categoria is null then
    return null;
  end if;

  select id, nome, modelo_planilha::text as modelo, servico_exclusivo_id,
         coalesce(aceita_servico_interno, false) as aceita_interno,
         coalesce(em_breve, false) as em_breve
    into v_cat
    from categorias_dominio
   where id = p_categoria;

  select id, nome, tenant_id, coalesce(investimento_interno, false) as interno
    into v_serv
    from categorias_dominio
   where id = p_servico;

  if v_cat.id is null or v_serv.id is null then
    return null;
  end if;

  if v_cat.em_breve then
    return format('A categoria %s ainda não está disponível.', v_cat.nome);
  end if;

  -- Decisão 105: o Interno aceita as nacionais e as marcadas para ele;
  -- internacional, não.
  if v_serv.interno then
    if v_cat.modelo = 'internacional' then
      return format('O serviço %s não aceita a categoria %s.', v_serv.nome, v_cat.nome);
    end if;
    if v_cat.servico_exclusivo_id is null or v_cat.aceita_interno then
      return null;
    end if;
    return format('A categoria %s é só para o serviço dela.', v_cat.nome);
  end if;

  select exists (
    select 1 from categorias_dominio
     where tenant_id = v_serv.tenant_id
       and escopo = 'orcamento'
       and servico_exclusivo_id = p_servico
  ) into v_tem_exclusiva;

  -- Serviço com categoria própria (Fee, Always On, Mídia): só as dele.
  if v_tem_exclusiva then
    if v_cat.servico_exclusivo_id = p_servico then
      return null;
    end if;
    select string_agg(nome, ' ou ' order by nome)
      into v_nomes
      from categorias_dominio
     where tenant_id = v_serv.tenant_id
       and escopo = 'orcamento'
       and servico_exclusivo_id = p_servico
       and not coalesce(em_breve, false);
    return format('Com o serviço %s, a categoria é %s.', v_serv.nome, v_nomes);
  end if;

  -- Os demais serviços: as categorias que não são exclusivas de ninguém.
  if v_cat.servico_exclusivo_id is null then
    return null;
  end if;
  return format('A categoria %s é só para o serviço dela.', v_cat.nome);
end;
$$;

comment on function public.erro_do_par_servico_categoria(uuid, uuid) is
  'Decisões 078/105/149: a frase do motivo quando o par serviço × categoria de um orçamento não combina; nulo quando combina. Espelha erroDoParServicoCategoria (lib/categorias-do-servico.ts).';

-- O `service_role` entrou no grant depois, numa migration aplicada à parte
-- (`aprovacao_exige_servico_e_categoria_coerentes_grant`): o `revoke` de
-- `public` o tinha deixado de fora. Aqui o arquivo já mostra o estado final.
revoke all on function public.erro_do_par_servico_categoria(uuid, uuid) from public, anon;
grant execute on function public.erro_do_par_servico_categoria(uuid, uuid) to authenticated, service_role;

create or replace function public.versao_aprova_com_servico_e_categoria_coerentes()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_servico uuid;
  v_categoria uuid;
  v_erro text;
begin
  -- IFs aninhados: o AND do PL/pgSQL não protege a comparação seguinte.
  if new.status::text <> 'aprovada' then
    return new;
  end if;
  if old.status::text = 'aprovada' then
    return new;
  end if;

  select servico_id, categoria_id
    into v_servico, v_categoria
    from orcamentos
   where id = new.orcamento_id;

  v_erro := public.erro_do_par_servico_categoria(v_servico, v_categoria);
  if v_erro is not null then
    raise exception 'Serviço e categoria do orçamento não combinam: % Troque a categoria ou o serviço no "Editar" do orçamento antes de aprovar.',
      lower(left(v_erro, 1)) || substr(v_erro, 2)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.versao_aprova_com_servico_e_categoria_coerentes() is
  'Revisão da decisão 149 (07/10/2026): a versão só passa para aprovada com o par serviço × categoria do orçamento dentro da regra da 078.';

drop trigger if exists trg_versao_aprova_com_servico_e_categoria_coerentes on public.versoes_orcamento;
create trigger trg_versao_aprova_com_servico_e_categoria_coerentes
  before update of status on public.versoes_orcamento
  for each row
  execute function public.versao_aprova_com_servico_e_categoria_coerentes();
