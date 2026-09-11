-- =====================================================================
-- Internacional: a moeda estrangeira ganha campo próprio
--
-- CORREÇÃO da 20260911000001, antes de a tela existir.
--
-- Lá eu havia previsto reaproveitar `taxa_cambio` como taxa de COMPRA e
-- `moeda` como o código estrangeiro ("USD"). Errado: na planilha
-- internacional os valores digitados continuam em REAIS — o design
-- rotula as colunas "R$ Unit." e "Total BRL", e só a coluna calculada
-- está na moeda de fora.
--
-- Como `versoes_orcamento.moeda` é o argumento de `formatCurrency` em
-- toda a planilha, gravar "USD" ali faria a tela inteira imprimir US$ em
-- cima de valores que são BRL — subtotal de grupo, total do orçamento,
-- card de Totais. O erro não daria exceção nenhuma: só números com o
-- símbolo errado.
--
-- Então: `moeda` continua sendo a moeda DOS VALORES (BRL), `taxa_cambio`
-- continua o que era (1), e a moeda estrangeira ganha as duas colunas
-- que faltavam. Cada campo com um significado só.
--
-- Decisão 072. Aditivo: nada sai, nada é sobrescrito.
-- =====================================================================

alter table public.versoes_orcamento
  add column if not exists moeda_estrangeira text,
  add column if not exists cambio_compra     numeric(12,4);

comment on column public.versoes_orcamento.moeda_estrangeira is
  'Código ISO da moeda estrangeira da planilha internacional ("USD", "GBP"). NULL fora do internacional. Não confundir com `moeda`, que é a moeda dos VALORES da planilha e continua BRL.';
comment on column public.versoes_orcamento.cambio_compra is
  'Taxa de COMPRA — a única que converte. É a coluna da moeda estrangeira da planilha (total BRL ÷ compra) e a coluna da moeda da cadeia de faturamento. Na planilha modelo é `B15` (= cotação − 0,20).';

-- `moeda` e `taxa_cambio` voltam ao significado original, agora escrito:
comment on column public.versoes_orcamento.moeda is
  'Moeda dos VALORES da planilha — BRL, inclusive no orçamento internacional. É o que `formatCurrency` recebe.';
comment on column public.versoes_orcamento.taxa_cambio is
  'Taxa de câmbio de `moeda`. Segue 1 em tudo que é BRL. A conversão do internacional NÃO passa por aqui — é `cambio_compra`.';

-- Só o código faz sentido como sigla curta e maiúscula.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'versoes_orcamento_moeda_estrangeira_iso'
  ) then
    alter table public.versoes_orcamento
      add constraint versoes_orcamento_moeda_estrangeira_iso
      check (
        moeda_estrangeira is null
        or moeda_estrangeira ~ '^[A-Z]{3,4}$'
      );
  end if;
end$$;

grant select, insert, update on public.versoes_orcamento to authenticated;
