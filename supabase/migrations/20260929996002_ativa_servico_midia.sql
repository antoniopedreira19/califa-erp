-- =====================================================================
-- Ativa o serviço Mídia e as categorias Mídia On e Mídia Off
--
-- Vai junto com o código que sabe travar a categoria em breve (decisão
-- 131). A 20260929996001 criou as três linhas inativas para a versão do
-- app que estava no ar não oferecer a Mídia Off como escolhível.
--
-- Decisão 131. Aditivo: `ativo` só passa de false para true nas três
-- linhas criadas pela 20260929996001.
-- =====================================================================

update public.categorias_dominio c
   set ativo = true
  from public.categorias_dominio s
 where s.escopo = 'projeto'
   and lower(s.nome) = lower('Mídia')
   and s.tenant_id = c.tenant_id
   and (c.id = s.id or c.servico_exclusivo_id = s.id)
   and c.ativo = false;
