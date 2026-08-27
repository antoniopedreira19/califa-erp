-- O teto da PP passa a ser lido pela cópia do job, e a linha vermelha não tem teto.
--
-- Dois problemas do mesmo trigger, os dois criados pela errata na planilha:
--
-- 1. Ele encontrava a linha da planilha por `jio.item_versao_id = r.item_id`.
--    A linha criada por errata não tem item de versão: as duas pontas são
--    nulas, o join não casa e a emissão morria em "Item da PP não foi
--    encontrado na planilha do job" — mensagem que não diz nada a quem só
--    criou uma linha nova.
--
-- 2. A linha VERMELHA nasce com orçado zero de propósito: ela existe para
--    receber custo que o orçamento não previu, e é da PP que esse custo
--    vem. Com o teto do orçado valendo, `v_maximo` seria zero e nenhuma PP
--    passaria — a linha não conseguiria fazer a única coisa que faz.
--
-- A trava do orçado continua inteira para todas as outras linhas.

create or replace function public.pp_valida_saldo_do_item()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_total_orcado numeric;
  v_vermelha     boolean;
  v_soma_outras  numeric;
  v_maximo       numeric;
begin
  -- Cancelar devolve saldo: nunca pode ser barrado por saldo.
  if new.status = 'cancelada' then
    return new;
  end if;

  -- `coalesce` e não `or` no join: a chave nova manda, a antiga é rede
  -- para o realizado que ainda não foi repontado, e o `limit 1` garante
  -- uma linha só.
  select coalesce(jio.total_orcado, 0), jio.linha_vermelha
    into v_total_orcado, v_vermelha
    from public.jobs_itens_realizado r
    join public.jobs_itens_orcado jio
      on jio.id = coalesce(
           r.job_item_orcado_id,
           (select o2.id
              from public.jobs_itens_orcado o2
             where o2.job_id = r.job_id
               and o2.item_versao_id = r.item_id
             limit 1))
   where r.id = new.item_realizado_id;

  if not found then
    raise exception 'Item da PP não foi encontrado na planilha do job.';
  end if;

  -- Linha vermelha: sem teto, por definição.
  if v_vermelha then
    return new;
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
$function$;
