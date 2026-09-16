-- =====================================================================
-- Decisão 087 — job encerrado continua na fila, no fluxo e protegido
-- =====================================================================
-- Até aqui o job só encerrava sem saldo a faturar (decisão 034), então
-- nenhum encerrado tinha o que faturar ou receber. Agora encerra antes do
-- faturamento terminar, e três objetos que só olhavam o job aberto
-- precisam enxergar também `encerrado` e `finalizado`:
--
-- 1) `vw_faturamento_pendente`: o job encerrado entra na fila "como os
--    outros jobs" (Tiago, 16/09/2026). `finalizado` entra também: se uma
--    nota dele for cancelada, a parcela volta para a fila e o financeiro
--    emite outra (o job não volta a encerrado). O braço de BV não muda —
--    ele nunca filtrou status de job.
--
-- 2) `vw_fluxo_caixa`: as quatro partes de RECEBIMENTO previsto de job
--    (previsão de recebimento, parcela enviada sem nota, e as duas de
--    save) passam a valer para encerrado e finalizado. A previsão de
--    recebimento já some quando o envio do job (ou do mês) existe, então o
--    finalizado não conta nada em dobro. O CRONOGRAMA DE DESEMBOLSOS fica
--    como está, só aberto e em produção: job encerrado não tem PP em
--    aberto nem item sem marcação, e não gera custo novo.
--
-- 3) `cancelar_faturamento`: a nota com save consumido por job encerrado
--    não se cancela, porque reescreveria a margem de um job congelado.
--    `finalizado` é congelado do mesmo jeito.
--
-- As três foram alteradas hoje ou são grandes demais para reescrever sem
-- risco (a view do fluxo tem 30 KB e ganhou o rateio da decisão 086 hoje).
-- Padrão da 20260915150003 e da 20260916110001: troca de trechos exatos na
-- definição que está no banco; cada âncora precisa aparecer exatamente o
-- número de vezes esperado, senão a migration para.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Fila de faturamento
-- ---------------------------------------------------------------------
do $patch$
declare
  v text := pg_get_viewdef('public.vw_faturamento_pendente'::regclass);
  ancora text := E'(j.status = ''aberto''::job_status)';
  troca text := E'(j.status = ANY (ARRAY[''aberto''::job_status, ''encerrado''::job_status, ''finalizado''::job_status]))';
  n int;
begin
  n := (length(v) - length(replace(v, ancora, ''))) / length(ancora);
  if n <> 1 then
    raise exception 'vw_faturamento_pendente: a âncora de status aparece % vez(es), e precisava aparecer uma. A view mudou; revise a migration.', n;
  end if;
  v := rtrim(rtrim(replace(v, ancora, troca)), ';');
  execute 'create or replace view public.vw_faturamento_pendente as ' || v;
end
$patch$;

-- ---------------------------------------------------------------------
-- 2) Fluxo de caixa — só as partes de recebimento
-- ---------------------------------------------------------------------
do $patch$
declare
  v text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  status_antes text := E'(j.status = ANY (ARRAY[''aberto''::job_status, ''em_producao''::job_status]))';
  status_depois text := E'(j.status = ANY (ARRAY[''aberto''::job_status, ''em_producao''::job_status, ''encerrado''::job_status, ''finalizado''::job_status]))';
  ancoras text[] := array[
    E'WHERE ((p.valor > p.valor_proprio) AND ',                        -- previsão de recebimento: parte em save
    E'WHERE ((s.valor > LEAST(s.valor, s.bruto_proprio)) AND ',        -- parcela enviada: parte em save
    E'WHERE ((p.valor_proprio > (0)::numeric) AND ',                   -- previsão de recebimento
    E'WHERE ((LEAST(s.valor, s.bruto_proprio) > (0)::numeric) AND '    -- parcela enviada sem nota
  ];
  i int;
  n int;
begin
  for i in 1 .. array_length(ancoras, 1) loop
    n := (length(v) - length(replace(v, ancoras[i] || status_antes, ''))) / length(ancoras[i] || status_antes);
    if n <> 1 then
      raise exception 'vw_fluxo_caixa: a âncora % aparece % vez(es), e precisava aparecer uma. A view mudou; revise a migration.', i, n;
    end if;
    v := replace(v, ancoras[i] || status_antes, ancoras[i] || status_depois);
  end loop;

  -- O cronograma de desembolsos segue só com aberto e em produção: sobra
  -- exatamente uma ocorrência do filtro antigo, a dele.
  n := (length(v) - length(replace(v, status_antes, ''))) / length(status_antes);
  if n <> 1 then
    raise exception 'vw_fluxo_caixa: o filtro antigo sobrou % vez(es), e só o cronograma de desembolsos devia mantê-lo.', n;
  end if;

  v := rtrim(rtrim(v), ';');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v;
end
$patch$;

-- ---------------------------------------------------------------------
-- 3) Cancelamento de nota com save consumido
-- ---------------------------------------------------------------------
do $patch$
declare
  v text := pg_get_functiondef('public.cancelar_faturamento(uuid,text,uuid)'::regprocedure);
  ancora text := E'and jc.status = ''encerrado''';
  troca text := E'and jc.status in (''encerrado'', ''finalizado'')';
  n int;
begin
  n := (length(v) - length(replace(v, ancora, ''))) / length(ancora);
  if n <> 1 then
    raise exception 'cancelar_faturamento: a âncora aparece % vez(es), e precisava aparecer uma. A função mudou; revise a migration.', n;
  end if;
  execute replace(v, ancora, troca);
end
$patch$;
