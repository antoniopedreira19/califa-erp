-- 04/11/2026: reduz o limiar de dispensa de minuta pra diária curta.
--
-- Decisão: o limiar original era "< 30 dias de duração" (até 30 diárias
-- pela convenção adotada). O usuário decidiu apertar pra "< 15 dias"
-- (até 15 diárias). Daqui pra frente, só diárias de até 14 dias de
-- duração dispensam minuta — de 15 em diante exige.
--
-- Impacto nos dados vivos: só 1 contrato cai da dispensa (contrato de 15
-- dias já cadastrado, com minuta gerada mas não assinada) — status volta
-- de 'vencendo' pra 'sem_assinado'. O resto da base não muda.
--
-- Mudança aditiva: só altera a expressão booleana `dispensa_documentos`
-- dentro do CTE contrato_ativo. Tudo o mais na view fica igual.

begin;

create or replace view public.freelancers_com_status
with (security_invoker = true) as
with contrato_ativo as (
  select distinct on (c.freelancer_id)
    c.id,
    c.tenant_id,
    c.freelancer_id,
    c.job_id,
    c.job_interno_id,
    c.responsavel_id,
    c.nome_job,
    c.cargo,
    c.tipo,
    c.valor,
    c.data_inicio,
    c.data_termino,
    c.cidade,
    c.observacoes,
    c.status_real,
    c.arquivo_url,
    c.minuta_url,
    c.data_termino_original,
    c.distrato_minuta_url,
    c.distrato_arquivo_url,
    c.distrato_data_proposta,
    c.distrato_motivo,
    c.distrato_solicitado_em,
    c.distrato_solicitado_por,
    c.origem_sistema,
    c.created_at,
    c.updated_at,
    c.created_by,
    c.updated_by,
    (
      c.tipo = 'diarias'
      and c.data_inicio is not null
      and c.data_termino is not null
      and (c.data_termino - c.data_inicio) < 15
    ) as dispensa_documentos
  from public.freelancer_contratos c
  order by
    c.freelancer_id,
    (case
      when c.data_inicio is not null and c.data_termino is not null
        and c.data_inicio <= current_date and c.data_termino >= current_date
        and c.status_real = true then 1
      when c.data_inicio is not null and c.data_inicio > current_date
        and c.status_real = true then 2
      else 3
    end),
    c.data_inicio desc nulls last,
    c.created_at desc
)
select
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
  ca.id as contrato_id,
  ca.origem_sistema as contrato_origem_sistema,
  coalesce(ca.job_id, ca.job_interno_id) as job_id,
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
  ca.responsavel_id,
  p.nome as responsavel_nome,
  p.email as responsavel_email,
  j.codigo as job_codigo,
  coalesce(j.nome, ji.nome) as job_nome,
  case
    when ca.id is null then 'sem_contrato'::text
    when (not coalesce(ca.dispensa_documentos, false))
         and ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'::text
    when (not coalesce(ca.dispensa_documentos, false))
         and ca.arquivo_url is null then 'sem_assinado'::text
    when ca.data_inicio is not null and ca.data_inicio > current_date then 'agendado'::text
    when ca.data_termino is not null and ca.data_termino < current_date then 'vencido'::text
    when ca.data_termino is not null and ca.data_termino <= (current_date + interval '30 days') then 'vencendo'::text
    else 'vigente'::text
  end as status_contrato,
  case
    when ca.status_real = false then 'encerrado'::text
    when ca.id is null then 'pendente'::text
    when ca.data_inicio is not null and ca.data_inicio > current_date
         and (ca.arquivo_url is not null or coalesce(ca.dispensa_documentos, false)) then 'agendado'::text
    when ca.data_termino is not null and ca.data_termino < current_date
         and (ca.arquivo_url is not null or coalesce(ca.dispensa_documentos, false)) then 'irregular'::text
    when (not coalesce(ca.dispensa_documentos, false))
         and ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'::text
    when (not coalesce(ca.dispensa_documentos, false))
         and ca.arquivo_url is null then 'sem_assinado'::text
    when ca.data_termino is not null and ca.data_termino <= (current_date + interval '30 days') then 'vencendo'::text
    when ca.data_termino is null or ca.data_termino >= current_date then 'regular'::text
    else 'limbo'::text
  end as status_calculado,
  f.responsavel_id as freela_responsavel_id,
  pf.nome as freela_responsavel_nome,
  pf.email as freela_responsavel_email,
  case
    when ca.job_id is not null then 'producao'
    when ca.job_interno_id is not null then 'interno'
    else null
  end as job_origem,
  coalesce(ca.dispensa_documentos, false) as dispensa_documentos
from public.freelancers f
  left join contrato_ativo ca on ca.freelancer_id = f.id
  left join public.profiles p on p.id = ca.responsavel_id
  left join public.profiles pf on pf.id = f.responsavel_id
  left join public.jobs j on j.id = ca.job_id
  left join public.freelancer_jobs_internos ji on ji.id = ca.job_interno_id;

commit;
