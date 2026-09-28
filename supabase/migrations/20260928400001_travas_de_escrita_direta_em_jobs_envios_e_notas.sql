-- =====================================================================
-- Travas de escrita direta em jobs, envios para faturamento e notas
-- =====================================================================
-- Pedido do Tiago em 22/09/2026, depois da revisão da 087, e retomado em
-- 28/09/2026: "o status não pode ser modificado manualmente". Confirmado
-- em 22/09 por simulação como `produtor_teste`, numa transação desfeita:
-- pela API do Supabase, com o próprio login, qualquer usuário com acesso à
-- empresa do job conseguia
--   * encerrar o job pulando as travas, e gravar `finalizado` direto;
--   * cancelar job ABERTO (a action que fazia isso pelo console saiu em
--     28/09, na revisão da decisão 020 — a API continuava aceitando);
--   * fechar a revisão da abertura, que é do financeiro;
--   * alterar o valor de um envio para faturamento já feito;
--   * criar nota e item de nota sem passar por `emitir_faturamento`.
-- Nenhuma tela faz isso; a porta era a RLS, que só olha tenant, empresa e
-- regional, somada ao GRANT de INSERT/UPDATE para `authenticated`.
--
-- Preparada em 22/09 (branch feat/travas-escrita-direta, nunca aplicada)
-- e revista em 28/09 contra o que entrou desde então (099, 105, 111–114
-- e as funções da 115, já no banco):
--   * `aberto | em_producao → cancelado` saiu: ninguém cancela job aberto
--     (revisão da 020). O cancelamento é só o da pré-abertura.
--   * o UPDATE do envio não sai mais do `authenticated`: a 115
--     (`registrar_alteracao_do_financeiro`, SECURITY INVOKER) corrige o
--     valor do envio e das parcelas quando o financeiro edita o orçado.
--     Vira guarda: só administrador e financeiro alteram envio.
--   * o papel de quem cria o envio já é conferido por
--     `envio_faturamento_autor` (24/09); a guarda daqui confere o job.
--
-- O que muda (nada no app):
--
-- 1) `jobs` — gatilho de guarda, antes de todos os outros BEFORE (o nome
--    começa com "a"). Vale só para a escrita que chega como
--    `authenticated` (API e Server Actions). Função do banco com
--    `security definer` roda como o dono e passa: é assim que o gatilho do
--    envio e o do encerramento gravam `finalizado` e que as RPCs de save
--    (099) abrem e fecham a revisão.
--      * job nasce `aguardando_abertura`, por administrador ou GP;
--      * as mudanças de status são as que o app faz, cada uma com o papel
--        da action (lib/permissoes.ts):
--          aguardando_abertura → aberto | rejeitado_financeiro
--                                          administrador, financeiro
--          rejeitado_financeiro → aguardando_abertura
--                                          administrador, GP
--          aguardando_abertura | rejeitado_financeiro → cancelado
--                                          administrador, GP, produtor
--          aberto | em_producao → encerrado administrador, GP
--        qualquer outra é recusada — `finalizado` só pelo banco, job
--        aberto não se cancela, e job encerrado, finalizado ou cancelado
--        não muda mais;
--      * encerrar com a revisão da abertura pendente é recusado;
--      * fechar a revisão da abertura é do administrador e do financeiro.
--    As pendências do encerramento (PP, BV, verba, marcação) continuam só
--    no servidor do app.
--
-- 2) Envio para faturamento — `enviar_job_para_faturamento` é SECURITY
--    INVOKER e precisa do INSERT.
--      * envio: job aberto, em produção ou encerrado, sem revisão da
--        abertura pendente;
--      * parcela: só junto do envio, na mesma transação — o envio tem que
--        ter nascido agora (`created_at = now()`);
--      * alterar envio ou parcela: administrador ou financeiro.
--
-- 3) Notas — o app só grava por `emitir_faturamento` e
--    `cancelar_faturamento`, que são `security definer` e conferem o papel.
--    O INSERT/UPDATE direto de `authenticated` sai.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) jobs
-- ---------------------------------------------------------------------
create or replace function public.jobs_guarda_escrita_direta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_papel text;
  v_de    text;
  v_para  text;
begin
  -- Só a escrita feita como o usuário. Dentro de função `security
  -- definer` o current_user é o dono, e a regra é da própria função.
  if current_user <> 'authenticated' then
    return new;
  end if;

  v_papel := coalesce(public.session_role()::text, '');

  if tg_op = 'INSERT' then
    if new.status is distinct from 'aguardando_abertura'::public.job_status then
      raise exception 'Job novo nasce aguardando abertura.'
        using errcode = '42501';
    end if;
    if v_papel not in ('administrador', 'gerente_producao') then
      raise exception 'Só o GP ou o administrador envia job para abertura.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_de := old.status::text;
  v_para := new.status::text;

  if v_de is distinct from v_para then
    if not (
         (v_de = 'aguardando_abertura'
            and v_para in ('aberto', 'rejeitado_financeiro')
            and v_papel in ('administrador', 'financeiro'))
      or (v_de = 'rejeitado_financeiro'
            and v_para = 'aguardando_abertura'
            and v_papel in ('administrador', 'gerente_producao'))
      or (v_de in ('aguardando_abertura', 'rejeitado_financeiro')
            and v_para = 'cancelado'
            and v_papel in ('administrador', 'gerente_producao', 'produtor'))
      or (v_de in ('aberto', 'em_producao')
            and v_para = 'encerrado'
            and v_papel in ('administrador', 'gerente_producao'))
    ) then
      raise exception 'Mudança de status do job não permitida (% → %).', v_de, v_para
        using errcode = '42501';
    end if;

    if v_para = 'encerrado' and coalesce(new.abertura_em_revisao, false) then
      raise exception 'O job não encerra com a revisão da abertura pendente no financeiro.'
        using errcode = '42501';
    end if;
  end if;

  if coalesce(old.abertura_em_revisao, false)
     and not coalesce(new.abertura_em_revisao, false)
     and v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro fecha a revisão da abertura.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.jobs_guarda_escrita_direta() is
  'Guarda da escrita direta em jobs (28/09/2026): status só pelas transições do app, cada uma com o seu papel; job aberto não se cancela; finalizado só pelo banco; encerrar sem revisão pendente; revisão fechada só pelo financeiro. Não vale dentro de função security definer.';

revoke all on function public.jobs_guarda_escrita_direta() from public, anon;

drop trigger if exists trg_jobs_a_guarda_escrita_direta on public.jobs;
create trigger trg_jobs_a_guarda_escrita_direta
  before insert or update on public.jobs
  for each row
  execute function public.jobs_guarda_escrita_direta();

-- ---------------------------------------------------------------------
-- 2) Envio para faturamento
-- ---------------------------------------------------------------------
create or replace function public.envio_faturamento_guarda_escrita_direta()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status    text;
  v_revisao   boolean;
  v_tenant    uuid;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(public.session_role()::text, '') not in ('administrador', 'financeiro') then
      raise exception 'Só o financeiro altera um envio para faturamento já feito.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- O papel de quem envia é conferido por `envio_faturamento_autor`.
  select j.status::text, coalesce(j.abertura_em_revisao, false), j.tenant_id
    into v_status, v_revisao, v_tenant
    from public.jobs j
   where j.id = new.job_id;

  if not found or v_tenant is distinct from new.tenant_id then
    raise exception 'Job não encontrado.' using errcode = '42501';
  end if;
  if v_status not in ('aberto', 'em_producao', 'encerrado') then
    raise exception 'Só job aberto ou encerrado pode ser enviado para faturamento.'
      using errcode = '42501';
  end if;
  if v_revisao then
    raise exception 'O envio para faturamento volta quando o financeiro salvar a revisão da abertura.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.envio_faturamento_guarda_escrita_direta() from public, anon;

drop trigger if exists trg_envio_faturamento_guarda_escrita_direta on public.jobs_envio_faturamento;
create trigger trg_envio_faturamento_guarda_escrita_direta
  before insert or update on public.jobs_envio_faturamento
  for each row
  execute function public.envio_faturamento_guarda_escrita_direta();

create or replace function public.envio_parcela_guarda_escrita_direta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(public.session_role()::text, '') not in ('administrador', 'financeiro') then
      raise exception 'Só o financeiro altera a parcela de um envio para faturamento.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- A parcela só nasce com o envio, na mesma transação: `now()` é a hora
  -- de início da transação, e o `created_at` do envio é o default.
  if not exists (
    select 1
      from public.jobs_envio_faturamento e
     where e.id = new.envio_id
       and e.job_id = new.job_id
       and e.tenant_id = new.tenant_id
       and e.created_at = now()
  ) then
    raise exception 'A parcela do envio para faturamento só nasce junto do envio.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.envio_parcela_guarda_escrita_direta() from public, anon;

drop trigger if exists trg_envio_parcela_guarda_escrita_direta on public.jobs_envio_faturamento_parcelas;
create trigger trg_envio_parcela_guarda_escrita_direta
  before insert or update on public.jobs_envio_faturamento_parcelas
  for each row
  execute function public.envio_parcela_guarda_escrita_direta();

-- ---------------------------------------------------------------------
-- 3) Notas: só pelas funções do financeiro
-- ---------------------------------------------------------------------
revoke insert, update on public.faturamentos from authenticated;
revoke insert on public.faturamento_itens from authenticated;
