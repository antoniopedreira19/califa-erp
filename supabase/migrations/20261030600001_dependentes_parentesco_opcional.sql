-- Dependentes: parentesco deixa de ser obrigatório.
--
-- Por que: o cadastro de dependente serve ao cálculo do desconto na folha do
-- benefício, e esse cálculo depende só da idade (faixa etária) e do vínculo
-- com o plano. Parentesco é dado descritivo — útil pra relatório, não pra
-- operar o cálculo mensal. Operadoras (SulAmerica e Bradesco Dental) já
-- validaram a elegibilidade de cada dep antes de aparecer na planilha delas,
-- então travar o cadastro à espera de parentesco só atrasa.
--
-- Mantemos a coluna existente e deixamos NULL quando o RH ainda não informou.
-- Nada do que já está lá precisa mudar (todos os registros atuais vieram
-- preenchidos; são zero linhas hoje, mas a regra vale pra frente).

ALTER TABLE public.dependentes
  ALTER COLUMN parentesco DROP NOT NULL;
