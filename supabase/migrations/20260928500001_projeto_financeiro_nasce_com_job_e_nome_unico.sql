-- =====================================================================
-- Projeto do financeiro: nasce com o job, tem nome único e some quando
-- fica sem job (decisão 119, Tiago, 28/09/2026)
-- =====================================================================
--
-- O problema, visto no AMB-1010/26: o combo de projeto da abertura
-- mostrava dois "Budweiser - Planejamento 2027 RJ 3T 2026" (AMB-F007/26 e
-- AMB-F008/26), e um deles sem nenhum job. A causa é o "+" do campo
-- Projeto: ele GRAVAVA o projeto na hora, antes da abertura. Quem criava,
-- errava e criava de novo, ou desistia da abertura, deixava um projeto
-- solto. Em 28/09 eram 11 dos 17 projetos do financeiro sem job, e todos
-- os nomes repetidos estavam entre eles.
--
-- As regras que o Tiago fixou:
--
--   1. Todo projeto do financeiro tem pelo menos um job. O projeto nasce
--      na abertura (ou no "Salvar registro"), junto com o job — o "+" só
--      reserva o nome no formulário. Isso é código (actions.ts); aqui fica
--      a outra metade: o projeto que perde o último job some.
--   2. O financeiro pode trocar o projeto de um job já aberto. Se a troca
--      deixa o projeto antigo sem job, o banco apaga o antigo (trigger em
--      `jobs`). A produção não muda: `jobs.projeto_id` é outra coluna.
--   3. Nome único no SISTEMA INTEIRO (não por cliente), sem distinguir
--      maiúscula, acento nem espaço a mais — "teste" e "Teste" são o mesmo.
--   4. Os projetos do financeiro sem job são apagados agora. Só os do
--      financeiro: `projetos` (produção) não entra.
--
-- O que ficou de fora de propósito:
--
--   * Garantia no banco de que o projeto NASCE com job. O insert do
--     projeto e o update do job são duas chamadas do PostgREST, duas
--     transações; uma constraint adiada recusaria o insert sozinho. A
--     action cria o projeto imediatamente antes do update do job e, se o
--     update falhar, apaga o que criou (daí a policy de DELETE abaixo).
--   * Renomear projeto não tem trigger: é um UPDATE comum, e a unicidade
--     do nome vale por índice. A policy de UPDATE passa a exigir
--     administrador ou financeiro — até aqui qualquer membro do tenant
--     podia, e não havia tela que renomeasse.
--
-- Histórico da abertura: `jobs_aberturas` guarda o projeto por id, sem FK,
-- e resolve o nome na hora de mostrar (fotos.ts). Com o projeto apagado,
-- a foto antiga perderia o nome. Por isso a foto ganha
-- `projeto_financeiro_rotulo` ("AMB-F008/26 · Nome"), preenchido no insert
-- por trigger e usado só quando o projeto já não existe.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nome normalizado: sem acento, sem caixa, espaços colapsados
-- ---------------------------------------------------------------------
-- `unaccent` não está instalado e não é imutável; `translate` é, e cobre
-- o que o português escreve.
create or replace function public.nome_de_projeto_normalizado(p_nome text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(
    regexp_replace(
      translate(
        btrim(coalesce(p_nome, '')),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

comment on function public.nome_de_projeto_normalizado(text) is
  'Chave de comparação do nome do projeto do financeiro: sem acento, sem caixa e com espaços colapsados (decisão 119).';

revoke all on function public.nome_de_projeto_normalizado(text) from public, anon;
grant execute on function public.nome_de_projeto_normalizado(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Limpeza: projetos do financeiro sem job (autorizada pelo Tiago)
-- ---------------------------------------------------------------------
-- Em 28/09/2026 eram 11: AMB-F006, AMB-F007, HIT-F001, HIT-F002, HIT-F003,
-- PEV-F001, PEV-F003, PEV-F004, PEV-F006, PEV-F007 e TET-F001. Nenhum
-- aparecia em foto de abertura. O critério é o da regra, não a lista:
-- projeto que ganhou job entre o levantamento e a aplicação fica.
with apagados as (
  delete from public.projetos_financeiro pf
   where not exists (
     select 1 from public.jobs j where j.projeto_financeiro_id = pf.id
   )
  returning pf.id, pf.tenant_id, pf.codigo, pf.nome, pf.cliente_id, pf.created_at
)
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select a.tenant_id, null::uuid, 'projeto_financeiro.apagado_sem_job', 'projeto_financeiro', a.id::text,
       jsonb_build_object(
         'codigo', a.codigo,
         'nome', a.nome,
         'cliente_id', a.cliente_id,
         'criado_em', a.created_at,
         'motivo', 'limpeza',
         'decisao', '119'
       )
from apagados a;

-- ---------------------------------------------------------------------
-- 3. Nome único no tenant
-- ---------------------------------------------------------------------
create unique index if not exists uniq_projetos_financeiro_nome
  on public.projetos_financeiro (tenant_id, public.nome_de_projeto_normalizado(nome));

comment on index public.uniq_projetos_financeiro_nome is
  'Nome do projeto do financeiro não se repete no tenant, sem distinguir caixa, acento ou espaço (decisão 119).';

-- A conferência de nome da tela (antes de reservar ou renomear): devolve o
-- projeto que já usa o nome, para a mensagem dizer qual é. `invoker`: a
-- RLS de `projetos_financeiro` continua valendo.
create or replace function public.projeto_financeiro_com_o_nome(
  p_tenant_id uuid,
  p_nome text,
  p_exceto uuid default null
)
returns table (id uuid, codigo text, nome text, cliente_nome text)
language sql
stable
security invoker
set search_path = public
as $$
  select pf.id, pf.codigo, pf.nome, c.nome_fantasia
    from public.projetos_financeiro pf
    left join public.clientes c on c.id = pf.cliente_id
   where pf.tenant_id = p_tenant_id
     and public.nome_de_projeto_normalizado(pf.nome) = public.nome_de_projeto_normalizado(p_nome)
     and (p_exceto is null or pf.id <> p_exceto)
   limit 1;
$$;

revoke all on function public.projeto_financeiro_com_o_nome(uuid, text, uuid) from public, anon;
grant execute on function public.projeto_financeiro_com_o_nome(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Permissões: renomear e desfazer são do administrador e do financeiro
-- ---------------------------------------------------------------------
drop policy if exists projetos_financeiro_update on public.projetos_financeiro;
create policy projetos_financeiro_update on public.projetos_financeiro
  for update to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (select public.session_role())::text in ('administrador', 'financeiro')
  )
  with check (
    public.is_tenant_member(tenant_id)
    and (select public.session_role())::text in ('administrador', 'financeiro')
  );

-- DELETE só serve para a action desfazer o projeto que ela mesma acabou
-- de criar quando a abertura falha. Projeto com job nunca sai: a FK
-- `jobs_projeto_financeiro_id_fkey` é ON DELETE RESTRICT, e a policy diz
-- o mesmo por extenso.
drop policy if exists projetos_financeiro_delete on public.projetos_financeiro;
create policy projetos_financeiro_delete on public.projetos_financeiro
  for delete to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (select public.session_role())::text in ('administrador', 'financeiro')
    and not exists (
      select 1 from public.jobs j where j.projeto_financeiro_id = projetos_financeiro.id
    )
  );

grant delete on public.projetos_financeiro to authenticated;

-- ---------------------------------------------------------------------
-- 5. O projeto que perde o último job some
-- ---------------------------------------------------------------------
-- `security definer` porque quem troca o projeto do job não precisa
-- enxergar todos os jobs para a conta dar certo — a pergunta "sobrou
-- algum job neste projeto?" é do banco, não da RLS de quem pergunta.
create or replace function public.projeto_financeiro_sem_job_some()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projeto uuid := old.projeto_financeiro_id;
  v_apagado record;
begin
  if v_projeto is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.projeto_financeiro_id is not distinct from v_projeto then
    return null;
  end if;

  -- Trava a linha do projeto antes de contar: um job entrando nele ao
  -- mesmo tempo espera, e a contagem abaixo já o enxerga.
  perform 1 from public.projetos_financeiro where id = v_projeto for update;
  if not found then
    return null;
  end if;

  if exists (select 1 from public.jobs where projeto_financeiro_id = v_projeto) then
    return null;
  end if;

  begin
    delete from public.projetos_financeiro
     where id = v_projeto
    returning id, tenant_id, codigo, nome into v_apagado;
  exception when foreign_key_violation then
    -- Um job apontou para ele no meio do caminho: o projeto fica.
    return null;
  end;

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (
    v_apagado.tenant_id, auth.uid(), 'projeto_financeiro.apagado_sem_job',
    'projeto_financeiro', v_apagado.id::text,
    jsonb_build_object(
      'codigo', v_apagado.codigo,
      'nome', v_apagado.nome,
      'ultimo_job_id', old.id,
      'motivo', case when tg_op = 'DELETE' then 'job_apagado' else 'job_trocou_de_projeto' end,
      'decisao', '119'
    )
  );

  return null;
end;
$$;

revoke all on function public.projeto_financeiro_sem_job_some() from public, anon, authenticated;

drop trigger if exists trg_jobs_projeto_financeiro_sem_job_some on public.jobs;
create trigger trg_jobs_projeto_financeiro_sem_job_some
  after update of projeto_financeiro_id or delete on public.jobs
  for each row execute function public.projeto_financeiro_sem_job_some();

-- ---------------------------------------------------------------------
-- 6. A foto da abertura guarda o rótulo do projeto
-- ---------------------------------------------------------------------
alter table public.jobs_aberturas
  add column if not exists projeto_financeiro_rotulo text;

comment on column public.jobs_aberturas.projeto_financeiro_rotulo is
  '"Código · Nome" do projeto do financeiro no momento da foto. A tela mostra o nome atual pelo id; este só aparece quando o projeto foi apagado por ficar sem job (decisão 119).';

-- Preenche o que está vazio: as fotos que já existem.
update public.jobs_aberturas ja
   set projeto_financeiro_rotulo = pf.codigo || ' · ' || pf.nome
  from public.projetos_financeiro pf
 where pf.id = ja.projeto_financeiro_id
   and ja.projeto_financeiro_rotulo is null;

create or replace function public.jobs_aberturas_rotulo_do_projeto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.projeto_financeiro_id is not null then
    select pf.codigo || ' · ' || pf.nome
      into new.projeto_financeiro_rotulo
      from public.projetos_financeiro pf
     where pf.id = new.projeto_financeiro_id;
  else
    new.projeto_financeiro_rotulo := null;
  end if;
  return new;
end;
$$;

revoke all on function public.jobs_aberturas_rotulo_do_projeto() from public, anon, authenticated;

drop trigger if exists trg_jobs_aberturas_rotulo_do_projeto on public.jobs_aberturas;
create trigger trg_jobs_aberturas_rotulo_do_projeto
  before insert on public.jobs_aberturas
  for each row execute function public.jobs_aberturas_rotulo_do_projeto();
