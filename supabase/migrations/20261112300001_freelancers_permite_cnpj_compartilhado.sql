-- Racional:
--   Cônjuges, sócios e familiares podem usar legitimamente o mesmo CNPJ como
--   MEI ou PJ (caso real: a esposa de um freela usa o CNPJ dele). A trava
--   única por (tenant_id, cnpj) bloqueia esse cenário no cadastro público e
--   no CRUD interno.
--
--   Dedup de pessoa continua garantida pelo CPF (uq_freelancers_tenant_cpf),
--   que é o identificador real do indivíduo. O check constraint
--   freelancers_cnpj_razao_social_par (CNPJ e razão social andam juntos ou
--   ambos nulos) permanece inalterado.
--
--   Impacto no app: o tratamento de 23505 em actions.ts e no submit público
--   continua válido, mas passa a pegar apenas colisão de CPF.

drop index if exists public.uq_freelancers_tenant_cnpj;
