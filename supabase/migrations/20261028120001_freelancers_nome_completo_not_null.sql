-- Freelancers: nome_completo passa a ser obrigatório.
--
-- Por quê:
--   A lista mostrava apenas apelidos ("Nat", "Tata", "Diego Couto") porque o
--   formulário só exigia nome_social. Nome completo é indispensável para
--   contrato, recibo, PIX de pessoa física e cruzamento com o RG. Travar
--   no banco garante a invariante mesmo quando algum caminho de escrita
--   escapar da validação Zod no app.
--
-- Dado atual: 224 freelancers, todos com nome_completo preenchido.
-- Checado antes da aplicação: sem_nome_completo = 0 → NOT NULL é seguro.
--
-- Mudança: aditiva do ponto de vista de dados (nenhuma linha é alterada)
-- mas estrutural (adiciona constraint). Combinada com o Zod no mesmo
-- commit para que o formulário e o banco falem a mesma coisa.

ALTER TABLE public.freelancers
  ALTER COLUMN nome_completo SET NOT NULL;

COMMENT ON COLUMN public.freelancers.nome_completo IS
  'Nome oficial do RG, com sobrenome. Obrigatório desde 2026-10-28.';
