-- 29/10/2026: adiciona `freelancers.endereco_legado` pra receber o texto
-- livre de endereço dos freelancers migrados do RH antigo.
--
-- Contexto: o RH antigo guardava endereço em UM campo text livre
-- (`endereco`). O ERP esperava os campos estruturados (cep, rua, numero,
-- complemento, bairro, cidade). A migração deixou 195 freelancers com
-- só a cidade preenchida — perfil e minuta saíam sem o endereço completo.
--
-- Decisão (29/10/2026): manter o cadastro estruturado como fonte-verdade
-- (bom pra lookup, filtro, CEP automático) e adicionar uma coluna
-- `endereco_legado` com o texto livre do RH antigo como *fallback de
-- leitura*. Perfil, minuta e exportações mostram o legado quando os
-- estruturados estão vazios. O RH preenche os estruturados quando
-- editar a pessoa — aí o legado some da UI por ser inferior em qualidade,
-- mas fica no banco pra referência histórica.
--
-- Mudança puramente aditiva.

alter table public.freelancers
  add column if not exists endereco_legado text;

comment on column public.freelancers.endereco_legado is
  'Texto livre de endereço migrado do RH antigo (campo `freelancers.endereco` lá). Fallback de leitura quando os campos estruturados (rua, numero, bairro, cep) estão vazios. Não editável pelo RH no form novo — é snapshot histórico.';
