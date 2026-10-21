-- A declaração do Simples só sai do bucket `fornecedores` por administrador
-- ou financeiro. Corrige a 20261021500002 no mesmo dia, antes do commit.
--
-- Por quê: a 20261021500002 deixava quem é da produção apagar o arquivo que
-- ele mesmo subiu e que nenhum fornecedor aponta, para o ✕ antes de salvar
-- funcionar. Mas "nenhum fornecedor aponta" também vale para o arquivo já
-- gravado que depois foi trocado ou tirado do cadastro, e esse fica no bucket
-- de propósito: é o comprovante das PPs pagas sem retenção (decisão 142 §2;
-- é o caso dos arquivos da Dome e da Alecal, tirados em 07/10, §5). Com a
-- exceção, quem os subiu poderia apagá-los pelo console.
--
-- A regra que o Tiago aprovou em 21/10/2026 é "apagar: só administrador e
-- financeiro", e fica sem exceção. Efeito: se a produção subir uma
-- declaração e desistir antes de salvar, o arquivo solto fica no bucket
-- (`removerDeclaracoesSoltas` só registra a falha no log). Hoje a produção
-- não tem o campo da declaração na tela (decisão 142 §5), então isso não
-- acontece.
--
-- Abrir e anexar continuam como na 20261021500002: quem cadastra fornecedor
-- (administrador, financeiro, gerente de projeto, produtor e freelancer).

alter policy fornecedores_storage_delete on storage.objects
  using (
    bucket_id = 'fornecedores'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (select public.session_role()) = any (array[
      'administrador'::public.app_role, 'financeiro'::public.app_role
    ])
  );
