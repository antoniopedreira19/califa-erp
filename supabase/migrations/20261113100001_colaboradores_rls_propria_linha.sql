-- Adiciona policy PERMISSIVE de SELECT em colaboradores: o proprio dono do
-- registro (user_id = auth.uid()) pode ler a propria linha.
--
-- Motivo: a role 'colaborador' nao e admin nem rh, entao a policy
-- colaboradores_select existente (admin OR rh) barra a leitura da propria
-- linha e a tela /perfil cai no branch "Seu login ainda nao esta vinculado"
-- apesar de colaboradores.user_id estar corretamente preenchido.
--
-- Combinacao de policies: as duas policies SELECT em colaboradores sao
-- PERMISSIVE, logo o Postgres aplica OR entre elas. admin/rh seguem lendo
-- todos os registros; colaborador comum passa a ler apenas a propria linha.
--
-- Nao altera INSERT nem UPDATE: somente admin/rh podem criar ou editar
-- cadastro de colaborador, como antes.

CREATE POLICY colaboradores_select_propria_linha
ON public.colaboradores
FOR SELECT
TO authenticated
USING (user_id = (select auth.uid()));
