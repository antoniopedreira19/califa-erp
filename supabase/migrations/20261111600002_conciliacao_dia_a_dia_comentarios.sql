-- =============================================================================
-- 20261111600002 — A conciliação dia a dia é a decisão 254: os comentários
-- do banco (Tiago, 11/11/2026)
-- =============================================================================
-- A migration 20261111600001 foi aplicada quando a decisão ainda se chamava
-- 253. O número foi tomado no mesmo dia pela "Reverter aprovação" do Contas a
-- Pagar, e a conciliação dia a dia virou 254. Aqui só mudam os comentários dos
-- quatro objetos; nenhuma função, tabela, policy ou dado é alterado.
-- =============================================================================

comment on function public.mudar_data_da_baixa(uuid[], date) is
  'Decisão 254: a baixa ainda sem linha do banco muda de dia (a mesma troca de data que a conciliação faz ao ligar), com o período aberto, sem data futura e com auditoria.';

comment on table public.historico_previsoes_datas is
  'Decisão 254: a data que o financeiro deu, pela conciliação, a uma previsão da planilha. Guardada pela impressão digital da linha da planilha, para a carga nova das previsões não sobrescrever a data ajustada.';

comment on function public.mudar_data_da_previsao(uuid, date) is
  'Decisão 254: a previsão da planilha ainda sem linha do banco muda de data pela conciliação. O ajuste fica em historico_previsoes_datas (pela digital) e sobrevive à carga nova.';

comment on function public.retirar_extrato(uuid, uuid, text, integer) is
  'Decisão 254: retira o ÚLTIMO extrato importado da conta (as linhas dele e o arquivo), só com todas as linhas sem conciliação e o período aberto. A tela desfaz as conciliações antes, pelo desfazer_conciliacao. Audita extrato.retirado.';
