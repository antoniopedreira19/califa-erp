-- A baixa antes do início da conta passou a ser a decisão 270 (23/11/2026):
-- o 269 já era da "NF da prestação entra no cadastro no envio", no main na
-- mesma manhã. A migration 20261123600001 foi aplicada com "Decisão 269" nos
-- comentários de oito funções; aqui só esse texto muda, nas funções desta
-- entrega (pelo nome), e o comentário de `ligar_baixa_ao_historico`. Sem
-- efeito numa base que já recebeu a 600001 com o número novo.
do $$
declare
  v_nome text;
  v_oid  oid;
  v_def  text;
begin
  foreach v_nome in array array[
    '_conta_da_baixa',
    'dar_baixa_desembolso_parcela',
    'dar_baixa_devolucao_verba',
    'dar_baixa_fatura_cartao',
    'dar_baixa_pp',
    'estornar_valor_da_baixa',
    '_exige_periodo_aberto'
  ] loop
    select p.oid into v_oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nome;
    v_def := pg_get_functiondef(v_oid);
    if position('Decisão 269' in v_def) > 0 then
      execute replace(v_def, 'Decisão 269', 'Decisão 270');
    end if;
  end loop;
end;
$$;

comment on function public.ligar_baixa_ao_historico(uuid, uuid[]) is
  'Decisão 270: a conciliação do histórico. Liga linhas da planilha (mesma conta e dia, carga ativa periodo/cauda/so_dre, sem ligação) a uma baixa com data antes do início da conta, quando somam o valor dela.';
