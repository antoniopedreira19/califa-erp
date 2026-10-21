-- Declaração do Simples (bucket `fornecedores`) e anexo da PO no envio para
-- faturamento (bucket `envios-faturamento`) passam a olhar o papel de quem
-- pede, e não só se a pessoa é do tenant.
--
-- Por quê: as policies dos dois buckets pediam só `is_tenant_member` para
-- abrir, anexar E apagar. Em 19/10/2026, simulando `authenticated`, qualquer
-- papel (inclusive o RH, que não tem tela para nenhum dos dois) listava,
-- anexava e podia apagar, até a PO já enviada ao financeiro. Bastava o login
-- e o console do navegador. É a continuação da 20261021500001 (PDF da NF).
--
-- Regras decididas pelo Tiago em 21/10/2026:
--
-- Declaração do Simples (`fornecedores`):
--   - Abrir e anexar: quem cadastra fornecedor. Administrador e financeiro
--     pela ficha (`cadastros.fornecedores.editar`); gerente de projeto,
--     produtor e freelancer pelo cadastro rápido e pelo lápis da PP
--     (`cadastros.fornecedores.inline`). Fica de fora o RH. A trava do
--     servidor (`reservarArquivoDaDeclaracao`) já aceita esses cinco papéis.
--   - Apagar: administrador e financeiro. O formulário apaga o arquivo que
--     subiu e não foi salvo (o ✕ antes de salvar, ou fechar sem salvar), com
--     o cliente de quem anexou: por isso quem é da produção apaga só o
--     arquivo que ELE subiu e que nenhum fornecedor aponta. Declaração salva
--     num fornecedor só sai por administrador ou financeiro.
--
-- Anexo da PO (`envios-faturamento`):
--   - Abrir: continua com qualquer membro do tenant. O "Ver envio" do job
--     aparece para todo papel que abre o job, e o Contas a Receber mostra o
--     anexo ao financeiro.
--   - Anexar: só quem envia o job para faturamento, administrador e gerente
--     de projeto (`jobs.enviar_faturamento`).
--   - Apagar: os mesmos, e só enquanto nenhum envio aponta o arquivo (o ✕ do
--     formulário antes de enviar). Depois do envio, ninguém apaga: a PO é o
--     documento que o financeiro usa para emitir a nota.
--
-- O papel vem de `public.session_role()`, como nas outras 39 policies do
-- banco que olham papel; `is_tenant_member` continua conferindo o tenant da
-- pasta e o perfil ativo, e `tenant_do_caminho_no_storage` (20261019900002)
-- deixa invisível a pasta fora do padrão. "Arquivo apontado" se lê na tabela
-- dona do caminho (`fornecedores.declaracao_simples_path`,
-- `jobs_envio_faturamento_anexos.path`, que tem índice único); quem apaga é
-- membro do tenant e vê as duas tabelas inteiras pela RLS delas.
-- `alter policy` mantém nome, comando, papel (`authenticated`) e o tipo
-- permissivo; só a expressão muda.
--
-- Mudança destrutiva (restringe acesso que existia), autorizada pelo Tiago
-- em 21/10/2026. Os dois buckets são da frente do Tiago (decisões 142 e 123).

-- Declaração do Simples ------------------------------------------------------

alter policy fornecedores_storage_select on storage.objects
  using (
    bucket_id = 'fornecedores'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (select public.session_role()) = any (array[
      'administrador'::public.app_role, 'financeiro'::public.app_role,
      'gerente_producao'::public.app_role, 'produtor'::public.app_role,
      'freelancer'::public.app_role
    ])
  );

alter policy fornecedores_storage_insert on storage.objects
  with check (
    bucket_id = 'fornecedores'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (select public.session_role()) = any (array[
      'administrador'::public.app_role, 'financeiro'::public.app_role,
      'gerente_producao'::public.app_role, 'produtor'::public.app_role,
      'freelancer'::public.app_role
    ])
  );

alter policy fornecedores_storage_delete on storage.objects
  using (
    bucket_id = 'fornecedores'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (
      (select public.session_role()) = any (array[
        'administrador'::public.app_role, 'financeiro'::public.app_role
      ])
      or (
        (select public.session_role()) = any (array[
          'gerente_producao'::public.app_role, 'produtor'::public.app_role,
          'freelancer'::public.app_role
        ])
        and owner_id = (select auth.uid())::text
        and not exists (
          select 1 from public.fornecedores f
          where f.declaracao_simples_path = storage.objects.name
        )
      )
    )
  );

-- Anexo da PO -----------------------------------------------------------------
-- O SELECT (`envios_faturamento_storage_select`) fica como está: membro do
-- tenant da pasta.

alter policy envios_faturamento_storage_insert on storage.objects
  with check (
    bucket_id = 'envios-faturamento'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (select public.session_role()) = any (array[
      'administrador'::public.app_role, 'gerente_producao'::public.app_role
    ])
  );

alter policy envios_faturamento_storage_delete on storage.objects
  using (
    bucket_id = 'envios-faturamento'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
    and (select public.session_role()) = any (array[
      'administrador'::public.app_role, 'gerente_producao'::public.app_role
    ])
    and not exists (
      select 1 from public.jobs_envio_faturamento_anexos a
      where a.path = storage.objects.name
    )
  );
