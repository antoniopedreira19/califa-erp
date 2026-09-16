-- A nota avulsa passa a exigir rateio de regional (decisão 086).
--
-- Segunda de duas. A 20260916110001 criou `faturamentos_regionais`, gravou o
-- rateio na emissão e fez o fluxo de caixa ler. Esta fecha a porta: nota
-- avulsa sem rateio não entra mais. Só é aplicada depois que o formulário
-- que pede o rateio estiver no ar — antes disso, a emissão avulsa da versão
-- anterior (que não manda rateio) quebraria em produção, que é o erro de
-- 08/09/2026.
--
-- Conferida no fim da transação (DEFERRABLE INITIALLY DEFERRED): a nota
-- nasce antes das linhas do rateio dentro de `emitir_faturamento`.
create or replace function public.exige_rateio_nota_avulsa()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'faturamentos' then
    if new.origem_tipo is distinct from 'avulso' then
      return null;
    end if;
    v_id := new.id;
  else
    v_id := old.faturamento_id;
  end if;

  if exists (
       select 1 from public.faturamentos f
        where f.id = v_id and f.origem_tipo = 'avulso'
     )
     and not exists (
       select 1 from public.faturamentos_regionais r
        where r.faturamento_id = v_id
     ) then
    raise exception 'Toda nota avulsa precisa de rateio de regional. Informe ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

create constraint trigger trg_nota_avulsa_exige_rateio
  after insert on public.faturamentos
  deferrable initially deferred
  for each row execute function public.exige_rateio_nota_avulsa();

create constraint trigger trg_nota_avulsa_rateio_nao_zera
  after delete on public.faturamentos_regionais
  deferrable initially deferred
  for each row execute function public.exige_rateio_nota_avulsa();

revoke all on function public.exige_rateio_nota_avulsa() from public, anon, authenticated;
