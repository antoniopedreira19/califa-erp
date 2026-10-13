-- =====================================================================
-- Job da Mídia Off, entrega 2 (decisão 167): a cópia das linhas do job
-- guarda o veículo e as colunas da mídia
--
-- Até a entrega 1 (decisão 147) a Mídia Off ia até a aprovação. O envio
-- para abertura copia as linhas da versão aprovada para o job
-- (`jobs_itens_orcado`), mas a cópia não tinha onde guardar o veículo
-- (`fornecedor_id` da linha da versão) nem as colunas da mídia (praça,
-- peça, formato, inserções por dia, início e fim, tabela, desconto,
-- detalhe). Sem elas o job não mostra a planilha de mídia, não sabe quando
-- termina a veiculação de cada mês — o faturamento do mês só libera depois
-- dela (Tiago, 07 e 13/10/2026) — e a PP do repasse (entrega 3) e a errata
-- (entrega 5) não teriam o veículo da linha.
--
-- Por que na cópia, e não lidas da versão pelo `item_versao_id`: a cópia é
-- o job (a errata a muda; a versão fica como o cliente aprovou), e a linha
-- criada por errata não tem `item_versao_id`.
--
-- Tudo aditivo: colunas novas, nulas fora da Mídia Off, com as MESMAS
-- travas das colunas da versão (migration 20261006500002). Nenhum job de
-- Mídia Off existe ainda (a abertura estava travada): nada a preencher.
-- =====================================================================

alter table public.jobs_itens_orcado
  add column if not exists fornecedor_id uuid references public.fornecedores(id),
  add column if not exists praca text,
  add column if not exists peca text,
  add column if not exists formato text,
  add column if not exists insercoes_por_dia jsonb,
  add column if not exists data_inicio date,
  add column if not exists data_fim date,
  add column if not exists unidade_periodo text,
  add column if not exists valor_unitario_tabela numeric(14,4),
  add column if not exists percentual_desconto numeric(7,4),
  add column if not exists detalhe text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jio_insercoes_por_dia_objeto') then
    alter table public.jobs_itens_orcado
      add constraint jio_insercoes_por_dia_objeto
      check (insercoes_por_dia is null or jsonb_typeof(insercoes_por_dia) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jio_periodo_ordenado') then
    alter table public.jobs_itens_orcado
      add constraint jio_periodo_ordenado
      check (data_inicio is null or data_fim is null or data_fim >= data_inicio);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jio_tabela_nao_negativa') then
    alter table public.jobs_itens_orcado
      add constraint jio_tabela_nao_negativa
      check (valor_unitario_tabela is null or valor_unitario_tabela >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jio_desconto_percentual') then
    alter table public.jobs_itens_orcado
      add constraint jio_desconto_percentual
      check (percentual_desconto is null or (percentual_desconto >= 0 and percentual_desconto <= 100));
  end if;
end $$;

-- FK importante ganha índice (docs/PERFORMANCE.md): a PP do repasse
-- (entrega 3) e o relatório por veículo leem a linha pelo veículo.
create index if not exists idx_jio_fornecedor
  on public.jobs_itens_orcado (fornecedor_id)
  where fornecedor_id is not null;

comment on column public.jobs_itens_orcado.fornecedor_id is
  'Só Mídia Off (decisão 167): o veículo da linha, copiado da versão aprovada no envio para abertura.';
comment on column public.jobs_itens_orcado.praca is 'Só Mídia Off: a praça da linha. Decisão 167 (cópia da 147).';
comment on column public.jobs_itens_orcado.peca is 'Só Mídia Off, grade: a peça (A, B…). Decisão 167.';
comment on column public.jobs_itens_orcado.formato is 'Só Mídia Off: o formato da linha. Decisão 167.';
comment on column public.jobs_itens_orcado.insercoes_por_dia is
  'Só Mídia Off, grade: inserções por dia do mês do grupo ({"3": 2}). A última dá o fim da veiculação do mês. Decisão 167.';
comment on column public.jobs_itens_orcado.data_inicio is 'Só Mídia Off, período: início da veiculação. Decisão 167.';
comment on column public.jobs_itens_orcado.data_fim is
  'Só Mídia Off, período: fim da veiculação — pode cair no mês seguinte e segura o faturamento do mês da linha até lá. Decisão 167.';
comment on column public.jobs_itens_orcado.unidade_periodo is 'Só Mídia Off, período: o que é um período. Decisão 167.';
comment on column public.jobs_itens_orcado.valor_unitario_tabela is 'Só Mídia Off: o unitário de tabela. Decisão 167.';
comment on column public.jobs_itens_orcado.percentual_desconto is 'Só Mídia Off: desconto sobre a tabela, em %. Decisão 167.';
comment on column public.jobs_itens_orcado.detalhe is 'Só Mídia Off: dado do veículo que não entra na conta. Decisão 167.';
