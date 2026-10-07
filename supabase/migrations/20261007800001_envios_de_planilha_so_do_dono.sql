-- Pasta de envios da importação de planilha: cada pessoa lê e apaga só o
-- arquivo que ela mesma subiu, e só quem importa sobe (Tiago, 07/10/2026).
--
-- Contexto: na decisão 110 o navegador passou a subir a planilha direto
-- para `orcamento-importacoes/<tenant>/envios/`, e o servidor a lê de lá
-- com a chave de serviço. Pela decisão 129, o arquivo é só de passagem: sai
-- quando a importação grava ou é cancelada, e o que escapa sai pela limpeza
-- de envios com mais de um dia.
--
-- As policies da task 004 liberavam ler e subir para qualquer membro do
-- tenant. Na prática, qualquer pessoa logada (inclusive freelancer e
-- financeiro) alcançava a planilha que outra estava importando, ou que
-- ficou esquecida, até de projeto que ela não enxerga pela RLS dos
-- orçamentos. E qualquer uma subia qualquer arquivo, de qualquer tamanho.
--
-- O que muda:
-- - SELECT: só o dono do arquivo (`owner_id`, gravado pelo Storage no
--   upload). O servidor lê com a chave de serviço e não depende disto.
-- - INSERT: só na pasta `envios` do tenant, e só para administrador, GP e
--   produtor, os papéis de `orcamentos.criar`/`orcamentos.editar` em
--   `lib/permissoes.ts`.
-- - DELETE (nova): só o dono. O "descartar" da tela passa a apagar com a
--   sessão de quem pediu, em vez da chave de serviço.
-- - O teto de 10 MB e o tipo .xlsx/.xlsm do bucket ficam na 20261007800002,
--   aplicada depois do deploy do código que manda o tipo pela extensão.
--
-- Troca policies que já existem, então é destrutiva pelo docs/FLUXO-BANCO.md.
-- Autorizada pelo Tiago em 07/10/2026.

drop policy if exists importacoes_storage_select on storage.objects;
create policy importacoes_storage_select on storage.objects
for select
to authenticated
using (
  bucket_id = 'orcamento-importacoes'
  and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
  and owner_id = (select auth.uid())::text
);

drop policy if exists importacoes_storage_insert on storage.objects;
create policy importacoes_storage_insert on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'orcamento-importacoes'
  and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
  and (storage.foldername(name))[2] = 'envios'
  and (select public.session_role()) in ('administrador', 'gerente_producao', 'produtor')
);

drop policy if exists importacoes_storage_delete on storage.objects;
create policy importacoes_storage_delete on storage.objects
for delete
to authenticated
using (
  bucket_id = 'orcamento-importacoes'
  and (storage.foldername(name))[1]::uuid in (select public.current_tenant_ids())
  and owner_id = (select auth.uid())::text
);
