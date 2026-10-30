-- Dependentes: data_nascimento deixa de ser obrigatória.
--
-- Por que: do mesmo jeito que parentesco, data de nascimento só é mandatória
-- para o cálculo quando o dependente tem vínculo com um benefício por faixa
-- etária (SulAmerica). Para dependente só do Bradesco Dental, o preço é flat
-- (R$ 13) e idade não entra na conta. A planilha da Bradesco não traz
-- data_nascimento — travar o cadastro em NOT NULL impedia os ~30 dependentes
-- só-Dental de entrar.
--
-- A regra "SulAmerica exige data_nascimento" fica como responsabilidade da
-- aplicação (motor da folha de benefícios), não do schema — porque é uma
-- regra condicional (depende do vínculo), e constraints Postgres entre
-- tabelas são caras de manter.

ALTER TABLE public.dependentes
  ALTER COLUMN data_nascimento DROP NOT NULL;
