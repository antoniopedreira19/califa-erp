-- A lista "Titular da verba" volta a mostrar só freela em atividade
-- (decisões 164 e 171).
--
-- O que aconteceu (19/10/2026): a migration `pessoas_para_verba_le_freelancers`
-- (16h24, aplicada pelo MCP e sem arquivo no repositório) trocou a origem dos
-- freelas da lista provisória `freelas` (69 ativos) para o cadastro do RH
-- `freelancers`, mas sem filtro de situação: os 221 freelas entravam na lista,
-- inclusive os 157 com o contrato encerrado. Foi assim que o titular da
-- PP-00127, com o contrato encerrado, pôde ser escolhido. O caso foi resolvido
-- pelo "Terceiro (fornecedor)" e o Tiago pediu a lista de volta ao normal.
--
-- A regra: o freela entra na lista se NÃO está "Encerrado" no módulo de
-- Freelancers (`freelancers_com_status.status_calculado`, a mesma situação que
-- a tela do módulo mostra). Em 19/10 isso dá 64 de 221 (todos "Sem minuta":
-- contrato vigente sem o documento assinado). Se o módulo mudar o que chama de
-- encerrado, a lista acompanha.
--
-- Colaboradores não mudam: já eram só os ativos do RH. Corpo da função igual
-- ao de 16h24, mais o filtro em `nome_pecas`.
--
-- Quem tem PP a emitir com um freela encerrado (hoje, só um teste no
-- TES-1025/26) recebe "O titular da verba não está mais na lista" ao salvar e
-- escolhe de novo. PP gerada não muda: o nome do titular fica gravado nela.

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
      -- Só quem não está "Encerrado" no módulo de Freelancers.
      AND NOT EXISTS (
        SELECT 1 FROM public.freelancers_com_status s
         WHERE s.id = f.id
           AND s.status_calculado = 'encerrado'
      )
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

REVOKE ALL ON FUNCTION public.pessoas_para_verba(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pessoas_para_verba(uuid) TO authenticated;
