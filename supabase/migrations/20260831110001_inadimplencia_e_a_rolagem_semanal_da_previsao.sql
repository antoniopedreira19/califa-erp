-- ---------------------------------------------------------------------------
-- Inadimplência: o registro que fica, e a previsão que rola sozinha.
--
-- Regra do Tiago (31/08/2026):
--
--   1. Inadimplente é o título que passou do VENCIMENTO sem ser recebido. O
--      vencimento nunca muda — quem anda é a previsão.
--   2. A previsão nasce igual ao vencimento (a RPC `emitir_faturamento` já
--      grava assim) e continua editável a qualquer momento.
--   3. Passou do vencimento e ninguém repactuou à mão? A previsão rola
--      sozinha para o MESMO DIA DA SEMANA na semana seguinte, e volta a
--      rolar toda semana enquanto o título não for pago.
--   4. O fato de ter sido inadimplente precisa SOBREVIVER ao pagamento,
--      senão o relatório não consegue listar quem atrasou.
--
-- É o ponto 4 que exige coluna: um status sozinho vira 'pago' na baixa e
-- leva a informação embora. `inadimplente_desde` é gravada uma vez e nunca
-- mais mexida.
--
-- POR QUE A PASTILHA DA TELA NÃO DEPENDE DESTA ROTINA: a aba deriva
-- "Inadimplente" de `data_vencimento < hoje`, e não desta coluna. Se o cron
-- falhar ou atrasar, a tela continua certa; o que se perde é só o registro
-- histórico, que a próxima execução recupera.
--
-- `current_date` sem fuso, como já faz `gerar_ocorrencias_recorrentes`: às
-- 06:00 UTC (03:00 em Brasília) a data UTC e a brasileira são a mesma, e é
-- por isso que o horário do cron importa e está igual ao dele.
-- ---------------------------------------------------------------------------

alter table public.titulos_receber
  add column if not exists inadimplente_desde date;

comment on column public.titulos_receber.inadimplente_desde is
  'Dia em que o titulo passou do vencimento sem ser recebido (vencimento + 1). Gravada uma vez e nunca limpa: sobrevive a baixa, para o relatorio conseguir listar quem atrasou. Nula em titulo que nunca atrasou.';

create index if not exists idx_titulos_receber_inadimplente
  on public.titulos_receber(tenant_id, inadimplente_desde)
  where inadimplente_desde is not null;

-- ---------------------------------------------------------------------------

create or replace function public.rolar_previsao_de_titulos_vencidos()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_titulo   record;
  v_previsao date;
  v_marca    date;
  v_tocados  integer := 0;
begin
  for v_titulo in
    select id, data_vencimento, data_previsao_recebimento, inadimplente_desde
      from public.titulos_receber
     where status = 'em_aberto'
       and pago_em is null
       and data_vencimento < current_date
  loop
    v_previsao := coalesce(
      v_titulo.data_previsao_recebimento,
      v_titulo.data_vencimento
    );

    -- Uma semana de cada vez, até cair em hoje ou depois. Previsão IGUAL a
    -- hoje não rola: o dinheiro ainda pode entrar hoje.
    while v_previsao < current_date loop
      v_previsao := v_previsao + 7;
    end loop;

    -- Gravada uma vez. Reprocessar não reescreve o dia do primeiro atraso.
    v_marca := coalesce(v_titulo.inadimplente_desde, v_titulo.data_vencimento + 1);

    -- Sem mudança, sem escrita: senão a rotina sujaria `updated_at` de todos
    -- os vencidos todo dia, por nada.
    if v_previsao is distinct from v_titulo.data_previsao_recebimento
       or v_marca is distinct from v_titulo.inadimplente_desde
    then
      update public.titulos_receber
         set data_previsao_recebimento = v_previsao,
             inadimplente_desde = v_marca
       where id = v_titulo.id;
      v_tocados := v_tocados + 1;
    end if;
  end loop;

  return v_tocados;
end;
$function$;

comment on function public.rolar_previsao_de_titulos_vencidos() is
  'Rotina diaria: marca inadimplente_desde e rola a previsao de recebimento de semana em semana enquanto o titulo vencido nao e pago. Chamada pelo cron rolar-previsao-titulos-vencidos.';

-- Rotina de manutenção, não porta de usuário: quem chama é o cron.
revoke all on function public.rolar_previsao_de_titulos_vencidos() from public;
revoke all on function public.rolar_previsao_de_titulos_vencidos() from anon;
revoke all on function public.rolar_previsao_de_titulos_vencidos() from authenticated;

-- Mesmo horário do `gerar-recorrentes-diario` que já existe: 06:00 UTC é
-- 03:00 em Brasília, e nesse instante `current_date` bate com a data
-- brasileira. `cron.schedule` com nome repetido atualiza o job, então rodar
-- a migration de novo é seguro.
select cron.schedule(
  'rolar-previsao-titulos-vencidos',
  '0 6 * * *',
  $cron$select public.rolar_previsao_de_titulos_vencidos();$cron$
);
