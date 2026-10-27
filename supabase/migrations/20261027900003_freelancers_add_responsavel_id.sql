-- Adiciona `responsavel_id` em `freelancers`: o "dono da relação com a pessoa",
-- separado do responsavel por contrato (`freelancer_contratos.responsavel_id`).
--
-- Por quê: o modelo atual (responsavel só no contrato) tem 3 buracos operacionais:
--   1. Freela cadastrado sem contrato → sem dono, invisível pra qualquer GP
--   2. Freela com todos contratos encerrados → zumbi, some do radar do GP
--   3. Semanticamente "quem gerencia a pessoa" vs "quem gerencia o contrato"
--      são conceitos diferentes — o antigo (AgCaliforniaRH) tinha ambos.
--
-- Decisão: manter os dois campos (ADR a documentar). `freelancers.responsavel_id`
-- é o dono "default"; `freelancer_contratos.responsavel_id` pode diferir caso o
-- GP empreste o freela pra outro responsável num job específico. A lista de
-- freelancers filtra pelo campo da `freelancers` (visibilidade estável). A
-- coluna RESP. da tabela mostra o do contrato ativo (contexto operacional).
--
-- Mudança aditiva: coluna nullable + FK + índice. Backfill vem na migration
-- seguinte (20261027900004) pra separar schema de dados.

begin;

alter table public.freelancers
  add column responsavel_id uuid references public.profiles(id) on delete set null;

create index idx_freelancers_responsavel on public.freelancers(responsavel_id);

comment on column public.freelancers.responsavel_id is
  'Dono da relação com o freelancer (GP/produtor). Separado do responsavel '
  'por contrato — ver ADR correspondente. Backfill feito na migration '
  '20261027900004 a partir do contrato mais relevante.';

commit;
