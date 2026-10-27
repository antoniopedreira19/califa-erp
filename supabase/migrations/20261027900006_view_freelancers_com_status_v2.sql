-- Adiciona `freela_responsavel_id` / `freela_responsavel_nome` / `freela_responsavel_email`
-- à view freelancers_com_status (vindos do campo novo `freelancers.responsavel_id`).
--
-- O `responsavel_id` existente (vindo do contrato ativo) continua lá — a
-- coluna RESP. da tabela segue mostrando o do contrato ativo (contexto
-- operacional). O filtro de "meus freelas" pro GP passa a usar
-- `freela_responsavel_id` (dono estável, não some quando contrato encerra).
--
-- Mudança aditiva: só adiciona três colunas no FIM (Postgres não deixa
-- reordenar colunas num create or replace view). Zero quebra em código
-- existente.

begin;

create or replace view public.freelancers_com_status
with (security_invoker = true) as
with contrato_ativo as (
  select distinct on (c.freelancer_id)
    c.id,
    c.tenant_id,
    c.freelancer_id,
    c.job_id,
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
    c.updated_by
  from freelancer_contratos c
  order by c.freelancer_id,
    case
      when c.data_inicio is not null and c.data_termino is not null
           and c.data_inicio <= current_date and c.data_termino >= current_date
           and c.status_real = true then 1
      when c.data_inicio is not null and c.data_inicio > current_date
           and c.status_real = true then 2
      else 3
    end,
    c.data_inicio desc nulls last,
    c.created_at desc
)
select
  f.id, f.tenant_id, f.nome_social, f.nome_completo, f.cpf, f.rg,
  f.data_nascimento, f.email, f.celular, f.cep, f.rua, f.numero,
  f.complemento, f.bairro, f.cidade, f.cnpj, f.razao_social,
  f.cartao_cnpj_url, f.tipo_pagamento, f.banco, f.agencia, f.conta,
  f.pix_chave, f.cor_raca, f.identidade_genero, f.deficiencia, f.saude_obs,
  f.contato_emergencia, f.acao_prevista, f.origem, f.created_at, f.updated_at,
  f.created_by, f.updated_by,
  ca.id as contrato_id,
  ca.origem_sistema as contrato_origem_sistema,
  ca.job_id,
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
  j.nome as job_nome,
  case
    when ca.id is null then 'sem_contrato'::text
    when ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'::text
    when ca.arquivo_url is null then 'sem_assinado'::text
    when ca.data_inicio is not null and ca.data_inicio > current_date then 'agendado'::text
    when ca.data_termino is not null and ca.data_termino < current_date then 'vencido'::text
    when ca.data_termino is not null and ca.data_termino <= (current_date + interval '30 days') then 'vencendo'::text
    else 'vigente'::text
  end as status_contrato,
  case
    when ca.status_real = false then 'encerrado'::text
    when ca.id is null then 'pendente'::text
    when ca.data_inicio is not null and ca.data_inicio > current_date and ca.arquivo_url is not null then 'agendado'::text
    when ca.data_termino is not null and ca.data_termino < current_date and ca.arquivo_url is not null then 'irregular'::text
    when ca.arquivo_url is null and ca.minuta_url is null then 'sem_minuta'::text
    when ca.arquivo_url is null then 'sem_assinado'::text
    when ca.data_termino is not null and ca.data_termino <= (current_date + interval '30 days') then 'vencendo'::text
    when ca.data_termino is null or ca.data_termino >= current_date then 'regular'::text
    else 'limbo'::text
  end as status_calculado,
  -- Colunas novas (adicionadas no FIM pra permitir create or replace sem
  -- reorganizar as existentes; Postgres não deixa reordenar via replace).
  f.responsavel_id as freela_responsavel_id,
  pf.nome as freela_responsavel_nome,
  pf.email as freela_responsavel_email
from freelancers f
left join contrato_ativo ca on ca.freelancer_id = f.id
left join profiles p on p.id = ca.responsavel_id
left join profiles pf on pf.id = f.responsavel_id
left join jobs j on j.id = ca.job_id;

commit;
