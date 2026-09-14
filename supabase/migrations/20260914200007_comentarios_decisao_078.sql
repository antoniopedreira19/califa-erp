-- Os comentários do modelo mensal (Fee e Always On) passam a citar a
-- decisão 078.
--
-- A 20260914200006 regravou os comentários com "Decisão 077", depois que a
-- 076 foi tomada no main por outra frente. A 077 também estava em uso, no
-- mesmo dia, pelo pagamento urgente da PP (migration pp_urgente, já
-- aplicada citando a 077), e o Tiago decidiu em 14/09/2026 que ela fica com
-- esse trabalho. O modelo mensal é a 078. As migrations já aplicadas ficam
-- como estão; esta só regrava o texto dos comentários.
--
-- Decisão 078. Aditivo: só `comment on`, nos objetos criados hoje por esta
-- frente.

comment on column public.categorias_dominio.servico_exclusivo_id is
  'Categoria de orçamento que só vale para UM serviço (categorias_dominio de escopo projeto). Preenchida: o orçamento com esta categoria precisa ter este serviço, e o serviço só aceita as categorias exclusivas dele. Escrita só por migration. Decisão 078.';

comment on table public.versoes_orcamento_meses is
  'Meses de uma versão de orçamento do modelo mensal (Fee e Always On): de 1 a 3, todos no mesmo trimestre civil. Os grupos apontam para o mês por mes_id; os itens herdam pelo grupo. Decisão 078.';

comment on column public.versoes_orcamento_grupos.mes_id is
  'Mês do grupo no modelo mensal (versoes_orcamento_meses). Nulo nos modelos nacional e internacional. Decisão 078.';

comment on function public.adicionar_mes_na_versao(uuid, date, date, date) is
  'Mês novo na versão do orçamento mensal + período do orçamento, numa transação. Decisão 078.';
comment on function public.remover_mes_da_versao(uuid, date, date) is
  'Apaga itens, grupos e o mês (nunca o último) + período do orçamento, numa transação. Decisão 078.';
comment on function public.copiar_mes_da_versao(uuid, uuid) is
  'Copia grupos e itens de um mês para outro mês VAZIO da mesma versão. Devolve quantos itens copiou. Decisão 078.';
comment on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) is
  'Troca a categoria do orçamento entrando (meses do período; grupos vão para o 1º mês) ou saindo (só o 1º mês fica) do modelo mensal. Decisão 078.';

comment on function public.orcamento_servico_e_categoria_coerentes() is
  'Recusa orçamento com categoria exclusiva de outro serviço, ou serviço com categoria exclusiva usando outra categoria. Só confere quando serviço ou categoria mudam. Decisão 078.';
