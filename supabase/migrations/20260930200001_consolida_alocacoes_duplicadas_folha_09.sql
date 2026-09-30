-- Consolida alocações duplicadas dos 4 colaboradores ativos que
-- tinham 2 linhas idênticas (mesmo empresa/regional/rateio). Origem
-- do problema: a mesma folha 09/2026 que duplicou salários também
-- duplicou alocações — fechou a antiga em 2026-09-28 e criou nova
-- em 2026-09-29 com dado idêntico, sem mudança real de alocação.
--
-- Afeta 4 colaboradores: Álezis, Aline, Ana Almeida, Ana Pereira.
-- Todos com data_admissao registrada; a alocação antiga já tinha
-- data_inicio = data_admissao, então basta apagar a duplicata nova
-- e reabrir a antiga (data_fim = null).
--
-- Feito em 2 passos por causa da constraint uniq_colaborador_alocacao_vigente
-- (impede 2 vigentes ao mesmo tempo — se rodasse tudo numa CTE única,
-- o UPDATE veria a linha nova ainda existindo).

-- Passo 1: apagar as alocações vigentes de 29/09 que são duplicata
-- de uma alocação fechada em 28/09 do mesmo colaborador
delete from colaboradores_alocacoes a
using colaboradores c
where a.colaborador_id=c.id
  and c.tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and c.status='ativo'
  and a.data_inicio = '2026-09-29'::date
  and a.data_fim is null
  and exists (
    select 1 from colaboradores_alocacoes a2
    where a2.colaborador_id=a.colaborador_id
      and a2.id <> a.id
      and a2.data_fim = '2026-09-28'::date
      and a2.empresa_id = a.empresa_id
      and a2.regional_id is not distinct from a.regional_id
      and a2.usa_rateio_empresa = a.usa_rateio_empresa
  );

-- Passo 2: reabrir a antiga (que ficou órfã sem sucessora)
update colaboradores_alocacoes a set data_fim = null
from colaboradores c
where a.colaborador_id=c.id
  and c.tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and c.status='ativo'
  and a.data_fim = '2026-09-28'::date
  and not exists (
    select 1 from colaboradores_alocacoes a2
    where a2.colaborador_id=a.colaborador_id
      and a2.id <> a.id
      and a2.data_inicio > a.data_fim
  );
