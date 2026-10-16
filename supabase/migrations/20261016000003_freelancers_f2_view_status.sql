-- Task 016 — Freelancers (Fase 2, Task 2): view de status calculado
--
-- Cria `freelancers_com_status`: freelancer + contrato mais relevante +
-- status derivado em dois níveis (status_contrato e status_calculado).
--
-- SECURITY INVOKER=true: a view respeita as policies RLS das tabelas
-- subjacentes (freelancers, freelancer_contratos). Por default views
-- rodam como DEFINER (owner), o que ignoraria RLS — pra todo o módulo
-- funcionar com permissão certa (GP só vê freela com contrato dele,
-- quando essa policy for apertada), precisa INVOKER.
--
-- Lógica de seleção do contrato (LATERAL join):
--   Ordem de prioridade (ORDER BY), 1 só (LIMIT 1):
--     1. Vigente hoje E status_real=true  (prioridade=1)
--     2. Futuro (data_inicio > hoje) E status_real=true (prioridade=2)
--     3. Qualquer outro (vencido, encerrado, stub)       (prioridade=3)
--   Dentro de cada grupo: data_inicio DESC, created_at DESC.
--
-- status_contrato (olha só pros arquivos/datas do contrato ativo):
--   sem_contrato    → NÃO HÁ contrato
--   sem_minuta      → contrato existe sem minuta_url nem arquivo_url
--   sem_assinado    → tem minuta_url mas sem arquivo_url
--   agendado        → tem arquivo_url e data_inicio > hoje
--   vigente         → arquivo_url + dentro do prazo e > 30 dias pro fim
--   vencendo        → arquivo_url + ≤ 30 dias pro fim
--   vencido         → arquivo_url + data_termino < hoje
--
-- status_calculado (cruza status_contrato + status_real):
--   encerrado       → status_real=false (independente do resto)
--   pendente        → sem_contrato + status_real=true (default)
--   agendado        → agendado
--   regular         → vigente
--   vencendo        → vencendo
--   sem_minuta      → sem_minuta (propaga)
--   sem_assinado    → sem_assinado (propaga)
--   irregular       → vencido com status_real=true (trabalha sem contrato válido!)
--   limbo           → fallback pra casos inconsistentes (não deve ocorrer na prática)

create or replace view public.freelancers_com_status
  with (security_invoker = true)
as
with contrato_ativo as (
  select
    f.id as freelancer_id,
    c.*
  from public.freelancers f
  left join lateral (
    select
      c.*,
      case
        when c.data_inicio is not null
             and c.data_termino is not null
             and c.data_inicio <= current_date
             and c.data_termino >= current_date
             and c.status_real = true
          then 1
        when c.data_inicio is not null
             and c.data_inicio > current_date
             and c.status_real = true
          then 2
        else 3
      end as prioridade
    from public.freelancer_contratos c
    where c.freelancer_id = f.id
    order by
      prioridade,
      c.data_inicio desc nulls last,
      c.created_at desc
    limit 1
  ) c on true
)
select
  -- Dados do freelancer
  f.id,
  f.tenant_id,
  f.nome_social,
  f.nome_completo,
  f.cpf,
  f.rg,
  f.data_nascimento,
  f.email,
  f.celular,
  f.cep,
  f.rua,
  f.numero,
  f.complemento,
  f.bairro,
  f.cidade,
  f.cnpj,
  f.razao_social,
  f.cartao_cnpj_url,
  f.tipo_pagamento,
  f.banco,
  f.agencia,
  f.conta,
  f.pix_chave,
  f.cor_raca,
  f.identidade_genero,
  f.deficiencia,
  f.saude_obs,
  f.contato_emergencia,
  f.acao_prevista,
  f.origem,
  f.created_at,
  f.updated_at,
  f.created_by,
  f.updated_by,

  -- Dados do contrato ativo
  ca.id as contrato_id,
  ca.origem_sistema as contrato_origem_sistema,
  ca.nome_job,
  ca.cargo as cargo_contrato,
  ca.valor,
  ca.tipo,
  ca.data_inicio,
  ca.data_termino,
  ca.cidade as cidade_contrato,
  ca.status_real,
  ca.arquivo_url,
  ca.minuta_url,

  -- Responsável
  ca.responsavel_id,
  p.nome as responsavel_nome,
  p.email as responsavel_email,

  -- Job (do califa-erp)
  j.codigo as job_codigo,
  j.nome as job_nome,

  -- Status derivados
  case
    when ca.id is null then 'sem_contrato'
    when ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'
    when ca.arquivo_url is null then 'sem_assinado'
    when ca.data_inicio is not null and ca.data_inicio > current_date then 'agendado'
    when ca.data_termino is not null and ca.data_termino < current_date then 'vencido'
    when ca.data_termino is not null
         and ca.data_termino <= current_date + interval '30 days'
      then 'vencendo'
    else 'vigente'
  end as status_contrato,

  case
    -- Pessoa não trabalha mais: encerrado domina tudo
    when ca.status_real = false then 'encerrado'
    -- Sem contrato nenhum e status_real=true (ou null): pendente
    when ca.id is null then 'pendente'
    -- Agendado pro futuro
    when ca.data_inicio is not null
         and ca.data_inicio > current_date
         and ca.arquivo_url is not null
      then 'agendado'
    -- Vencido mas pessoa ainda ativa — alerta: trabalho sem contrato válido
    when ca.data_termino is not null
         and ca.data_termino < current_date
         and ca.arquivo_url is not null
      then 'irregular'
    -- Problemas de documento
    when ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'
    when ca.arquivo_url is null then 'sem_assinado'
    -- Vencendo (<=30d)
    when ca.data_termino is not null
         and ca.data_termino <= current_date + interval '30 days'
      then 'vencendo'
    -- Vigente
    when ca.data_termino is null or ca.data_termino >= current_date then 'regular'
    -- Fallback para casos inconsistentes
    else 'limbo'
  end as status_calculado

from public.freelancers f
left join contrato_ativo ca on ca.freelancer_id = f.id
left join public.profiles p on p.id = ca.responsavel_id
left join public.jobs j on j.id = ca.job_id;

comment on view public.freelancers_com_status is
  'Freelancer + contrato ativo + status_contrato (derivado dos arquivos/datas) e status_calculado (cruzado com status_real). SECURITY INVOKER=true; respeita RLS das tabelas base.';

grant select on public.freelancers_com_status to authenticated;
