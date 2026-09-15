-- 20260915000001 — os comentários internos de `emitir_faturamento` passam a citar a decisão 079
--
-- POR QUÊ
--
-- A trava "a nota só cobre jobs de um mesmo cliente" entrou pela
-- 20260914000002 com a decisão numerada 076. Antes de subir para o main, a
-- decisão foi renumerada para 079: outra frente já tinha a 076 (importação
-- da versão). Os dois comentários "-- 076:" dentro da função ficaram como
-- tinham sido aplicados, apontando para a decisão errada. O Tiago pediu o
-- acerto em 15/09/2026.
--
-- O QUE FAZ
--
-- Só troca "-- 076:" por "-- 079:" no corpo da função. Nenhuma linha de
-- lógica muda. Em vez de recopiar as ~300 linhas (e arriscar transcrever
-- errado), lê a definição viva, confere que há exatamente os dois
-- comentários esperados, troca e recria — o mesmo mecanismo da
-- 20260827010007. `create or replace` mantém dono e grants
-- (`authenticated` executa, `anon` não).
--
-- Idempotente: rodada de novo, encontra zero "-- 076:" e os "-- 079:" já no
-- lugar, e sai sem mexer. Qualquer outro estado recusa sem alterar nada.

do $$
declare
  d      text := pg_get_functiondef('public.emitir_faturamento(jsonb)'::regprocedure);
  n_076  int  := (length(d) - length(replace(d, '-- 076:', ''))) / length('-- 076:');
  n_079  int  := (length(d) - length(replace(d, '-- 079:', ''))) / length('-- 079:');
begin
  if n_076 = 0 and n_079 = 2 then
    raise notice 'emitir_faturamento já cita a 079; nada a fazer.';
    return;
  end if;

  if n_076 <> 2 or n_079 <> 0 then
    raise exception
      'emitir_faturamento fora do estado esperado (% comentários "-- 076:", % "-- 079:"). Nada foi alterado.',
      n_076, n_079;
  end if;

  execute replace(d, '-- 076:', '-- 079:');
end $$;
