-- Decisão 277 §10 (25/11/2026): o imposto se divide entre as regionais pela
-- receita de cada uma, registrado como "TDs (REC)".
--
-- O Tiago (25/11): "O rateio regional deve ser feito de acordo com a
-- participação na receita de cada regional. Não deve ser um rateio
-- arbitrário como está feito atualmente, e deve ficar registrado como TDs
-- (REC)". Vale só para os impostos do Fiscal; a receita é a do período da
-- guia (o mês; no IRPJ/CSLL, o trimestre).
--
-- Até aqui, na aprovação e na Guia da contabilidade, o valor de cada empresa
-- gerencial era digitado (na carga do 4T, copiado da planilha) e, sem receita
-- da gerencial, a regional era escolhida. Agora o sistema divide sozinho:
--   - ISS, PIS, COFINS, IRPJ e CSLL próprios: pela receita de cada regional
--     no período (o rateio do cálculo, pelas notas; na Guia da contabilidade,
--     pela receita do período nas notas do sistema ou no histórico);
--   - retenções (ISS retido, CSRF, IRRF): pelas PPs de origem, como já era;
--   - IOF do mútuo: a empresa que emprestou, como já era.
--
-- Esta migration só acrescenta a marca do título: `rateio_pela_receita`, que a
-- coluna REG mostra como "TDs (REC)". Ela nasce marcada, por gatilho, no
-- título de ISS, PIS, COFINS, IRPJ ou CSLL que vem da Apuração (aprovação ou
-- diferença) ou da Guia da contabilidade — os dois caminhos que agora dividem
-- pela receita. O lançamento avulso de Impostos a Pagar não muda.
--
-- Aditiva: coluna nova com default falso e um gatilho de inserção. Os títulos
-- que já existem ficam como estão; os 24 da carga do 4T se refazem à parte,
-- com o OK do Tiago.

alter table public.impostos_a_pagar
  add column if not exists rateio_pela_receita boolean not null default false;

comment on column public.impostos_a_pagar.rateio_pela_receita is
  'Decisão 277 §10: o rateio entre as regionais é pela receita de cada uma no período da guia ("TDs (REC)" na coluna REG).';

create or replace function public._imposto_rateio_pela_receita()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.tributo in ('ISS', 'PIS', 'COFINS', 'IRPJ', 'CSLL')
     and (new.origem in ('apuracao', 'diferenca') or coalesce(new.da_contabilidade, false)) then
    new.rateio_pela_receita := true;
  end if;
  return new;
end;
$function$;

revoke all on function public._imposto_rateio_pela_receita() from public, anon, authenticated;

drop trigger if exists trg_imposto_rateio_pela_receita on public.impostos_a_pagar;
create trigger trg_imposto_rateio_pela_receita
  before insert on public.impostos_a_pagar
  for each row execute function public._imposto_rateio_pela_receita();
