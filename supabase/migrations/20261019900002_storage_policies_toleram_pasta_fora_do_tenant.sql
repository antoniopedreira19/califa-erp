-- Mais seis buckets deixam de quebrar com pasta que não é tenant.
--
-- Continuação da 20261019900001 (pedidos-compra). Em 19/10/2026 uma pasta
-- fora do padrão (`_antes-da-decisao-190/`) no bucket das PPs derrubou toda
-- listagem do bucket: a policy fazia `split_part(name, '/', 1)::uuid` direto
-- e, numa listagem, o Postgres avalia a policy em todas as linhas do bucket
-- antes do filtro de prefixo. O cast da pasta estranha estourava para
-- qualquer usuário logado.
--
-- Estes seis buckets tinham o mesmo cast cru:
--   impostos              guias da apuração e impostos a pagar (Fiscal)
--   fornecedores          declaração do Simples do fornecedor (Fiscal)
--   envios-faturamento    anexos do envio do job para faturamento (123)
--   orcamento-importacoes planilha importada, pasta `envios` (Orçamentos)
--   faturamentos-nf       PDF da NF emitida (Contas a Receber)
--   contas-avulsas        anexos da conta avulsa (Contas a Pagar)
-- Em 19/10 nenhum deles tinha pasta fora de `<tenant_id>/` na raiz: é
-- prevenção, nada estava quebrado.
--
-- A regra de acesso de cada policy fica IDÊNTICA. Só o cast troca por
-- `public.tenant_do_caminho_no_storage`, que devolve NULL quando o segmento
-- não tem formato de uuid (criada na 20261019900001). `alter policy` mantém
-- nome, comando, papel (`authenticated`) e o tipo permissivo; só a expressão
-- muda.
--   - `split_part(name, '/', 1)::uuid` vira
--     `public.tenant_do_caminho_no_storage(name)`.
--   - `(storage.foldername(name))[1]::uuid` (orcamento-importacoes) vira
--     `public.tenant_do_caminho_no_storage((storage.foldername(name))[1])`:
--     o segmento é o mesmo, inclusive para arquivo solto na raiz, em que o
--     `foldername` dá NULL.
--   - `coalesce(..., false)` em volta das funções `is_tenant_*`, como na
--     20261019900001. Elas já devolvem false para NULL (`exists`); o
--     coalesce deixa a intenção explícita.
-- Antes de aplicar, as expressões antigas e novas foram comparadas caminho a
-- caminho nos 486 objetos com pasta de tenant (todos os buckets), como
-- administrador, financeiro, produtor dono de importação e freelancer: zero
-- diferenças.
--
-- Ficaram de fora, de propósito, os buckets de outra frente
-- (colaboradores-nf, contratacoes-anexos e freelancer-arquivos): continuam
-- com o cast direto.

-- contas-avulsas
alter policy avulsas_storage_select on storage.objects
  using (
    bucket_id = 'contas-avulsas'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy avulsas_storage_insert on storage.objects
  with check (
    bucket_id = 'contas-avulsas'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy avulsas_storage_delete on storage.objects
  using (
    bucket_id = 'contas-avulsas'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

-- envios-faturamento
alter policy envios_faturamento_storage_select on storage.objects
  using (
    bucket_id = 'envios-faturamento'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy envios_faturamento_storage_insert on storage.objects
  with check (
    bucket_id = 'envios-faturamento'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy envios_faturamento_storage_delete on storage.objects
  using (
    bucket_id = 'envios-faturamento'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

-- faturamentos-nf
alter policy faturamentos_storage_select on storage.objects
  using (
    bucket_id = 'faturamentos-nf'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy faturamentos_storage_insert on storage.objects
  with check (
    bucket_id = 'faturamentos-nf'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy faturamentos_storage_delete on storage.objects
  using (
    bucket_id = 'faturamentos-nf'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

-- fornecedores
alter policy fornecedores_storage_select on storage.objects
  using (
    bucket_id = 'fornecedores'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy fornecedores_storage_insert on storage.objects
  with check (
    bucket_id = 'fornecedores'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

alter policy fornecedores_storage_delete on storage.objects
  using (
    bucket_id = 'fornecedores'
    and coalesce(public.is_tenant_member(public.tenant_do_caminho_no_storage(name)), false)
  );

-- impostos
alter policy impostos_storage_select on storage.objects
  using (
    bucket_id = 'impostos'
    and (
      coalesce(public.is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(public.is_tenant_financeiro(public.tenant_do_caminho_no_storage(name)), false)
    )
  );

alter policy impostos_storage_insert on storage.objects
  with check (
    bucket_id = 'impostos'
    and (
      coalesce(public.is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(public.is_tenant_financeiro(public.tenant_do_caminho_no_storage(name)), false)
    )
  );

alter policy impostos_storage_delete on storage.objects
  using (
    bucket_id = 'impostos'
    and (
      coalesce(public.is_tenant_admin(public.tenant_do_caminho_no_storage(name)), false)
      or coalesce(public.is_tenant_financeiro(public.tenant_do_caminho_no_storage(name)), false)
    )
  );

-- orcamento-importacoes (regra da 20261007800001: só o dono lê e apaga)
alter policy importacoes_storage_select on storage.objects
  using (
    bucket_id = 'orcamento-importacoes'
    and public.tenant_do_caminho_no_storage((storage.foldername(name))[1]) in (select public.current_tenant_ids())
    and owner_id = (select auth.uid())::text
  );

alter policy importacoes_storage_insert on storage.objects
  with check (
    bucket_id = 'orcamento-importacoes'
    and public.tenant_do_caminho_no_storage((storage.foldername(name))[1]) in (select public.current_tenant_ids())
    and (storage.foldername(name))[2] = 'envios'
    and (select public.session_role()) in ('administrador', 'gerente_producao', 'produtor')
  );

alter policy importacoes_storage_delete on storage.objects
  using (
    bucket_id = 'orcamento-importacoes'
    and public.tenant_do_caminho_no_storage((storage.foldername(name))[1]) in (select public.current_tenant_ids())
    and owner_id = (select auth.uid())::text
  );
