-- Migration: pessoas_para_verba lê freelancers (nova tabela do módulo /freelancers)
-- em vez de freelas (lista provisória). Zero mudança no código do app: mesma
-- assinatura, mesmo tipo de retorno, mesmo valor de origem ('freela').
--
-- Decisões (19/10/2026):
-- - Nome exibido = primeira palavra + última palavra "real" de nome_completo
--   (fallback nome_social), ignorando preposições (de/da/do/dos/das/e) e
--   sufixos (filho/filha/junior/jr/neto/neta/sobrinho/sobrinha).
-- - Sem filtro de status: encerrados aparecem.
-- - Dedup contra colaboradores por CPF continua.
-- - freelas (velha) fica no banco mas sem ser lida; dropamos depois.

CREATE OR REPLACE FUNCTION public.pessoas_para_verba(p_tenant_id uuid)
RETURNS TABLE(id uuid, origem text, nome text, funcao text, detalhe text, busca text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH quem AS (
    SELECT tm.role::text AS papel
      FROM public.tenant_members tm
      JOIN public.profiles p ON p.id = tm.user_id
     WHERE tm.user_id = (SELECT auth.uid())
       AND tm.tenant_id = p_tenant_id
       AND tm.status = 'ativo'
       AND p.ativo
  ),
  nome_pecas AS (
    SELECT
      f.id, f.cpf, f.cidade,
      coalesce(nullif(trim(f.nome_completo), ''), f.nome_social) AS nome_cheio,
      (
        SELECT array_agg(parte ORDER BY ord)
          FROM unnest(regexp_split_to_array(
            trim(coalesce(nullif(f.nome_completo, ''), f.nome_social, '')), '\s+'
          )) WITH ORDINALITY AS t(parte, ord)
         WHERE parte <> ''
           AND upper(parte) NOT IN (
             'DE','DA','DO','DOS','DAS','E',
             'FILHO','FILHA','JUNIOR','JR','NETO','NETA','SOBRINHO','SOBRINHA'
           )
      ) AS pecas
    FROM public.freelancers f
    WHERE f.tenant_id = p_tenant_id
  )
  SELECT c.id, 'colaborador'::text, c.nome, c.funcao, c.tipo_contratacao::text, NULL::text
    FROM public.colaboradores c
   WHERE c.tenant_id = p_tenant_id
     AND c.status = 'ativo'
     AND EXISTS (SELECT 1 FROM quem WHERE papel IN ('administrador','gerente_producao','produtor','freelancer'))
  UNION ALL
  SELECT
    np.id,
    'freela'::text,
    CASE
      WHEN np.pecas IS NULL OR array_length(np.pecas, 1) IS NULL THEN np.nome_cheio
      WHEN array_length(np.pecas, 1) = 1 THEN np.pecas[1]
      ELSE np.pecas[1] || ' ' || np.pecas[array_length(np.pecas, 1)]
    END AS nome,
    (
      SELECT c.cargo
        FROM public.freelancer_contratos c
       WHERE c.freelancer_id = np.id AND c.tenant_id = p_tenant_id
       ORDER BY
         CASE
           WHEN c.status_real AND c.data_inicio <= CURRENT_DATE AND c.data_termino >= CURRENT_DATE THEN 1
           WHEN c.status_real AND c.data_inicio > CURRENT_DATE THEN 2
           ELSE 3
         END,
         c.data_inicio DESC NULLS LAST,
         c.created_at DESC
       LIMIT 1
    ) AS funcao,
    np.cidade AS detalhe,
    np.nome_cheio AS busca
    FROM nome_pecas np
   WHERE EXISTS (SELECT 1 FROM quem WHERE papel IN ('administrador','gerente_producao','produtor','freelancer'))
     AND NOT EXISTS (
       SELECT 1 FROM public.colaboradores c
        WHERE c.tenant_id = p_tenant_id
          AND c.status = 'ativo'
          AND np.cpf IS NOT NULL
          AND regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = np.cpf
     );
$function$;
