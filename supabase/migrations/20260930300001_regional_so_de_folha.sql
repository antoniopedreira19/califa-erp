-- Regional só de folha: a AMBEV sai do alcance da produção (decisão 134).
--
-- Por quê: a regional "AMBEV" (Agência California, criada em 25/09/2026)
-- não é uma unidade de negócio como SP, NE, NO, RJ e SS. Ela abriga os 11
-- CLT da equipe que a AMBEV (cliente) indica e reembolsa todo mês, e que a
-- California contrata na própria folha. É um centro de custo de folha:
-- existe para o RH alocar essas pessoas e para a folha ratear o custo. Como
-- o formulário de projeto lista toda regional ativa da empresa, ela aparecia
-- para a produção como opção em "Novo projeto". Regra do Tiago (30/09): a
-- produção nunca pode escolher essa regional.
--
-- O que muda:
--   1. `regionais.disponivel_em_projetos` (padrão true). Falso = a regional
--      vale para RH, folha e financeiro, mas não para projeto, orçamento e
--      job.
--   2. A AMBEV nasce com falso. Nenhum projeto, orçamento ou job a usa
--      (conferido em 30/09), então nada existente fica inconsistente.
--   3. Trava no banco, não só na tela: projeto, vínculo de regional do
--      projeto, orçamento e job recusam regional só de folha ao gravar. O
--      editor de job grava `regional_id` sem conferir nada, e a regra não
--      pode depender de cada action lembrar dela. Só dispara quando a
--      regional MUDA: linha antiga que fica como está não é barrada.
--
-- O que deliberadamente ficou de fora:
--   - `ativo = false` na AMBEV: tiraria a regional também do RH e da folha
--     (as telas do RH filtram por `ativo`), e 10 linhas da folha de setembro
--     estão em aprovação com ela.
--   - O modelo definitivo ("conta dedicada" como dimensão da alocação, como
--     a descoberta do RH já previa em `docs/modulos/rh/00-descoberta.md`
--     §6.5) é a etapa 2 e depende de respostas do Tiago e de combinar com a
--     frente do RH.
--   - Campo na tela de administração para marcar outra regional como só de
--     folha: por ora só a AMBEV precisa, e a etapa 2 deve aposentá-la.
--
-- Aditiva: coluna nova com padrão, trigger nova e o preenchimento da coluna
-- nova na AMBEV. Nenhum valor existente é sobrescrito.

alter table public.regionais
  add column if not exists disponivel_em_projetos boolean not null default true;

comment on column public.regionais.disponivel_em_projetos is
  'Falso = regional só de folha (centro de custo do RH, ex.: AMBEV). Vale para RH, folha e financeiro, mas não pode ser escolhida em projeto, orçamento ou job. Decisão 134.';

update public.regionais
   set disponivel_em_projetos = false
 where id = 'b3e7e6c8-5c2e-4a3c-83a9-2ab93abb1ab6'
   and nome = 'AMBEV'
   and disponivel_em_projetos;

-- IFs aninhados de propósito: em PL/pgSQL o AND não garante curto-circuito,
-- e `old` não existe no INSERT.
create or replace function public.ck_regional_disponivel_em_projetos()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.regional_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.regional_id is not distinct from old.regional_id then
      return new;
    end if;
  end if;
  if exists (
    select 1
      from public.regionais
     where id = new.regional_id
       and not disponivel_em_projetos
  ) then
    raise exception 'regional_nao_disponivel_em_projetos: a regional % é só de folha e não pode ser usada em projeto, orçamento ou job', new.regional_id
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

comment on function public.ck_regional_disponivel_em_projetos() is
  'Recusa regional só de folha (regionais.disponivel_em_projetos = false) em projeto, projeto_regionais, orçamento e job. Decisão 134.';

drop trigger if exists tr_projetos_regional_disponivel on public.projetos;
create trigger tr_projetos_regional_disponivel
  before insert or update of regional_id on public.projetos
  for each row execute function public.ck_regional_disponivel_em_projetos();

drop trigger if exists tr_projeto_regionais_regional_disponivel on public.projeto_regionais;
create trigger tr_projeto_regionais_regional_disponivel
  before insert or update of regional_id on public.projeto_regionais
  for each row execute function public.ck_regional_disponivel_em_projetos();

drop trigger if exists tr_orcamentos_regional_disponivel on public.orcamentos;
create trigger tr_orcamentos_regional_disponivel
  before insert or update of regional_id on public.orcamentos
  for each row execute function public.ck_regional_disponivel_em_projetos();

drop trigger if exists tr_jobs_regional_disponivel on public.jobs;
create trigger tr_jobs_regional_disponivel
  before insert or update of regional_id on public.jobs
  for each row execute function public.ck_regional_disponivel_em_projetos();
