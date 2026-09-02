-- Indice para o recorte "Meus" da lista de projetos.
--
-- A regra da decisao 036 foi ampliada em 02/09/2026: um projeto e "meu"
-- quando eu sou designado OU criador dele ou de algum orcamento dentro
-- dele. Uma das pontas dessa regra pergunta "quais versoes EU criei", e
-- `versoes_orcamento.created_by` nao tinha indice — a lista de projetos
-- e a primeira tela do modulo comercial, e varredura de tabela ali e
-- exatamente o que a docs/PERFORMANCE.md manda evitar.
--
-- `projeto_responsaveis(profile_id)`, a outra ponta, ja tinha o seu
-- (`idx_projeto_responsaveis_profile`).
--
-- Aditiva: indice novo, nada e removido nem alterado.

create index if not exists idx_versoes_orcamento_created_by
  on public.versoes_orcamento (tenant_id, created_by);
