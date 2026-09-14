-- Os comentários do modelo mensal (Fee e Always On) apontam para a decisão
-- certa.
--
-- As migrations 20260914200002 a 200005 foram aplicadas com "Decisão 076"
-- nos comentários das colunas, da tabela e das funções. No mesmo dia, outra
-- frente publicou no main a decisão 076 (a importação da versão pergunta de
-- onde vem o planejado), e a do modelo mensal passou a ser a 077. As
-- migrations já aplicadas ficam como estão; esta só regrava o texto dos
-- comentários.
--
-- Decisão 077. Aditivo: só `comment on`, nos objetos criados hoje por esta
-- frente.

comment on column public.categorias_dominio.servico_exclusivo_id is
  'Categoria de orçamento que só vale para UM serviço (categorias_dominio de escopo projeto). Preenchida: o orçamento com esta categoria precisa ter este serviço, e o serviço só aceita as categorias exclusivas dele. Escrita só por migration. Decisão 077.';

comment on table public.versoes_orcamento_meses is
  'Meses de uma versão de orçamento do modelo mensal (Fee e Always On): de 1 a 3, todos no mesmo trimestre civil. Os grupos apontam para o mês por mes_id; os itens herdam pelo grupo. Decisão 077.';

comment on column public.versoes_orcamento_grupos.mes_id is
  'Mês do grupo no modelo mensal (versoes_orcamento_meses). Nulo nos modelos nacional e internacional. Decisão 077.';

comment on function public.adicionar_mes_na_versao(uuid, date, date, date) is
  'Mês novo na versão do orçamento mensal + período do orçamento, numa transação. Decisão 077.';
comment on function public.remover_mes_da_versao(uuid, date, date) is
  'Apaga itens, grupos e o mês (nunca o último) + período do orçamento, numa transação. Decisão 077.';
comment on function public.copiar_mes_da_versao(uuid, uuid) is
  'Copia grupos e itens de um mês para outro mês VAZIO da mesma versão. Devolve quantos itens copiou. Decisão 077.';
comment on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) is
  'Troca a categoria do orçamento entrando (meses do período; grupos vão para o 1º mês) ou saindo (só o 1º mês fica) do modelo mensal. Decisão 077.';

comment on function public.orcamento_servico_e_categoria_coerentes() is
  'Recusa orçamento com categoria exclusiva de outro serviço, ou serviço com categoria exclusiva usando outra categoria. Só confere quando serviço ou categoria mudam. Decisão 077.';
