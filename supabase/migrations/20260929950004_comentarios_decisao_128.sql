-- =====================================================================
-- Decisão 128: só os comentários do banco.
--
-- As migrations 20260929950001–950003 foram aplicadas citando a decisão
-- 126 nos `comment on`. No mesmo dia a 126 foi publicada no main por outra
-- frente (o código antigo sai do sistema) e a 127 ficou com o pagamento da
-- PP fora do cadastro; esta virou a 128. Os arquivos das três já dizem 128;
-- esta migration acerta os comentários que o banco guardou. Nenhuma função
-- nem dado muda.
-- =====================================================================

comment on column public.jobs.codigo_reservado is
  'Decisão 128: job cancelado pelo "Cancelar aprovação" da devolução do financeiro. O código fica reservado para o próximo envio do mesmo orçamento, que o reaproveita (reaproveitar_codigo_do_job_devolvido).';

comment on function public.reaproveitar_codigo_do_job_devolvido(uuid, uuid) is
  'Decisão 128: o job novo fica com o código do job cancelado na devolução; o cancelado ganha o sufixo -C1, -C2... Mesma sigla, mesmo orçamento.';

comment on function public.editar_planejado_do_job_devolvido(uuid, text, numeric) is
  'Decisão 128: com o job devolvido, grava o planejado na versão aprovada e na cópia do job, numa transação só.';

comment on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) is
  'Decisões 078 e 128: troca de/para o modelo mensal. Entrando, os grupos vão para o primeiro mês; saindo, os meses se juntam numa planilha só (nada é apagado). Grava serviço e categoria junto.';
