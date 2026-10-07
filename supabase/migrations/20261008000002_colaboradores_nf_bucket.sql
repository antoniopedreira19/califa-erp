-- Bucket privado para NFs de colaboradores PJ.
-- Path: {tenant_id}/{colaborador_id}/{ano}-{mes}.pdf
-- Padrão idêntico ao bucket 'pedidos-compra' (split_part no primeiro nível
-- da path dá o tenant_id para a policy).
-- Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D5 + "Storage")

INSERT INTO storage.buckets (id, name, public)
VALUES ('colaboradores-nf', 'colaboradores-nf', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY nf_bucket_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY nf_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY nf_bucket_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  )
  WITH CHECK (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY nf_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'colaboradores-nf'
    AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );
