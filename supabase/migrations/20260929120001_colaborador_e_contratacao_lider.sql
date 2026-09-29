-- =====================================================================
-- RH — colaborador e contratacao ganham lider_id
-- =====================================================================
--
-- Decisão travada em 2026-09-29 com o Antonio: toda contratação (e todo
-- colaborador) pode ter um líder direto. É opcional — pode ser
-- preenchido no ato ou depois. O líder é qualquer usuário do sistema
-- (profile) — sem restrição de role. Se o líder sair (profile deleted),
-- o campo vira null via ON DELETE SET NULL, mas o colaborador continua
-- ativo.
--
-- Ao efetivar uma contratação, o lider_id copia da contratação pro
-- colaborador (junto com os outros dados que já migram).
-- =====================================================================

alter table public.colaboradores
  add column if not exists lider_id uuid references public.profiles(id) on delete set null;

alter table public.contratacoes
  add column if not exists lider_id uuid references public.profiles(id) on delete set null;

comment on column public.colaboradores.lider_id is
  'Líder direto do colaborador — qualquer profile do sistema. Opcional, ON DELETE SET NULL. Copiado da contratação quando efetiva; editável depois pelo drawer de dados.';
comment on column public.contratacoes.lider_id is
  'Líder direto previsto pro candidato. Definido pelo RH na criação; migra pro colaborador na efetivação.';
