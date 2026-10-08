-- Cache de leitura de NF por IA. Chave: (tenant_id, hash_sha256 do arquivo, modelo).
-- Modelo fica guardado pra permitir trocar sem ler cache stale (SELECT filtra
-- por modelo). Imutável: sem UPDATE/DELETE; invalidar = DROP + recria.
-- Spec: docs/superpowers/specs/2026-10-08-ler-nf-por-ia.md (D9)

CREATE TABLE public.nf_extracao_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hash_sha256 text NOT NULL CHECK (char_length(hash_sha256) = 64),
  dados       jsonb NOT NULL,
  modelo      text NOT NULL,
  extraido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, hash_sha256, modelo)
);

CREATE INDEX nf_extracao_cache_tenant_hash_modelo_idx
  ON public.nf_extracao_cache (tenant_id, hash_sha256, modelo);

ALTER TABLE public.nf_extracao_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY nf_extracao_cache_select ON public.nf_extracao_cache
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY nf_extracao_cache_insert ON public.nf_extracao_cache
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

GRANT SELECT, INSERT ON public.nf_extracao_cache TO authenticated;
