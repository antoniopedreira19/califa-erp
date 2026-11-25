-- Termo de quitação da rescisão: colunas em `rescisoes` pro RH anexar o
-- documento na página do colaborador (aba Financeiro → card Rescisão).
--
-- Fluxo:
--   - NF de rescisão continua em `colaboradores_nf_anexos` (escopo_tipo =
--     'rescisao'), reusa o action `anexarNfPorEscopo` — por isso esta
--     migration também adiciona o case faltante na trigger
--     `fn_valida_nf_anexo_escopo` (hoje só valida folha_mensal, ferias_*,
--     decimo_terceiro_*; sem o patch, uma linha com escopo='rescisao' passa
--     sem validação de FK).
--   - Termo de quitação é um documento isolado por rescisão (1:1), então
--     vive em colunas na própria `rescisoes` — não precisa de tabela nova.
--     Se depois entrarem TRCT, exame demissional, comprovantes, viram
--     `rescisoes_documentos`.
--
-- Mudanças aditivas (colunas nullable + validação condicional). Bucket
-- reusa `colaboradores-nf` com path `<tenant>/<colab>/rescisao-termo/<id>.pdf`
-- — a policy do bucket já libera leitura/escrita pra qualquer membro do
-- tenant, e `is_tenant_member` casa com o primeiro segmento do path.

alter table rescisoes
  add column if not exists termo_quitacao_path text,
  add column if not exists termo_quitacao_nome text,
  add column if not exists termo_quitacao_tamanho_bytes integer,
  add column if not exists termo_quitacao_uploaded_at timestamptz,
  add column if not exists termo_quitacao_uploaded_by uuid references profiles(id) on delete set null;

-- Patch na trigger de validação de escopo. CREATE OR REPLACE reusa o nome
-- antigo; o trigger já ligado continua chamando a versão nova.
create or replace function fn_valida_nf_anexo_escopo()
returns trigger
language plpgsql
as $$
begin
  if new.escopo_id is null then
    return new;
  end if;

  if new.escopo_tipo = 'folha_mensal' then
    if not exists (select 1 from folhas_pagamento where id = new.escopo_id) then
      raise exception
        'escopo_id % nao encontrado em folhas_pagamento (escopo_tipo=folha_mensal)',
        new.escopo_id;
    end if;

  elsif new.escopo_tipo in ('ferias_usufruto', 'ferias_abono') then
    if not exists (select 1 from colaboradores_ferias_lancamentos where id = new.escopo_id) then
      raise exception
        'escopo_id % nao encontrado em colaboradores_ferias_lancamentos (escopo_tipo=%)',
        new.escopo_id, new.escopo_tipo;
    end if;

  elsif new.escopo_tipo in ('decimo_terceiro_p1', 'decimo_terceiro_p2') then
    if not exists (select 1 from decimo_terceiro_linhas where id = new.escopo_id) then
      raise exception
        'escopo_id % nao encontrado em decimo_terceiro_linhas (escopo_tipo=%)',
        new.escopo_id, new.escopo_tipo;
    end if;

  elsif new.escopo_tipo = 'decimo_terceiro_adiantamento' then
    if not exists (select 1 from decimo_terceiro_adiantamentos where id = new.escopo_id) then
      raise exception
        'escopo_id % nao encontrado em decimo_terceiro_adiantamentos (escopo_tipo=decimo_terceiro_adiantamento)',
        new.escopo_id;
    end if;

  elsif new.escopo_tipo = 'rescisao' then
    if not exists (select 1 from rescisoes where id = new.escopo_id) then
      raise exception
        'escopo_id % nao encontrado em rescisoes (escopo_tipo=rescisao)',
        new.escopo_id;
    end if;
  end if;

  return new;
end;
$$;
