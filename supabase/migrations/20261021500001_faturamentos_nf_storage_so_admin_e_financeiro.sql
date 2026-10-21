-- O PDF da NF emitida (bucket `faturamentos-nf`) passa a ser só de
-- administrador e financeiro: abrir, anexar e apagar.
--
-- Por quê: desde a Task 016 (13/08/2026) as três policies do bucket pediam
-- só que a pessoa fosse membro do tenant. A tela esconde a NF de quem não é
-- do financeiro, mas o banco não: em 19/10/2026, simulando `authenticated`
-- (`begin read only` + `set local role`), RH, gerente de projeto, produtor e
-- freelancer listavam os 20 PDFs do bucket e, pela mesma regra, podiam
-- anexar e apagar. Bastava o login e o console do navegador, sem passar por
-- tela nenhuma. Eram 87 pessoas ativas sem o menu Financeiro.
--
-- Quem usa o arquivo no código (todos com o cliente do usuário):
--   - `uploadNfPdf` (Contas a Receber › Faturar): trava admin e financeiro.
--   - `urlAnexoNf` (Contas a Receber › nota emitida): `checarGateFinanceiro`.
--   - `abrirDocumentoDoLancamento` (Conciliação): a página só abre para
--     admin e financeiro.
-- Nenhuma tela do job abre o PDF da NF, e nada no código apaga do bucket.
-- Por isso a regra nova não muda nenhuma tela.
--
-- Regra nova: a mesma do bucket `impostos` (guias do fiscal),
-- `is_tenant_admin` OU `is_tenant_financeiro` do tenant da pasta, com o
-- `tenant_do_caminho_no_storage` da 20261019900002 (pasta fora do padrão
-- fica invisível em vez de dar erro). `alter policy` mantém nome, comando,
-- papel (`authenticated`) e o tipo permissivo; só a expressão muda.
--
-- Mudança destrutiva (restringe acesso que existia), autorizada pelo Tiago
-- em 21/10/2026. O bucket nasceu na frente do Antonio (Task 016); o código
-- que o usa hoje é do Contas a Receber.
--
-- Fica de fora, de propósito:
--   - A tabela `faturamentos` (Task 016): número e valor das notas continuam
--     visíveis a quem tem acesso à empresa. É outra decisão.
--   - Os buckets `fornecedores` (declaração do Simples) e
--     `envios-faturamento` (anexo da PO): aguardam a escolha do Tiago.

alter policy faturamentos_storage_select on storage.objects
  using (
    bucket_id = 'faturamentos-nf'
    and (
      coalesce(public.is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(public.is_tenant_financeiro(public.tenant_do_caminho_no_storage(name)), false)
    )
  );

alter policy faturamentos_storage_insert on storage.objects
  with check (
    bucket_id = 'faturamentos-nf'
    and (
      coalesce(public.is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(public.is_tenant_financeiro(public.tenant_do_caminho_no_storage(name)), false)
    )
  );

alter policy faturamentos_storage_delete on storage.objects
  using (
    bucket_id = 'faturamentos-nf'
    and (
      coalesce(public.is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(public.is_tenant_financeiro(public.tenant_do_caminho_no_storage(name)), false)
    )
  );
