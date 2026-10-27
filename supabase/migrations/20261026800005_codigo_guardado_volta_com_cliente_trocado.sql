-- =====================================================================
-- O código guardado do job volta mesmo com o cliente trocado
-- (decisão 215, resposta do Tiago em 26/10/2026)
-- ---------------------------------------------------------------------
-- Com o cliente no orçamento, o envio para abertura deixa trocar cliente e
-- marca. O Tiago decidiu que o código do job sai da sigla do cliente
-- escolhido no envio, e que o REENVIO mantém o código que o job já tinha
-- — ele pode já ter circulado em PP e e-mail.
--
-- `reaproveitar_codigo_do_job_devolvido` (decisão 128) recusava devolver o
-- código guardado quando a sigla do job novo era outra ("O cliente do
-- projeto mudou"). A trava sai; o resto da função fica igual.
-- =====================================================================

do $$
declare
  v_def text;
  v_trava text := E'  if split_part(v_reserva.codigo, \'-\', 1) <> split_part(v_novo.codigo, \'-\', 1) then\n    raise exception \'O cliente do projeto mudou: o código reservado não vale mais.\'\n      using errcode = \'check_violation\';\n  end if;\n';
begin
  select pg_get_functiondef('public.reaproveitar_codigo_do_job_devolvido'::regproc) into v_def;
  if position(v_trava in v_def) = 0 then
    raise exception 'reaproveitar_codigo_do_job_devolvido mudou: a trava da sigla não está onde se esperava';
  end if;
  execute replace(v_def, v_trava, '');
end
$$;
