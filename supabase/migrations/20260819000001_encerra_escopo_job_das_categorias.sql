-- =====================================================================
-- Categorias de domínio — encerra o escopo 'job' (DESTRUTIVO)
--
-- Racional:
--   A decisão 019 (19/08/2026) definiu que a categoria do job é a do
--   ORÇAMENTO de origem (categorias_dominio, escopo 'orcamento'). Desde
--   ela, NENHUMA tela oferece as categorias de escopo 'job': o
--   vocabulário ficou órfão, vivo só no histórico de 12 jobs abertos
--   antes da mudança.
--
--   O Tiago autorizou apagá-lo (19/08/2026). Como jobs.categoria_id é FK
--   com ON DELETE RESTRICT, o passo 1 tira os jobs de lá antes que o
--   passo 3 possa apagar as linhas.
--
--   Passo 1 — cada job herda a categoria do orçamento dele. São 12:
--     * 8 (JOB-0005..0010, 0013 e 0015) passam a "Ativação";
--     * 4 (JOB-0001..0004) ficam SEM categoria, porque os orçamentos
--       ORC-0001, ORC-0002, ORC-0003 e PEVETE-0002/26-01 são anteriores
--       à obrigatoriedade de categoria no orçamento (17/08/2026) e nunca
--       tiveram uma. Perda de classificação aceita pelo Tiago na sessão.
--   Passo 2 — trava: aborta se algum job tiver sobrado apontando.
--   Passo 3 — apaga as 5 linhas de escopo 'job'.
--
--   Segurança: orcamentos.categoria_id e projetos.categoria_id nunca
--   apontaram para o escopo 'job' (conferido pelo MCP: 0 linhas), então o
--   DELETE não esbarra em nenhuma outra FK. Não há CHECK de escopo na
--   tabela — quem restringe os valores é o Zod em
--   lib/validations/categorias-dominio.ts, atualizado no mesmo commit.
-- =====================================================================

-- 1) Job herda a categoria do orçamento de origem. Orçamento sem
--    categoria deixa o job sem categoria — é o dado real, não um furo.
update public.jobs j
set categoria_id = o.categoria_id
from public.orcamentos o
where o.id = j.orcamento_id
  and j.categoria_id in (
    select id from public.categorias_dominio where escopo = 'job'
  );

-- 2) Trava: com job preso, o DELETE abaixo falharia no meio da migration
--    com erro de FK. Melhor abortar aqui, dizendo quantos são.
do $$
declare
  presos int;
begin
  select count(*) into presos
  from public.jobs j
  join public.categorias_dominio cd on cd.id = j.categoria_id
  where cd.escopo = 'job';

  if presos > 0 then
    raise exception
      'Ainda há % job(s) apontando para categoria de escopo job — o passo 1 não cobriu todos.',
      presos;
  end if;
end $$;

-- 3) O vocabulário órfão sai do banco.
delete from public.categorias_dominio where escopo = 'job';
