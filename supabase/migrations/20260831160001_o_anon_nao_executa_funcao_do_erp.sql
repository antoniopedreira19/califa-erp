-- ---------------------------------------------------------------------------
-- Nenhuma funcao do ERP responde a quem nao esta logado.
--
-- O Supabase publica como endpoint HTTP (`/rest/v1/rpc/<nome>`) toda funcao do
-- schema `public` que o papel do requisitante possa executar. Sao dois papeis
-- publicos: `anon` (chega so com a chave publica, que viaja no bundle do
-- navegador) e `authenticated` (tem sessao).
--
-- Trinta funcoes desta base respondiam ao `anon`. Medido em 31/08/2026, sem
-- login nenhum:
--
--   POST /rest/v1/rpc/gerar_codigo_pp {"p_tenant_id": "<qualquer uuid>"}
--   -> "PP-00001"
--
-- A tabela nega ("permission denied for table jobs"), mas a funcao responde:
-- ela e SECURITY DEFINER, roda com os poderes do dono e passa por cima da RLS.
-- A pior do lote e `gerar_ocorrencias_recorrentes()`, que ESCREVE — insere
-- contas avulsas ja aprovadas, mexe nos templates e grava auditoria.
--
-- POR QUE `REVOKE ... FROM PUBLIC` E NAO `FROM anon`
--
-- A ACL das trinta traz `=X/postgres`: o grantee vazio e o PUBLIC. Ou seja, o
-- `anon` nao tem concessao propria — ele executa porque PUBLIC executa, e esse
-- e o default do Postgres para toda funcao nova. `REVOKE ... FROM anon` seria
-- um no-op: o Postgres so remove concessao que foi feita aquele grantee, e
-- deixaria a de PUBLIC de pe. Quem fecha a porta e revogar do PUBLIC.
--
-- POR QUE ISSO NAO QUEBRA NADA (conferido antes de aplicar)
--
--   * Trigger nao precisa de EXECUTE. Quinze das trinta sao funcoes de
--     trigger (`set_updated_at`, `enforce_*`, `save_consumo_valida`...): o
--     Postgres as dispara como parte do INSERT/UPDATE, sem checar privilegio
--     de quem escreveu na tabela. Elas param de ser chamaveis de fora e
--     continuam disparando.
--   * As outras quinze ja tem `authenticated=X/postgres` explicito, que
--     sobrevive a revogacao do PUBLIC. O app segue chamando todas.
--   * O `service_role` tem concessao propria em todas as trinta.
--   * O pg_cron roda como `postgres`, dono das funcoes — nao passa por aqui.
--     `rolar_previsao_de_titulos_vencidos` ja e a prova viva: nem `anon` nem
--     `authenticated` a executam, e o cron das 6h roda todo dia.
--   * Nenhuma tela chama RPC antes do login. A unica candidata era o
--     `log_audit_event` da tela de login, e ela roda DEPOIS do
--     `signInWithPassword` — tanto que `log_audit_event` ja e negada ao `anon`
--     hoje e o login funciona.
--   * Nenhuma extensao instalou funcao em `public`, entao "ALL FUNCTIONS"
--     alcanca so as 73 funcoes do proprio ERP.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public;

-- E as novas ja nascem fechadas. Sem isto, a proxima migration que criar uma
-- funcao sem GRANT explicito reabre exatamente o mesmo buraco — foi assim que
-- as trinta chegaram aqui. Vale para o que o papel `postgres` criar em
-- `public`, que e como toda migration deste projeto e aplicada.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- As quinze que o app chama de fato, reafirmadas de forma explicita. Todas ja
-- tinham a concessao; escreve-las aqui deixa a intencao no historico e torna a
-- migration idempotente se alguem rodar de novo.
grant execute on function public.calcular_proxima_data_inicial(frequencia_recorrencia, smallint, smallint, smallint, smallint, smallint) to authenticated;
grant execute on function public.calcular_proxima_data_recorrencia(contas_avulsas_recorrentes) to authenticated;
grant execute on function public.data_quinzena_do_mes(integer, integer, integer) to authenticated;
grant execute on function public.desaprovar_pp(uuid, text) to authenticated;
grant execute on function public.estornar_baixa_avulsa(uuid, text) to authenticated;
grant execute on function public.estornar_baixa_titulo(uuid, text, uuid) to authenticated;
grant execute on function public.fc_ajusta_dia_util(date) to authenticated;
grant execute on function public.fc_proxima_janela_pagamento(date) to authenticated;
grant execute on function public.gerar_codigo_pp(uuid) to authenticated;
grant execute on function public.recalcular_realizado_do_item(uuid) to authenticated;

-- `gerar_ocorrencias_recorrentes()` NAO volta para `authenticated`. Ela e do
-- cron: gera lancamento aprovado em massa, e nenhuma tela a chama. Fica so
-- para `postgres` e `service_role`, como a irma
-- `rolar_previsao_de_titulos_vencidos` ja era.
