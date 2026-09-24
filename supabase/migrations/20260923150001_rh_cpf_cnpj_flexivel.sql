-- =====================================================================
-- Relaxa a constraint chk_colaboradores_cpf_cnpj_formato:
-- aceita CPF (11 dig) OU CNPJ (14 dig) em QUALQUER tipo de contratação,
-- incluindo 'socio' que foi adicionado ao enum em 20260923140001.
--
-- Contexto: import do quadro real da Kika (2026-09-23) — a coluna do CSV é
-- CPF da pessoa (mesmo pros PJs), não CNPJ da razão social. Tratar CPF
-- como pendência bloqueia a inserção. Relaxar aqui + tratar CPF ausente
-- como pendência derivada resolve.
-- =====================================================================

alter table public.colaboradores
  drop constraint if exists chk_colaboradores_cpf_cnpj_formato;

alter table public.colaboradores
  add constraint chk_colaboradores_cpf_cnpj_formato
  check (
    cpf_cnpj is null
    or cpf_cnpj ~ '^[0-9]{11}$'
    or cpf_cnpj ~ '^[0-9]{14}$'
  );
