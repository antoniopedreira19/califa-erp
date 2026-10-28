-- =====================================================================
-- Alocação multi-empresa: tabelas filhas + triggers de soma 100
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A regra de negócio evoluiu: um colaborador pode ser alocado em N empresas
-- simultaneamente (ex.: 60% California + 40% Hitlab), e dentro de cada
-- empresa pode haver divisão regional própria ou usar o rateio padrão da
-- empresa.
--
-- O modelo anterior de colaboradores_alocacoes tinha 1 empresa por pacote
-- (empresa_id NOT NULL na linha mãe). Esse modelo não suporta a divisão
-- multi-empresa.
--
-- Decisão de modelagem (brainstorm 2026-10-28): Opção B — pacote hierárquico.
--
--   • Pacote = colaboradores_alocacoes (quem, desde quando) — inalterado
--   • Itens  = colaboradores_alocacoes_itens — 1 linha por empresa, com %
--   • Regionais = colaboradores_alocacoes_itens_regionais — divisão regional
--     de cada item, quando usa_rateio_empresa = false
--
-- COLUNAS LEGADAS em colaboradores_alocacoes (empresa_id, regional_id,
-- usa_rateio_empresa): mantidas intactas nesta migration. Task 2 faz
-- backfill lendo-as. Tasks 7-8 migram os consumers. Cleanup posterior
-- remove as colunas antigas. Para pacotes novos criados durante a
-- transição, empresa_id e usa_rateio_empresa podem ser NULL — por isso
-- esta migration relaxa empresa_id para NULLABLE.
--
-- empresa_id NOT NULL e usa_rateio_empresa NOT NULL relaxados para NULL:
-- a restrição de integridade passa a viver nos itens (onde tem sentido),
-- e não na linha mãe que agrupa N empresas. Isso evita ter que escolher
-- 1 empresa "principal" arbitrária na linha mãe durante o período de
-- transição.
--
-- Ver: docs/superpowers/specs/2026-10-28-alocacao-multi-empresa-design.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Relaxar colunas legadas em colaboradores_alocacoes
--    empresa_id: era NOT NULL, passa a nullable (N empresas vivem nos itens)
--    usa_rateio_empresa: era NOT NULL, passa a nullable pelo mesmo motivo
-- ---------------------------------------------------------------------

ALTER TABLE public.colaboradores_alocacoes
  ALTER COLUMN empresa_id DROP NOT NULL;

COMMENT ON COLUMN public.colaboradores_alocacoes.empresa_id IS
  'LEGADO: empresa única do modelo anterior (1 empresa por pacote). NULL em pacotes novos multi-empresa. A referência real vive em colaboradores_alocacoes_itens. Remoção agendada para cleanup pós-estabilização.';

ALTER TABLE public.colaboradores_alocacoes
  ALTER COLUMN usa_rateio_empresa DROP NOT NULL;

COMMENT ON COLUMN public.colaboradores_alocacoes.usa_rateio_empresa IS
  'LEGADO: flag do modelo anterior (1 empresa por pacote). NULL em pacotes novos multi-empresa. A flag real vive em colaboradores_alocacoes_itens. Remoção agendada para cleanup pós-estabilização.';

-- ---------------------------------------------------------------------
-- 1) colaboradores_alocacoes_itens
--    Uma linha por empresa dentro de um pacote de alocação.
--    percentual_empresa: % do custo total do colaborador que vai pra essa empresa.
--    Soma de percentual_empresa por alocacao_id deve ser 100 — trigger.
-- ---------------------------------------------------------------------

CREATE TABLE public.colaboradores_alocacoes_itens (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  alocacao_id         uuid        NOT NULL REFERENCES public.colaboradores_alocacoes(id) ON DELETE CASCADE,
  empresa_id          uuid        NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  percentual_empresa  numeric(5,2) NOT NULL
                        CHECK (percentual_empresa > 0 AND percentual_empresa <= 100),
  usa_rateio_empresa  boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- Mesma empresa não aparece 2x no mesmo pacote
  CONSTRAINT uniq_alocacao_item_empresa UNIQUE (alocacao_id, empresa_id)
);

COMMENT ON TABLE public.colaboradores_alocacoes_itens IS
  'Fatia por empresa dentro de um pacote de alocação. Cada linha representa a % do custo total do colaborador que vai para aquela empresa. Soma de percentual_empresa por alocacao_id = 100 (trigger).';
COMMENT ON COLUMN public.colaboradores_alocacoes_itens.percentual_empresa IS
  'numeric(5,2): % do custo total do colaborador alocado nesta empresa. Soma de todas as linhas do mesmo alocacao_id deve ser exatamente 100.';
COMMENT ON COLUMN public.colaboradores_alocacoes_itens.usa_rateio_empresa IS
  'Se true, a divisão regional usa empresas_rateios_regionais (lista de regionais_item fica vazia). Se false, regionais_item deve ter linhas somando 100.';

-- Índices
CREATE INDEX idx_alocacoes_itens_alocacao
  ON public.colaboradores_alocacoes_itens (alocacao_id);

CREATE INDEX idx_alocacoes_itens_empresa
  ON public.colaboradores_alocacoes_itens (empresa_id);

CREATE INDEX idx_alocacoes_itens_tenant
  ON public.colaboradores_alocacoes_itens (tenant_id);

-- ---------------------------------------------------------------------
-- 2) colaboradores_alocacoes_itens_regionais
--    Divisão regional de um item (quando usa_rateio_empresa = false).
--    percentual_regional: % dentro daquela empresa que vai pra essa regional.
--    Soma de percentual_regional por alocacao_item_id deve ser 100 — trigger.
--    Quando usa_rateio_empresa = true, a tabela fica vazia (trigger BEFORE bloqueia insert).
-- ---------------------------------------------------------------------

CREATE TABLE public.colaboradores_alocacoes_itens_regionais (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  alocacao_item_id    uuid        NOT NULL REFERENCES public.colaboradores_alocacoes_itens(id) ON DELETE CASCADE,
  regional_id         uuid        NOT NULL REFERENCES public.regionais(id) ON DELETE RESTRICT,
  percentual_regional numeric(5,2) NOT NULL
                        CHECK (percentual_regional > 0 AND percentual_regional <= 100),
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- Mesma regional não aparece 2x no mesmo item
  CONSTRAINT uniq_alocacao_item_regional UNIQUE (alocacao_item_id, regional_id)
);

COMMENT ON TABLE public.colaboradores_alocacoes_itens_regionais IS
  'Divisão regional de um item de alocação. Só relevante quando usa_rateio_empresa = false no item pai. Soma de percentual_regional por alocacao_item_id = 100 (trigger). Quando o item usa rateio padrão, esta tabela fica vazia.';
COMMENT ON COLUMN public.colaboradores_alocacoes_itens_regionais.percentual_regional IS
  'numeric(5,2): % do custo do item (empresa) alocado nesta regional. Soma de todas as linhas do mesmo alocacao_item_id deve ser exatamente 100.';

-- Índices
CREATE INDEX idx_alocacoes_item_regionais_item
  ON public.colaboradores_alocacoes_itens_regionais (alocacao_item_id);

CREATE INDEX idx_alocacoes_item_regionais_regional
  ON public.colaboradores_alocacoes_itens_regionais (regional_id);

CREATE INDEX idx_alocacoes_item_regionais_tenant
  ON public.colaboradores_alocacoes_itens_regionais (tenant_id);

-- ---------------------------------------------------------------------
-- 3) Trigger: soma dos % das empresas num pacote = 100
--    Modelo: CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED
--    (mesmo padrão de enforce_rateio_empresa_soma_100 e enforce_rateio_soma_100_avulsa).
--    Aceitamos soma=0 (pacote vazio = inválido pra folha, mas aceito em banco
--    — a geração da folha já trata esse caso com motivo "sem alocação").
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_alocacao_itens_soma_100()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_alocacao_id  uuid;
  v_soma         numeric(10,2);
BEGIN
  -- Para DELETE, usa o alocacao_id da linha removida
  v_alocacao_id := COALESCE(NEW.alocacao_id, OLD.alocacao_id);

  SELECT COALESCE(SUM(percentual_empresa), 0) INTO v_soma
  FROM public.colaboradores_alocacoes_itens
  WHERE alocacao_id = v_alocacao_id;

  -- Aceita soma=0 (pacote sem itens); se houver itens, soma deve ser 100
  IF v_soma > 0 AND abs(v_soma - 100.00) >= 0.01 THEN
    RAISE EXCEPTION
      'enforce_alocacao_itens_soma_100: pacote % tem soma de percentual_empresa = %, deve ser exatamente 100.',
      v_alocacao_id, v_soma
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_alocacao_itens_soma_100() IS
  'Valida que a soma de percentual_empresa de todos os itens de um pacote (alocacao_id) é exatamente 100 (ou 0 se vazio). Disparada por constraint trigger DEFERRABLE INITIALLY DEFERRED em colaboradores_alocacoes_itens.';

-- Revogar execução pública (Supabase advisor lint 0028/0029)
REVOKE EXECUTE ON FUNCTION public.enforce_alocacao_itens_soma_100()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_alocacao_itens_soma_100
  ON public.colaboradores_alocacoes_itens;

CREATE CONSTRAINT TRIGGER trg_alocacao_itens_soma_100
  AFTER INSERT OR UPDATE OR DELETE
  ON public.colaboradores_alocacoes_itens
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_alocacao_itens_soma_100();

-- ---------------------------------------------------------------------
-- 4) Trigger: soma dos % das regionais num item = 100
--    Só valida quando usa_rateio_empresa = false no item pai.
--    Quando usa_rateio_empresa = true, a lista vazia é válida.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_alocacao_item_regionais_soma_100()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id          uuid;
  v_usa_rateio       boolean;
  v_soma             numeric(10,2);
BEGIN
  v_item_id := COALESCE(NEW.alocacao_item_id, OLD.alocacao_item_id);

  -- Verificar flag do item pai
  SELECT usa_rateio_empresa INTO v_usa_rateio
  FROM public.colaboradores_alocacoes_itens
  WHERE id = v_item_id;

  -- Se usa rateio padrão, lista de regionais deve estar vazia (outro trigger
  -- bloqueia insert), então aqui não há nada pra validar
  IF v_usa_rateio IS TRUE THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(percentual_regional), 0) INTO v_soma
  FROM public.colaboradores_alocacoes_itens_regionais
  WHERE alocacao_item_id = v_item_id;

  -- Quando usa_rateio_empresa = false: lista deve existir e somar 100
  IF v_soma > 0 AND abs(v_soma - 100.00) >= 0.01 THEN
    RAISE EXCEPTION
      'enforce_alocacao_item_regionais_soma_100: item % tem soma de percentual_regional = %, deve ser exatamente 100.',
      v_item_id, v_soma
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_alocacao_item_regionais_soma_100() IS
  'Valida que a soma de percentual_regional das regionais de um item é 100 (ou 0 se vazio), quando usa_rateio_empresa = false. Quando usa_rateio_empresa = true, ignora (lista deve estar vazia). Disparada por constraint trigger DEFERRABLE INITIALLY DEFERRED.';

REVOKE EXECUTE ON FUNCTION public.enforce_alocacao_item_regionais_soma_100()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_alocacao_item_regionais_soma_100
  ON public.colaboradores_alocacoes_itens_regionais;

CREATE CONSTRAINT TRIGGER trg_alocacao_item_regionais_soma_100
  AFTER INSERT OR UPDATE OR DELETE
  ON public.colaboradores_alocacoes_itens_regionais
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_alocacao_item_regionais_soma_100();

-- ---------------------------------------------------------------------
-- 5) Trigger BEFORE INSERT: bloqueia inserção de regional quando
--    o item pai tem usa_rateio_empresa = true
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_alocacao_item_regional_vazia_quando_rateio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_usa_rateio boolean;
BEGIN
  SELECT usa_rateio_empresa INTO v_usa_rateio
  FROM public.colaboradores_alocacoes_itens
  WHERE id = NEW.alocacao_item_id;

  IF v_usa_rateio IS TRUE THEN
    RAISE EXCEPTION
      'enforce_alocacao_item_regional_vazia_quando_rateio: item % usa rateio padrão da empresa — não é permitido adicionar regionais específicas.',
      NEW.alocacao_item_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_alocacao_item_regional_vazia_quando_rateio() IS
  'Bloqueia INSERT em colaboradores_alocacoes_itens_regionais quando o item pai tem usa_rateio_empresa = true. Um item usa rateio padrão OU regionais específicas, nunca os dois.';

REVOKE EXECUTE ON FUNCTION public.enforce_alocacao_item_regional_vazia_quando_rateio()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_alocacao_item_regional_vazia_quando_rateio
  ON public.colaboradores_alocacoes_itens_regionais;

CREATE TRIGGER trg_alocacao_item_regional_vazia_quando_rateio
  BEFORE INSERT
  ON public.colaboradores_alocacoes_itens_regionais
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_alocacao_item_regional_vazia_quando_rateio();

-- ---------------------------------------------------------------------
-- 6) RLS — colaboradores_alocacoes_itens
--    Mesmo padrão de colaboradores_alocacoes: admin OR rh
-- ---------------------------------------------------------------------

ALTER TABLE public.colaboradores_alocacoes_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY alocacoes_itens_select ON public.colaboradores_alocacoes_itens
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id)
  );

CREATE POLICY alocacoes_itens_insert ON public.colaboradores_alocacoes_itens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id)
  );

CREATE POLICY alocacoes_itens_update ON public.colaboradores_alocacoes_itens
  FOR UPDATE TO authenticated
  USING  (public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id));

CREATE POLICY alocacoes_itens_delete ON public.colaboradores_alocacoes_itens
  FOR DELETE TO authenticated
  USING (
    public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.colaboradores_alocacoes_itens
  TO authenticated;

-- ---------------------------------------------------------------------
-- 7) RLS — colaboradores_alocacoes_itens_regionais
--    Mesmo padrão: admin OR rh
-- ---------------------------------------------------------------------

ALTER TABLE public.colaboradores_alocacoes_itens_regionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY alocacoes_item_regionais_select ON public.colaboradores_alocacoes_itens_regionais
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id)
  );

CREATE POLICY alocacoes_item_regionais_insert ON public.colaboradores_alocacoes_itens_regionais
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id)
  );

CREATE POLICY alocacoes_item_regionais_update ON public.colaboradores_alocacoes_itens_regionais
  FOR UPDATE TO authenticated
  USING  (public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id));

CREATE POLICY alocacoes_item_regionais_delete ON public.colaboradores_alocacoes_itens_regionais
  FOR DELETE TO authenticated
  USING (
    public.is_tenant_admin(tenant_id) OR public.is_tenant_rh(tenant_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.colaboradores_alocacoes_itens_regionais
  TO authenticated;
