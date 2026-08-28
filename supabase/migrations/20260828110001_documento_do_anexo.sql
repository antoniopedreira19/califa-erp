-- O anexo passa a dizer QUE documento ele é, e com que número.
--
-- A coluna Documento da Conciliação precisa mostrar "NF 4471" com link, e
-- isso não existia em lugar nenhum: o único documento fiscal estruturado do
-- sistema era a NF de SAÍDA (`faturamentos.numero_nf` + `serie`), que só
-- aparece em recebimento. Do lado da despesa — a maior parte do extrato —
-- havia só `arquivo_path` + `arquivo_nome_original`: o sistema sabia que
-- tinha um PDF chamado `nota-fornecedor.pdf`, não que era uma NF nº 4471.
--
-- Os campos vão na LINHA DO ANEXO, e não no título. Uma PP pode ter NF,
-- boleto e contrato juntos; no título só caberia um deles, e o outro
-- ficaria sem identificação. No anexo cada arquivo se identifica, e a
-- coluna escolhe o primeiro documento fiscal para mostrar.
--
-- As quatro tabelas de anexo têm a mesma forma, então recebem as mesmas
-- duas colunas. Anulável nas duas: anexo gravado antes de hoje não tem o
-- que preencher, e exigir na marra invalidaria o histórico.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'documento_tipo') then
    create type public.documento_tipo as enum (
      'nota_fiscal',
      'recibo',
      'boleto',
      'contrato',
      'outro'
    );
  end if;
end
$$;

comment on type public.documento_tipo is
  'Que documento o anexo é. Acrescentar valor aqui é aditivo — o enum começou no conjunto mínimo que o time nomeou (28/08/2026).';

alter table public.pedidos_compra_anexos
  add column if not exists documento_tipo public.documento_tipo,
  add column if not exists documento_numero text;

alter table public.contas_avulsas_anexos
  add column if not exists documento_tipo public.documento_tipo,
  add column if not exists documento_numero text;

alter table public.desembolsos_anexos
  add column if not exists documento_tipo public.documento_tipo,
  add column if not exists documento_numero text;

alter table public.pp_verba_prestacoes_anexos
  add column if not exists documento_tipo public.documento_tipo,
  add column if not exists documento_numero text;

comment on column public.pedidos_compra_anexos.documento_tipo is
  'Que documento este arquivo é. Nulo em anexo anterior a 28/08/2026.';
comment on column public.pedidos_compra_anexos.documento_numero is
  'Número do documento, como ele aparece no papel. Texto: nota tem série, recibo tem numeração própria, e zero à esquerda importa.';

-- A Conciliação busca "o documento fiscal deste anexo" por tipo. Índice
-- parcial: a esmagadora maioria dos anexos não tem tipo preenchido, e
-- indexar nulo aqui só ocuparia espaço.
create index if not exists idx_pp_anexos_documento
  on public.pedidos_compra_anexos (pedido_compra_id, documento_tipo)
  where documento_tipo is not null;

create index if not exists idx_avulsa_anexos_documento
  on public.contas_avulsas_anexos (conta_avulsa_id, documento_tipo)
  where documento_tipo is not null;

create index if not exists idx_desembolso_anexos_documento
  on public.desembolsos_anexos (desembolso_id, documento_tipo)
  where documento_tipo is not null;

grant select, insert, update, delete on public.pedidos_compra_anexos to authenticated;
grant select, insert, update, delete on public.contas_avulsas_anexos to authenticated;
grant select, insert, update, delete on public.desembolsos_anexos to authenticated;
grant select, insert, update, delete on public.pp_verba_prestacoes_anexos to authenticated;
