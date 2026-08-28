-- =====================================================================
-- Compra nova não entra em fatura já fechada
--
-- O bug: `fatura_aberta_do_cartao` procurava a fatura da competência pelo
-- par (cartão, competência) e devolvia a que achasse — SEM olhar o status.
-- Então uma compra lançada depois de a fatura daquela competência ter sido
-- fechada (ou paga) caía dentro dela. A fatura paga em 312,50 passava a
-- ter 450,00 em itens, e ninguém era avisado: nenhuma tela mostra soma
-- de fatura paga.
--
-- Pego no segundo ciclo de teste em 28/08/2026: fechei e paguei a
-- FC-00001, lancei outra compra no mesmo cartão, e ela entrou na
-- FC-00001.
--
-- A regra certa: a compra procura a fatura ABERTA. Se a competência dela
-- já fechou, a compra rola para a competência seguinte — e para a
-- seguinte, se aquela também estiver fechada. É o que o banco faz: compra
-- feita depois do fechamento entra na próxima fatura.
--
-- O teto de 24 voltas é só para o loop não ser infinito se alguém criar
-- dois anos de faturas fechadas adiantadas. Nesse caso é melhor estourar
-- com mensagem do que girar.
--
-- Também acrescenta um índice único parcial: um cartão só pode ter UMA
-- fatura aberta por competência. Sem ele, duas inserções concorrentes
-- criariam duas faturas para o mesmo mês.
-- =====================================================================

-- Uma fatura por (cartão, competência). O índice também é a rede de
-- proteção contra corrida entre dois lançamentos simultâneos.
create unique index if not exists uq_fatura_cartao_competencia
  on public.faturas_cartao (cartao_credito_id, competencia_fechamento);

create or replace function public.fatura_aberta_do_cartao(
  p_cartao_id uuid,
  p_data date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cartao      cartoes_credito%rowtype;
  v_fecha       int;
  v_competencia date;
  v_vencimento  date;
  v_fatura_id   uuid;
  v_status      fatura_cartao_status;
  v_ultimo_dia  int;
  v_ano         int;
  v_mes         int;
  v_data        date;
  v_voltas      int := 0;
begin
  select * into v_cartao from cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado: %', p_cartao_id; end if;

  v_fecha := coalesce(v_cartao.dia_fechamento_fatura, v_cartao.dia_vencimento_fatura);
  v_data := p_data;

  loop
    v_voltas := v_voltas + 1;
    if v_voltas > 24 then
      raise exception
        'Não achei fatura aberta para o cartão % em dois anos de competências. Alguma fatura futura foi fechada adiantada?',
        v_cartao.nome;
    end if;

    -- Competência: compra feita depois do dia de fechamento já é do mês
    -- seguinte. `least` cuida de fevereiro e dos meses de 30 dias.
    v_ano := extract(year  from v_data);
    v_mes := extract(month from v_data);
    if extract(day from v_data)::int > v_fecha then
      v_mes := v_mes + 1;
    end if;
    v_ano := v_ano + ((v_mes - 1) / 12);
    v_mes := ((v_mes - 1) % 12) + 1;

    v_ultimo_dia := extract(day from
      (date_trunc('month', make_date(v_ano, v_mes, 1)) + interval '1 month - 1 day')::date);
    v_competencia := make_date(v_ano, v_mes, least(v_fecha, v_ultimo_dia));

    v_vencimento := public.proxima_fatura_cartao(p_cartao_id, v_data);

    select id, status into v_fatura_id, v_status
      from faturas_cartao
     where cartao_credito_id = p_cartao_id
       and competencia_fechamento = v_competencia;

    if not found then
      insert into faturas_cartao (
        tenant_id, cartao_credito_id, codigo,
        competencia_fechamento, data_vencimento, status, created_by
      ) values (
        v_cartao.tenant_id, p_cartao_id,
        public.gerar_codigo_fatura_cartao(v_cartao.tenant_id),
        v_competencia, v_vencimento, 'aberta', auth.uid()
      )
      returning id into v_fatura_id;

      return v_fatura_id;
    end if;

    if v_status = 'aberta' then
      return v_fatura_id;
    end if;

    -- Fatura já fechada ou paga: a compra é da competência seguinte. O dia
    -- seguinte ao fechamento é justamente a primeira data que cai na
    -- próxima — a mesma conta que o banco faz.
    v_data := v_competencia + 1;
  end loop;
end;
$function$;

revoke execute on function public.fatura_aberta_do_cartao(uuid, date) from public;
grant execute on function public.fatura_aberta_do_cartao(uuid, date) to authenticated;
