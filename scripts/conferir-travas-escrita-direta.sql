-- =====================================================================
-- Conferência das travas de escrita direta (migration 20260928400001)
-- =====================================================================
-- Roda a migration e 34 casos numa transação só, e termina em erro
-- proposital: NADA fica gravado. Cole inteiro no execute_sql do MCP
-- (o de escrita — a migration tem DDL). Depois de aplicada, a parte da
-- migration pode ficar: `create or replace` e `drop trigger if exists`
-- tornam a repetição inofensiva.
--
-- Casos L*: escritas que o app faz, cada uma com o papel da action. Todas
-- têm que PASSAR. O L12 pode parar numa constraint de coluna obrigatória:
-- o que importa é não ser recusado pela guarda.
-- Casos A*: ataques pela API. Todos têm que ser RECUSADOS.
--
-- Usuários de teste: financeiro_teste (66e9058f), gp_teste (17d0424a),
-- produtor_teste (4b221fe7), freelancer_teste (4a9bec5c). Jobs do
-- TES-P001/26: TES-1002/26 (ex-JOB-0034, aberto, sem envio) e
-- TES-1001/26 (ex-JOB-0032, aberto, com envio). Se algum deles mudar de
-- papel ou de status, ajuste antes de rodar.
--
-- 22/09/2026: primeira versão (migration 20260923200001, nunca aplicada).
-- 28/09/2026: revista e rodada contra o banco de produção antes de
-- aplicar — 14 escritas passaram (L12 parou em `responsavel_id` depois da
-- guarda) e 20 ataques foram recusados. O antigo L5 (produtor cancela job
-- aberto) virou o ataque A0; entraram A17–A20 e L13–L14 (a 115 corrige o
-- valor do envio pelo financeiro).
-- =====================================================================
begin;

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

create function pg_temp.caso(p_rotulo text, p_uid text, p_sql text, p_prep text default null)
returns text language plpgsql as $f$
declare n int; s text;
begin
  begin
    if p_prep is not null then execute p_prep; end if;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute p_sql;
    get diagnostics n = row_count;
    execute 'reset role';
    select string_agg(codigo||'='||status, ',') into s from jobs where id in ('a4998fc7-f494-4ee6-be9e-e2e3664ab970','c0160bb8-2e05-4043-94dd-20d7d79fda8f');
    raise exception 'PASSOU linhas=% | %', n, s;
  exception when others then
    return p_rotulo || ' → ' || case when sqlerrm like 'PASSOU%' then sqlerrm else 'RECUSADO: ' || sqlerrm end;
  end;
end $f$;

do $t$
declare r text := '';
begin
  r := r || E'\n' || pg_temp.caso($q$L1 financeiro abre job (aguardando→aberto) [passa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$update jobs set status='aberto' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, $q$update jobs set status='aguardando_abertura' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$L2 financeiro devolve (aguardando→rejeitado) [passa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$update jobs set status='rejeitado_financeiro', motivo_rejeicao='teste de guarda' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, $q$update jobs set status='aguardando_abertura' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$L3 GP reenvia (rejeitado→aguardando) [passa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='aguardando_abertura', motivo_rejeicao=null where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, $q$update jobs set status='rejeitado_financeiro' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$L4 produtor cancela envio (aguardando→cancelado) [passa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$update jobs set status='cancelado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970' and status in ('aguardando_abertura','rejeitado_financeiro')$q$, $q$update jobs set status='aguardando_abertura' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$L6 GP encerra TES-1002/26 (sem envio) [passa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='encerrado', encerrado_em=now(), encerrado_por='17d0424a-6b26-4e2a-bb47-cf1e3597d69b' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970' and status in ('aberto','em_producao')$q$, null);
  r := r || E'\n' || pg_temp.caso($q$L7 GP encerra TES-1001/26 (enviado → finalizado) [passa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='encerrado', encerrado_em=now() where id='c0160bb8-2e05-4043-94dd-20d7d79fda8f' and status in ('aberto','em_producao')$q$, null);
  r := r || E'\n' || pg_temp.caso($q$L8 GP errata abre a revisão e muda o previsto [passa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set abertura_em_revisao=true, abertura_revisao_desde=now(), faturamento_previsto=faturamento_previsto+1 where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$L9 financeiro salva a revisão (fecha) [passa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$update jobs set abertura_em_revisao=false, abertura_revisao_desde=null where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970' and status in ('aberto','em_producao')$q$, $q$update jobs set abertura_em_revisao=true where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$L10 GP edita dados do job [passa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set nome=nome||' ' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$L11 GP envia para faturamento pela RPC [passa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$select enviar_job_para_faturamento(jsonb_build_object('tenant_id','d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','job_id','a4998fc7-f494-4ee6-be9e-e2e3664ab970','valor_faturado',100,'data_faturamento',current_date,'descricao_nf','teste','mes','2026-10-01','parcelas',jsonb_build_array(jsonb_build_object('ordem',1,'valor',100,'data_vencimento',current_date+30))))$q$, null);
  r := r || E'\n' || pg_temp.caso($q$L12 GP cria job novo (aguardando) [passa ou constraint depois da guarda]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$insert into jobs (tenant_id, codigo, projeto_id, orcamento_id, versao_orcamento_aprovada_id, nome, empresa_id, regional_id) select tenant_id, 'JOB-GUARDA', projeto_id, orcamento_id, versao_orcamento_aprovada_id, 'guarda', empresa_id, regional_id from jobs where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$L13 financeiro corrige valor do envio (115) [passa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$update jobs_envio_faturamento set valor_faturado=valor_faturado where job_id='c0160bb8-2e05-4043-94dd-20d7d79fda8f'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$L14 financeiro corrige valor da parcela (115) [passa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$update jobs_envio_faturamento_parcelas set valor=valor where job_id='c0160bb8-2e05-4043-94dd-20d7d79fda8f'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A0 produtor cancela job aberto [recusa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$update jobs set status='cancelado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A17 GP cancela job aberto [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='cancelado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A18 financeiro cancela job aberto [recusa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$update jobs set status='cancelado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A1 produtor encerra [recusa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$update jobs set status='encerrado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A2 GP grava finalizado direto [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='finalizado', finalizado_em=now() where id='c0160bb8-2e05-4043-94dd-20d7d79fda8f'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A3 produtor fecha a revisão [recusa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$update jobs set abertura_em_revisao=false where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, $q$update jobs set abertura_em_revisao=true where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$A4 GP encerra com revisão pendente [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='encerrado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, $q$update jobs set abertura_em_revisao=true where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$A5 GP abre o próprio job (aguardando→aberto) [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='aberto' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, $q$update jobs set status='aguardando_abertura' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$A6 GP reabre job encerrado [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs set status='aberto' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, $q$update jobs set status='encerrado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$A7 freelancer cancela job [recusa ou 0 linhas]$q$, '4a9bec5c-3e70-490c-8984-0846b6a0701d', $q$update jobs set status='cancelado' where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A8 GP cria job já aberto [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$insert into jobs (tenant_id, codigo, projeto_id, orcamento_id, versao_orcamento_aprovada_id, nome, empresa_id, regional_id, status) select tenant_id, 'JOB-GUARDA', projeto_id, orcamento_id, versao_orcamento_aprovada_id, 'guarda', empresa_id, regional_id, 'aberto' from jobs where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A9 produtor cria job [recusa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$insert into jobs (tenant_id, codigo, projeto_id, orcamento_id, versao_orcamento_aprovada_id, nome, empresa_id, regional_id) select tenant_id, 'JOB-GUARDA', projeto_id, orcamento_id, versao_orcamento_aprovada_id, 'guarda', empresa_id, regional_id from jobs where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A10 produtor cria envio [recusa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$insert into jobs_envio_faturamento (tenant_id, job_id, valor_faturado, data_faturamento) values ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','a4998fc7-f494-4ee6-be9e-e2e3664ab970',100,current_date)$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A11 GP envia com revisão pendente [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$insert into jobs_envio_faturamento (tenant_id, job_id, valor_faturado, data_faturamento) values ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','a4998fc7-f494-4ee6-be9e-e2e3664ab970',100,current_date)$q$, $q$update jobs set abertura_em_revisao=true where id='a4998fc7-f494-4ee6-be9e-e2e3664ab970'$q$);
  r := r || E'\n' || pg_temp.caso($q$A12 GP altera valor de envio [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs_envio_faturamento set valor_faturado=1 where job_id='c0160bb8-2e05-4043-94dd-20d7d79fda8f'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A19 GP altera parcela de envio [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$update jobs_envio_faturamento_parcelas set valor=valor where job_id='c0160bb8-2e05-4043-94dd-20d7d79fda8f'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A13 GP põe parcela em envio antigo [recusa]$q$, '17d0424a-6b26-4e2a-bb47-cf1e3597d69b', $q$insert into jobs_envio_faturamento_parcelas (tenant_id, envio_id, job_id, ordem, valor, data_vencimento) select tenant_id, id, job_id, 9, 1, current_date from jobs_envio_faturamento where job_id='c0160bb8-2e05-4043-94dd-20d7d79fda8f'$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A14 produtor cria nota [recusa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$insert into faturamentos (tenant_id, empresa_id, origem_tipo, cliente_id, numero_nf, data_emissao, valor_total, descricao, anexo_nf_path, emitido_por, cnae) values ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','304039bd-509d-4536-aa26-44e7091ee718','job','b32075ad-e6d0-4f13-aea9-af227937a4cb','GUARDA',current_date,1,'guarda','x','4b221fe7-2dca-47ec-a909-8bd0c7e2d74a','0000')$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A15 financeiro cria item de nota direto [recusa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$insert into faturamento_itens (tenant_id, faturamento_id, origem_tipo, origem_id, valor) values ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c', gen_random_uuid(), 'job', 'a4998fc7-f494-4ee6-be9e-e2e3664ab970', 1)$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A16 financeiro altera nota direto [recusa]$q$, '66e9058f-8ba3-4b65-ae0f-c968a76e1471', $q$update faturamentos set descricao='x' where false$q$, null);
  r := r || E'\n' || pg_temp.caso($q$A20 produtor PATCH aberto→encerrado no enviado [recusa]$q$, '4b221fe7-2dca-47ec-a909-8bd0c7e2d74a', $q$update jobs set status='encerrado' where id='c0160bb8-2e05-4043-94dd-20d7d79fda8f'$q$, null);
  raise exception 'RESULTADOS:%', r;
end $t$;
rollback;
