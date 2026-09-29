-- Decisão 129 (Tiago, 29/09/2026): a planilha importada é descartada logo
-- depois da importação. O conteúdo já vive na versão, toda exportação sai
-- da planilha do sistema, e nenhuma tela lia o arquivo guardado.
--
-- `orcamento_importacoes` continua registrando cada importação (nome e
-- tamanho do arquivo, aba, linhas lidas, importadas e ignoradas, avisos,
-- autor e data); só `arquivo_path` deixa de ter o que apontar.
--
-- Esta migration só RELAXA a coluna, e por isso entra antes do código: o
-- código de hoje continua gravando o caminho, e o novo passa a gravar
-- nulo. O caminho vazio continua proibido. A limpeza das linhas antigas e
-- dos arquivos que sobrarem vem depois do deploy (20260929700004).

alter table public.orcamento_importacoes
  alter column arquivo_path drop not null;

alter table public.orcamento_importacoes
  drop constraint importacoes_arquivo_nao_vazio;

alter table public.orcamento_importacoes
  add constraint importacoes_arquivo_nao_vazio
  check (arquivo_path is null or length(trim(arquivo_path)) > 0);

comment on column public.orcamento_importacoes.arquivo_path is
  'Onde o XLSX importado ficou guardado no bucket orcamento-importacoes. Nulo desde a decisão 129 (29/09/2026): o arquivo é descartado logo depois da importação.';
