-- =====================================================================
-- BV líquido na planilha + realizado montado pelas PPs
--
-- Decisão do Tiago em 21/08/2026, a partir do handoff de design
-- "Job - A com Repasse - BV e PP" (telas 4a e 3b). Três mudanças de
-- regra, que só fazem sentido juntas:
--
-- 1. O BV passa a MEXER na planilha, e sempre pelo valor LÍQUIDO
--    (valor − alíquota do job). A dedução aparece em duas leituras da
--    mesma tela — Bruto (padrão, a de hoje) e Líquido (− BV) —, e a
--    chave que alterna as duas é de UI, não de banco.
--
-- 2. `A` e `D` param de ter planejado próprio. Neles o cliente paga o
--    fornecedor diretamente, então não há custo a planejar: o planejado
--    ESPELHA o orçado e a célula deixa de ser editável. `AR` fica de
--    fora — nele o principal passa pela California e há custo a
--    planejar de verdade.
--
-- 3. O REALIZADO deixa de ser digitado. Ele nasce zerado e é montado
--    pelas PPs emitidas no item (todas menos as canceladas). Em `A` e
--    `D`, que nunca geram PP, o realizado é o próprio orçado — isso é
--    substituição de leitura, feita na aplicação, e por isso a linha
--    deles fica com `total_realizado = 0` aqui.
--
-- Consequência da 3: o SALDO que limita novas PPs não pode mais sair do
-- realizado (ele passaria a se limitar sozinho). Passa a sair do ORÇADO
-- do job — o da cópia `jobs_itens_orcado`, que é o que a errata altera.
--
-- ⚠️ MIGRATION DESTRUTIVA, autorizada explicitamente pelo Tiago em
-- 21/08/2026 ("ainda é uma versão teste do sistema, os dados não são
-- reais"). Ela sobrescreve planejado de itens `A`/`D` e zera o realizado
-- digitado à mão. Ver o bloco 9, no fim, para o que exatamente muda.
-- =====================================================================

-- ---------- 1. Snapshot do BV que o PLANEJADO deduz ----------
--
-- Por que gravar em vez de calcular na leitura: depois da aprovação o
-- BV continua editável na planilha do job, e o planejado NÃO pode
-- acompanhar — ele é o compromisso fechado no envio para abertura. O
-- valor novo só se materializa no REALIZADO, e só quando confirmado.
--
-- `null` = ainda não congelado (versão aberta), e a aplicação calcula na
-- hora a partir de `itens_bv`. A aprovação da versão preenche.
alter table public.versoes_orcamento_itens
  add column if not exists bv_liquido_planejado numeric;

alter table public.jobs_itens_orcado
  add column if not exists bv_liquido_planejado numeric;

comment on column public.versoes_orcamento_itens.bv_liquido_planejado is
  'BV líquido congelado na aprovação da versão — o que o PLANEJADO deduz na vista Líquido. NULL enquanto a versão está aberta: aí a aplicação calcula a partir de itens_bv.';

comment on column public.jobs_itens_orcado.bv_liquido_planejado is
  'Cópia de versoes_orcamento_itens.bv_liquido_planejado no envio para abertura. Editar o BV na planilha do job não mexe aqui — só no realizado, e só na confirmação.';

-- ---------- 2. `A` e `D`: planejado espelha o orçado ----------
update public.versoes_orcamento_itens
   set valor_unitario_planejado = valor_unitario_orcado,
       quantidade_planejada     = quantidade_orcada,
       dias_meses_planejado     = dias_meses_orcado
 where tipo_custo in ('A', 'D')
   and (valor_unitario_planejado, quantidade_planejada, dias_meses_planejado)
       is distinct from
       (valor_unitario_orcado, quantidade_orcada, dias_meses_orcado);

update public.jobs_itens_orcado
   set valor_unitario_planejado = valor_unitario_orcado,
       quantidade_planejada     = quantidade_orcada,
       dias_meses_planejado     = dias_meses_orcado
 where tipo_custo in ('A', 'D')
   and (valor_unitario_planejado, quantidade_planejada, dias_meses_planejado)
       is distinct from
       (valor_unitario_orcado, quantidade_orcada, dias_meses_orcado);

-- ---------- 3. Congela o BV das versões JÁ aprovadas ----------
--
-- Versão aberta fica com `null` de propósito: ela ainda calcula na hora,
-- e congela quando for aprovada.
update public.versoes_orcamento_itens vi
   set bv_liquido_planejado = round(
         b.valor * (1 - least(greatest(v.percentual_imposto, 0), 100) / 100),
         2
       )
  from public.versoes_orcamento v,
       public.itens_bv b
 where v.id = vi.versao_orcamento_id
   and b.item_versao_id = vi.id
   and b.situacao <> 'cancelado'
   and v.status = 'aprovada'
   and vi.bv_liquido_planejado is null;

update public.jobs_itens_orcado jio
   set bv_liquido_planejado = vi.bv_liquido_planejado
  from public.versoes_orcamento_itens vi
 where vi.id = jio.item_versao_id
   and vi.bv_liquido_planejado is not null
   and jio.bv_liquido_planejado is null;

-- ---------- 4. Âncora do realizado para todo item de job vivo ----------
--
-- A PP referencia `jobs_itens_realizado.id`. Até aqui a linha nascia no
-- primeiro lançamento manual do realizado; sem lançamento manual, ela
-- precisa existir desde a abertura, senão a calha não teria em que
-- pendurar o "Gerar PP". Job cancelado fica de fora — nele não se emite
-- mais nada.
insert into public.jobs_itens_realizado
  (tenant_id, job_id, item_id, valor_unitario_realizado,
   quantidade_realizada, dias_meses_realizado)
select jio.tenant_id, jio.job_id, jio.item_versao_id, 0, 0, 0
  from public.jobs_itens_orcado jio
  join public.jobs j on j.id = jio.job_id
 where j.status <> 'cancelado'
on conflict (job_id, item_id) do nothing;

-- ---------- 5. `total_realizado` deixa de ser coluna gerada ----------
--
-- Ela era `unitário × QT × D/M`. Agora é a soma das PPs não canceladas,
-- mantida pelo trigger do bloco 7 — e coluna gerada não aceita valor
-- vindo de outra tabela.
--
-- Dropar e recriar joga a coluna para o fim da tabela. Nenhuma view
-- depende dela (conferido) e todo consumidor a lê pelo nome.
alter table public.jobs_itens_realizado drop column if exists total_realizado;

alter table public.jobs_itens_realizado
  add column if not exists total_realizado numeric(18,2) not null default 0;

comment on column public.jobs_itens_realizado.total_realizado is
  'Soma das PPs não canceladas do item, mantida pelo trigger trg_pp_recalcula_realizado. Não é digitada. Em item A e D (que não geram PP) fica 0 e a aplicação lê o orçado no lugar.';

-- Os três campos de entrada param de ser digitados: passam a descrever
-- as PPs (quantidade somada e o unitário que ela implica). Ficam na
-- tabela porque o formulário de BV e o painel "Destrinchar realizado"
-- mostram a quebra, e porque apagá-los seria perder a forma da linha.
comment on column public.jobs_itens_realizado.quantidade_realizada is
  'Soma das quantidades das PPs não canceladas. Mantida pelo trigger — não é mais digitada (21/08/2026).';

-- ---------- 6. Índice da FK que o trigger e o saldo percorrem ----------
create index if not exists idx_pp_item_realizado
  on public.pedidos_compra (item_realizado_id);

-- ---------- 7. O realizado do item é a soma das PPs ----------
create or replace function public.recalcular_realizado_do_item(p_item_realizado_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total numeric;
  v_qtd   numeric;
begin
  if p_item_realizado_id is null then
    return;
  end if;

  select coalesce(sum(valor), 0), coalesce(sum(quantidade), 0)
    into v_total, v_qtd
    from public.pedidos_compra
   where item_realizado_id = p_item_realizado_id
     and status <> 'cancelada';

  update public.jobs_itens_realizado
     set total_realizado          = round(v_total, 2),
         quantidade_realizada     = v_qtd,
         -- D/M em 1 para o unitário exibido ser total ÷ quantidade, que
         -- é o mesmo "unitário efetivo" que a PP parcial já usava.
         dias_meses_realizado     = case when v_qtd > 0 then 1 else 0 end,
         valor_unitario_realizado = case
                                      when v_qtd > 0 then round(v_total / v_qtd, 2)
                                      else 0
                                    end
   where id = p_item_realizado_id;
end;
$$;

comment on function public.recalcular_realizado_do_item(uuid) is
  'Reescreve o realizado de um item a partir das PPs não canceladas dele. Fonte única: chamada pelo trigger em pedidos_compra e pelo backfill.';

create or replace function public.pp_recalcula_realizado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Mover a PP de item (não acontece hoje, mas o update é permitido)
  -- tem que recalcular os DOIS lados.
  if tg_op = 'UPDATE' and old.item_realizado_id is distinct from new.item_realizado_id then
    perform public.recalcular_realizado_do_item(old.item_realizado_id);
  end if;

  if tg_op = 'DELETE' then
    perform public.recalcular_realizado_do_item(old.item_realizado_id);
    return old;
  end if;

  perform public.recalcular_realizado_do_item(new.item_realizado_id);
  return new;
end;
$$;

-- `after`, e não `before`: o realizado é consequência da PP gravada. A
-- trava de saldo (bloco 8) continua em `before`, para recusar antes de
-- escrever.
drop trigger if exists trg_pp_recalcula_realizado on public.pedidos_compra;
create trigger trg_pp_recalcula_realizado
after insert or delete or update of valor, quantidade, item_realizado_id, status
on public.pedidos_compra
for each row execute function public.pp_recalcula_realizado();

-- ---------- 8. O saldo das PPs passa a sair do ORÇADO ----------
--
-- Antes: soma das PPs <= realizado do item. Com o realizado virando a
-- própria soma das PPs, essa trava passaria a comparar o número consigo
-- mesmo e nunca barraria nada.
--
-- Agora: soma das PPs <= orçado do item NO JOB (`jobs_itens_orcado`), que
-- é a cópia que a errata altera — e não o orçado da versão aprovada, que
-- é o registro do que o cliente aprovou e não acompanha errata.
create or replace function public.pp_valida_saldo_do_item()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total_orcado numeric;
  v_soma_outras  numeric;
  v_maximo       numeric;
begin
  -- Cancelar devolve saldo: nunca pode ser barrado por saldo.
  if new.status = 'cancelada' then
    return new;
  end if;

  select coalesce(jio.total_orcado, 0)
    into v_total_orcado
    from public.jobs_itens_realizado r
    join public.jobs_itens_orcado jio
      on jio.job_id = r.job_id
     and jio.item_versao_id = r.item_id
   where r.id = new.item_realizado_id;

  if not found then
    raise exception 'Item da PP não foi encontrado na planilha do job.';
  end if;

  select coalesce(sum(valor), 0) into v_soma_outras
    from public.pedidos_compra
   where item_realizado_id = new.item_realizado_id
     and status <> 'cancelada'
     and id <> new.id;

  v_maximo := v_total_orcado - v_soma_outras;

  -- Meio centavo de tolerância: o valor da PP é quantidade × unitário do
  -- orçado, e o arredondamento da última fatia pode sobrar um centavo
  -- que não deve travar a emissão legítima.
  if new.valor - v_maximo > 0.005 then
    raise exception
      'A soma das PPs deste item passaria do orçado. Orçado: %, já em PPs: %, máximo aceito para esta PP: %.',
      to_char(v_total_orcado, 'FM999999999990.00'),
      to_char(v_soma_outras, 'FM999999999990.00'),
      to_char(greatest(v_maximo, 0), 'FM999999999990.00');
  end if;

  return new;
end;
$$;

comment on function public.pp_valida_saldo_do_item() is
  'Trava de saldo das PPs de um item: soma das não canceladas <= total_orcado da cópia do job. Base trocada do realizado para o orçado em 21/08/2026, quando o realizado passou a ser a própria soma das PPs.';

-- ---------- 9. Backfill do realizado ----------
--
-- O que muda de fato no dado existente:
--   • realizado digitado à mão SEM PP correspondente vai a zero;
--   • realizado com PP fica valendo a soma das PPs;
--   • item `A`/`D` fica em zero e a aplicação lê o orçado no lugar.
-- Loop explícito, e não `select f(id) from tabela`: a função escreve na
-- MESMA tabela que estaria sendo varrida, e depender do snapshot do
-- statement para isso dar certo é sorte, não desenho.
do $$
declare
  r record;
begin
  for r in select id from public.jobs_itens_realizado loop
    perform public.recalcular_realizado_do_item(r.id);
  end loop;
end;
$$;

-- ---------- 10. GRANTs ----------
grant execute on function public.recalcular_realizado_do_item(uuid) to authenticated;
