-- Decisão 167, entrega 3 (23/11/2026): o planejado da linha do job de Mídia
-- Off é a nota do veículo.
--
-- A versão de Mídia Off não tem planejado (resposta 9 da planilha: o custo é
-- a nota do veículo, fechada na negociação), e a cópia do job nascia com o
-- planejado zerado. Com a PP do repasse, o planejado volta a ter função: é o
-- "Planejado do item" do painel e do formulário da PP e a régua do aviso de
-- PP acima do planejado. Zerado, toda PP do repasse pareceria acima dele.
--
-- Daqui em diante a abertura grava o planejado na cópia
-- (`planejadoDaLinhaMidia`); este backfill preenche as linhas que já existem
-- com a mesma conta: unitário × a parte do veículo do job (o parâmetro do
-- job, quando o financeiro o mudou — decisão 224), quantidade e períodos do
-- orçado. O total planejado é coluna gerada e fecha sozinho.
--
-- Aditiva: só preenche planejado VAZIO (unitário e quantidade em zero), em
-- linha de job de Mídia Off, fora de save e de linha vermelha. Em 23/11/2026
-- eram as 5 linhas dos jobs de teste do Sandbox (TES-1026/26 e TES-1027/26):
-- a produção não tem job de Mídia Off.

update public.jobs_itens_orcado o
   set valor_unitario_planejado = o.valor_unitario_orcado * coalesce(p.percentual_veiculo, 80) / 100,
       quantidade_planejada = o.quantidade_orcada,
       dias_meses_planejado = o.dias_meses_orcado
  from public.jobs j
  join public.orcamentos orc on orc.id = j.orcamento_id
  join public.categorias_dominio cat on cat.id = orc.categoria_id
  left join public.vw_parametros_do_job p on p.job_id = j.id
 where o.job_id = j.id
   and cat.modelo_planilha = 'midia_off'
   and coalesce(o.valor_unitario_planejado, 0) = 0
   and coalesce(o.quantidade_planejada, 0) = 0
   and coalesce(o.linha_vermelha, false) = false
   and coalesce(o.em_save, false) = false;
