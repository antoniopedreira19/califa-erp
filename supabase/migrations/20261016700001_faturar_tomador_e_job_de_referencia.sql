-- Decisão 184 — o formulário do Faturar redesenhado (protótipo aprovado em
-- 16/10/2026) e o que ele passou a registrar.
--
-- 1. CNPJ do tomador é campo do Faturar, nas duas notas. Na de job nasce com
--    o CNPJ do envio e pode ser trocado (a nota pode sair para outra empresa
--    do cliente); na avulsa nasce com o do cadastro do cliente. Até aqui a
--    RPC ignorava o formulário: tirava o CNPJ do envio ou do cadastro.
-- 2. "Tomador no exterior, sem CNPJ": cliente de fora sai para a
--    subsidiária brasileira (é só outro CNPJ) ou sem CNPJ, com a nota
--    emitida no recebimento. Vale no Faturar e no envio do GP, por isso as
--    duas tabelas ganham `tomador_exterior`, e o CNPJ da nota do envio deixa
--    de ser obrigatório quando a marca está ligada.
-- 3. Nota avulsa referente a um job (`job_referencia_id`): empresa
--    (gerencial), regional e cliente saem do job. O rateio continua sendo a
--    forma de guardar a regional (a Apuração e o fluxo já leem dele): com
--    job, ele é a regional do job a 100%.
-- 4. Empresa (gerencial) travada no job: a nota de job (e a de BV) só sai
--    na empresa do job. O formulário já não deixa escolher; a RPC confere.
--
-- Fica de fora, de propósito: imposto da nota sem CNPJ (exportação de
-- serviço) — o cálculo continua o de hoje até a contabilidade responder; a
-- receita avulsa com job entrar na rentabilidade do job; a divisão da
-- receita em Job e Save (pendência do plano de contas, 16/10).
--
-- Aditiva: colunas novas com default, e o CNPJ da nota do envio só perde o
-- NOT NULL (as 100% das linhas de hoje continuam com CNPJ válido, e a nova
-- regra exige CNPJ sempre que a marca do exterior está desligada).

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

alter table public.faturamentos
  add column if not exists tomador_exterior boolean not null default false,
  add column if not exists job_referencia_id uuid references public.jobs(id) on delete restrict;

comment on column public.faturamentos.tomador_exterior is
  'Decisão 184: tomador no exterior, nota sem CNPJ do tomador (cnpj_tomador nulo).';
comment on column public.faturamentos.job_referencia_id is
  'Decisão 184: o job a que a nota AVULSA se refere. Não consome saldo de faturamento do job; empresa, regional e cliente da nota são os dele.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_faturamento_tomador_exterior') then
    alter table public.faturamentos
      add constraint chk_faturamento_tomador_exterior
      check (not tomador_exterior or cnpj_tomador is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_faturamento_job_referencia') then
    alter table public.faturamentos
      add constraint chk_faturamento_job_referencia
      check (job_referencia_id is null or origem_tipo = 'avulso');
  end if;
end $$;

create index if not exists idx_faturamentos_job_referencia
  on public.faturamentos (job_referencia_id)
  where job_referencia_id is not null;

alter table public.jobs_envio_faturamento_notas
  add column if not exists tomador_exterior boolean not null default false;

comment on column public.jobs_envio_faturamento_notas.tomador_exterior is
  'Decisão 184: o GP marcou "Tomador no exterior, sem CNPJ" — a nota do envio vai sem CNPJ.';

alter table public.jobs_envio_faturamento_notas
  alter column cnpj drop not null;

alter table public.jobs_envio_faturamento_notas
  drop constraint if exists chk_envio_nota_cnpj;
alter table public.jobs_envio_faturamento_notas
  add constraint chk_envio_nota_cnpj
  check (
    (tomador_exterior and cnpj is null)
    or (not tomador_exterior and cnpj ~ '^[0-9]{14}$')
  );

-- ---------------------------------------------------------------------------
-- 2. A fila do Faturamento leva a marca do exterior (coluna nova no fim)
-- ---------------------------------------------------------------------------

create or replace view public.vw_faturamento_pendente as
 WITH parcela_faturada AS (
         SELECT fi.envio_parcela_id,
            sum(fi.valor)::numeric(14,2) AS valor_faturado,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo <> 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_save
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE f.status = 'emitido'::faturamento_status AND fi.envio_parcela_id IS NOT NULL
          GROUP BY fi.envio_parcela_id
        ), parcelas AS (
         SELECT par.id,
            par.envio_id,
            par.job_id,
            par.tenant_id,
            par.ordem,
            par.valor,
            par.data_vencimento,
            count(*) OVER (PARTITION BY par.envio_id)::smallint AS total,
            COALESCE(pf.valor_faturado, 0::numeric)::numeric(14,2) AS ja_faturado,
            COALESCE(pf.faturado_proprio, 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(pf.faturado_save, 0::numeric)::numeric(14,2) AS faturado_save,
            GREATEST(0::numeric, LEAST(par.valor,
                CASE
                    WHEN e.mes IS NOT NULL THEN e.valor_faturado - COALESCE(e.valor_save, 0::numeric)
                    ELSE COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric)
                END - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor)))::numeric(14,2) AS bruto_proprio,
            e.mes,
            par.nota_id,
            n.ordem AS nota_ordem,
            (( SELECT count(*) AS count
                   FROM jobs_envio_faturamento_notas n2
                  WHERE n2.envio_id = par.envio_id))::smallint AS nota_total,
            n.cnpj AS nota_cnpj,
            n.cnae_sugerido AS nota_cnae_sugerido,
            n.descritivo AS nota_descritivo,
            n.tomador_exterior AS nota_tomador_exterior
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs_envio_faturamento e ON e.id = par.envio_id
             JOIN jobs j ON j.id = par.job_id
             JOIN jobs_envio_faturamento_notas n ON n.id = par.nota_id
             LEFT JOIN parcela_faturada pf ON pf.envio_parcela_id = par.id
        )
 SELECT 'job'::text AS origem_tipo,
    j.id AS origem_id,
    j.tenant_id,
    j.empresa_id,
    j.codigo,
    j.nome AS descricao,
    p.cliente_id,
    NULL::uuid AS fornecedor_id,
    par.valor::numeric AS valor_previsto,
    par.ja_faturado AS valor_ja_faturado,
    (par.valor - par.ja_faturado)::numeric(14,2) AS saldo,
    par.data_vencimento AS data_prevista,
    par.id AS envio_parcela_id,
    par.ordem AS parcela_numero,
    par.total AS parcela_total,
    ( SELECT sum(x.valor - x.ja_faturado)::numeric(14,2) AS sum
           FROM parcelas x
          WHERE x.envio_id = par.envio_id AND (x.valor - x.ja_faturado) > 0::numeric) AS saldo_job,
    LEAST(par.valor, par.bruto_proprio) AS valor_proprio_da_parcela,
    (par.valor - LEAST(par.valor, par.bruto_proprio))::numeric(14,2) AS valor_save_da_parcela,
    GREATEST(0::numeric, LEAST(par.valor, par.bruto_proprio) - par.faturado_proprio)::numeric(14,2) AS saldo_proprio,
    GREATEST(0::numeric, par.valor - LEAST(par.valor, par.bruto_proprio) - par.faturado_save)::numeric(14,2) AS saldo_save,
    j.id AS job_id,
    par.mes AS mes_referencia,
    par.nota_id AS envio_nota_id,
    par.nota_ordem,
    par.nota_total,
    par.nota_cnpj AS cnpj_tomador,
    par.nota_cnae_sugerido AS cnae_sugerido,
    par.nota_descritivo AS descritivo_nota,
    pe.nome AS autor_nome,
    ef.enviado_em AS autor_em,
    par.nota_tomador_exterior AS tomador_exterior
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
     JOIN jobs_envio_faturamento ef ON ef.id = par.envio_id
     LEFT JOIN profiles pe ON pe.id = ef.enviado_por
  WHERE (j.status = ANY (ARRAY['aberto'::job_status, 'encerrado'::job_status, 'finalizado'::job_status])) AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id,
    bv.tenant_id,
    NULL::uuid AS empresa_id,
    jbv.codigo,
    'BV — '::text || COALESCE(v.item, jio.item) AS descricao,
    NULL::uuid AS cliente_id,
    bv.fornecedor_id,
    bv.valor AS valor_previsto,
    0::numeric(14,2) AS valor_ja_faturado,
    bv.valor AS saldo,
    bv.prazo_repasse AS data_prevista,
    NULL::uuid AS envio_parcela_id,
    1::smallint AS parcela_numero,
    1::smallint AS parcela_total,
    bv.valor AS saldo_job,
    bv.valor AS valor_proprio_da_parcela,
    0::numeric(14,2) AS valor_save_da_parcela,
    bv.valor AS saldo_proprio,
    0::numeric(14,2) AS saldo_save,
    jio.job_id,
    NULL::date AS mes_referencia,
    NULL::uuid AS envio_nota_id,
    NULL::smallint AS nota_ordem,
    NULL::smallint AS nota_total,
    NULL::text AS cnpj_tomador,
    NULL::text AS cnae_sugerido,
    NULL::text AS descritivo_nota,
    pb.nome AS autor_nome,
    bv.confirmado_em AS autor_em,
    false AS tomador_exterior
   FROM itens_bv bv
     LEFT JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
     LEFT JOIN profiles pb ON pb.id = bv.confirmado_por
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));

-- ---------------------------------------------------------------------------
-- 3. Envio do GP: a nota pode ir sem CNPJ, com a marca do exterior
-- ---------------------------------------------------------------------------

create or replace function public.enviar_job_para_faturamento(payload jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_tenant_id  uuid := (payload->>'tenant_id')::uuid;
  v_job_id     uuid := (payload->>'job_id')::uuid;
  v_envio_id   uuid;
  v_nota_id    uuid;
  v_nota       jsonb;
  v_par        jsonb;
  v_ordem_nota smallint := 0;
  v_ordem_par  smallint := 0;
  v_cnpj_cad   text;
  v_primeira   date;
  v_exterior   boolean;
  v_uid        uuid := (select auth.uid());
begin
  -- O vencimento mais cedo é a "data de faturamento" do envio — no
  -- payload antigo ela vem pronta; no novo, sai das parcelas das notas.
  if payload ? 'notas' then
    if jsonb_typeof(payload->'notas') is distinct from 'array'
       or jsonb_array_length(payload->'notas') = 0 then
      raise exception 'Informe ao menos uma nota fiscal.' using errcode = 'check_violation';
    end if;
    select min((p->>'data_vencimento')::date) into v_primeira
      from jsonb_array_elements(payload->'notas') n,
           jsonb_array_elements(n->'parcelas') p;
  else
    if jsonb_typeof(payload->'parcelas') is distinct from 'array'
       or jsonb_array_length(payload->'parcelas') = 0 then
      raise exception 'Informe ao menos uma parcela de faturamento.'
        using errcode = 'check_violation';
    end if;
    v_primeira := (payload->>'data_faturamento')::date;
  end if;

  if v_primeira is null then
    raise exception 'Informe o vencimento de cada parcela.' using errcode = 'check_violation';
  end if;

  insert into jobs_envio_faturamento (
    tenant_id, job_id, valor_faturado, numero_po, data_faturamento,
    descricao_nf, portal_id, portal_url, enviado_por, mes, valor_save
  ) values (
    v_tenant_id,
    v_job_id,
    (payload->>'valor_faturado')::numeric,
    nullif(payload->>'numero_po', ''),
    v_primeira,
    nullif(payload->>'descricao_nf', ''),
    nullif(payload->>'portal_id', '')::uuid,
    nullif(payload->>'portal_url', ''),
    nullif(payload->>'enviado_por', '')::uuid,
    nullif(payload->>'mes', '')::date,
    nullif(payload->>'valor_save', '')::numeric
  )
  returning id into v_envio_id;

  if payload ? 'notas' then
    for v_nota in select * from jsonb_array_elements(payload->'notas')
    loop
      if jsonb_typeof(v_nota->'parcelas') is distinct from 'array'
         or jsonb_array_length(v_nota->'parcelas') = 0 then
        raise exception 'Cada nota fiscal precisa de ao menos um vencimento.'
          using errcode = 'check_violation';
      end if;

      -- 184: "Tomador no exterior, sem CNPJ" — a nota vai sem CNPJ.
      v_exterior := coalesce((v_nota->>'tomador_exterior')::boolean, false);

      v_ordem_nota := v_ordem_nota + 1;
      insert into jobs_envio_faturamento_notas
        (tenant_id, envio_id, job_id, ordem, cnpj, tomador_exterior, cnae_sugerido, descritivo)
      values (
        v_tenant_id, v_envio_id, v_job_id, v_ordem_nota,
        case when v_exterior then null
             else regexp_replace(coalesce(v_nota->>'cnpj', ''), '[^0-9]', '', 'g') end,
        v_exterior,
        nullif(trim(v_nota->>'cnae_sugerido'), ''),
        nullif(trim(v_nota->>'descritivo'), '')
      )
      returning id into v_nota_id;

      for v_par in select * from jsonb_array_elements(v_nota->'parcelas')
      loop
        v_ordem_par := v_ordem_par + 1;
        insert into jobs_envio_faturamento_parcelas
          (tenant_id, envio_id, job_id, nota_id, ordem, valor, data_vencimento)
        values (
          v_tenant_id, v_envio_id, v_job_id, v_nota_id, v_ordem_par,
          (v_par->>'valor')::numeric, (v_par->>'data_vencimento')::date
        );
      end loop;
    end loop;
  else
    -- Payload antigo (o app que ainda não conhece as notas): cada parcela
    -- vira uma nota, com o CNPJ do cadastro do cliente e a descrição do
    -- envio — o significado que a parcela tinha.
    select regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') into v_cnpj_cad
      from public.jobs j
      join public.projetos p on p.id = j.projeto_id
      join public.clientes c on c.id = p.cliente_id
     where j.id = v_job_id;

    for v_par in select * from jsonb_array_elements(payload->'parcelas')
    loop
      v_ordem_par := v_ordem_par + 1;
      insert into jobs_envio_faturamento_notas
        (tenant_id, envio_id, job_id, ordem, cnpj, descritivo)
      values (
        v_tenant_id, v_envio_id, v_job_id, v_ordem_par, v_cnpj_cad,
        nullif(trim(payload->>'descricao_nf'), '')
      )
      returning id into v_nota_id;

      insert into jobs_envio_faturamento_parcelas
        (tenant_id, envio_id, job_id, nota_id, ordem, valor, data_vencimento)
      values (
        v_tenant_id, v_envio_id, v_job_id, v_nota_id,
        coalesce((v_par->>'ordem')::smallint, v_ordem_par),
        (v_par->>'valor')::numeric, (v_par->>'data_vencimento')::date
      );
    end loop;
  end if;

  if v_ordem_par = 0 then
    raise exception 'O envio para faturamento precisa de ao menos uma parcela.'
      using errcode = 'check_violation';
  end if;

  -- Anexos da PO: o arquivo já subiu ao Storage; aqui só o registro.
  if jsonb_typeof(payload->'anexos') = 'array' then
    insert into jobs_envio_faturamento_anexos
      (tenant_id, envio_id, job_id, path, nome_arquivo, mime_type, tamanho_bytes)
    select v_tenant_id, v_envio_id, v_job_id,
           a->>'path', a->>'nome_arquivo', a->>'mime_type', (a->>'tamanho_bytes')::bigint
      from jsonb_array_elements(payload->'anexos') a;
  end if;

  -- Contatos de cobrança revistos no envio (D1): a lista do job passa a
  -- ser esta. Só quando o payload traz a lista — o app antigo não traz.
  if jsonb_typeof(payload->'contatos') = 'array' then
    if jsonb_array_length(payload->'contatos') = 0 then
      raise exception 'Informe ao menos um contato de cobrança.' using errcode = 'check_violation';
    end if;

    delete from jobs_contatos
     where job_id = v_job_id
       and tenant_id = v_tenant_id
       and tipo = 'cobranca';

    insert into jobs_contatos (tenant_id, job_id, tipo, nome, numero, email, ordem, created_by)
    select v_tenant_id, v_job_id, 'cobranca',
           trim(t.c->>'nome'), nullif(trim(t.c->>'numero'), ''), trim(t.c->>'email'),
           t.n::integer, v_uid
      from jsonb_array_elements(payload->'contatos') with ordinality as t(c, n);
  end if;

  return v_envio_id;
end;
$function$;
