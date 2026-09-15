-- ===========================================================================
-- A prestação de contas da verba passa para a produção e ganha aprovação
-- ===========================================================================
-- Decisão 081 (Tiago, 14–15/09/2026 — alinhado com o Antonio, que desenhou
-- a verba em 26/08/2026).
--
-- Antes: o financeiro fechava a prestação de uma vez — valor gasto
-- digitado, anexos soltos, prestação imutável — e a devolução nascia no
-- mesmo instante, com a data do dia.
--
-- Agora: a produção envia (cada documento com o seu valor, e o gasto é a
-- soma), o financeiro aprova ou reprova com motivo, e só a aprovação cria o
-- estorno do saldo. Reprovada, a prestação volta a ser editável pela
-- produção; aprovada, fica imutável como antes.
--
-- Esta migration é só estrutura. As funções que escrevem estão na 150002;
-- por isso as policies de INSERT direto saem daqui — quem grava prestação
-- e documento passa a ser só a função, que checa quem pode e o valor.
--
-- `fechada_em` / `fechada_por` ficam com o nome e passam a significar
-- "enviada (a última vez) / por quem". Renomear coluna em uso seria
-- destrutivo à toa.
--
-- ⚠️ Supõe as três tabelas vazias — conferido em 15/09/2026: nenhuma
-- prestação, documento ou devolução. O bloco abaixo recusa rodar se isso
-- tiver mudado, porque `valor` e `documento_tipo` passam a NOT NULL.

do $$
begin
  if exists (select 1 from public.pp_verba_prestacoes)
     or exists (select 1 from public.pp_verba_prestacoes_anexos)
     or exists (select 1 from public.pp_verba_devolucoes) then
    raise exception 'Há prestação, documento ou devolução gravados: esta migration supõe as tabelas vazias (conferido em 15/09/2026). Revise antes de aplicar.';
  end if;
end $$;

create type public.pp_verba_prestacao_status as enum (
  'em_avaliacao',
  'reprovada',
  'aprovada'
);

alter table public.pp_verba_prestacoes
  add column status public.pp_verba_prestacao_status not null default 'em_avaliacao',
  add column motivo_reprovacao text,
  add column reprovada_em timestamptz,
  add column reprovada_por uuid references public.profiles(id),
  add column aprovada_em timestamptz,
  add column aprovada_por uuid references public.profiles(id),
  add column documentos_na_aprovacao jsonb,
  add column updated_at timestamptz not null default now(),
  add constraint chk_prestacao_reprovada_tem_motivo check (
    status <> 'reprovada'
    or (
      motivo_reprovacao is not null
      and char_length(btrim(motivo_reprovacao)) >= 10
      and reprovada_em is not null
      and reprovada_por is not null
    )
  ),
  add constraint chk_prestacao_aprovada_tem_autor check (
    status <> 'aprovada' or (aprovada_em is not null and aprovada_por is not null)
  );

create index if not exists idx_pp_verba_prestacoes_status
  on public.pp_verba_prestacoes (tenant_id, status);
create index if not exists idx_pp_verba_prestacoes_fechada_por
  on public.pp_verba_prestacoes (fechada_por);
create index if not exists idx_pp_verba_prestacoes_reprovada_por
  on public.pp_verba_prestacoes (reprovada_por);
create index if not exists idx_pp_verba_prestacoes_aprovada_por
  on public.pp_verba_prestacoes (aprovada_por);

create trigger trg_pp_verba_prestacoes_updated_at
  before update on public.pp_verba_prestacoes
  for each row execute function public.set_updated_at();

-- Cada documento comprova um valor, e só NF e recibo comprovam (decisão
-- 081, perguntas 4a e 3b).
alter table public.pp_verba_prestacoes_anexos
  add column valor numeric(14,2) not null,
  alter column documento_tipo set not null,
  add constraint chk_prestacao_anexo_valor_positivo check (valor > 0),
  add constraint chk_prestacao_anexo_documento_fiscal check (
    documento_tipo in ('nota_fiscal', 'recibo')
  );

create index if not exists idx_pp_verba_prestacoes_anexos_prestacao
  on public.pp_verba_prestacoes_anexos (prestacao_id);

-- Escrita só pelas funções da 150002 (SECURITY DEFINER). Leitura continua
-- para quem é do tenant.
drop policy if exists pp_verba_prestacoes_insert on public.pp_verba_prestacoes;
drop policy if exists pp_verba_prestacoes_anexos_insert on public.pp_verba_prestacoes_anexos;

comment on column public.pp_verba_prestacoes.status is
  'em_avaliacao (enviada pela produção) → reprovada (volta para a produção corrigir) ou aprovada (imutável; cria o estorno do saldo). Decisão 081.';
comment on column public.pp_verba_prestacoes.fechada_em is
  'Quando a produção ENVIOU a prestação — a última vez, se ela foi reprovada e reenviada. O nome vem do desenho de 26/08/2026.';
comment on column public.pp_verba_prestacoes.fechada_por is
  'Quem enviou a prestação (a última vez).';
comment on column public.pp_verba_prestacoes.valor_gasto is
  'Soma dos valores dos documentos. Nunca passa do valor da PP (decisão 081, 5a).';
comment on column public.pp_verba_prestacoes.valor_devolvido is
  'Saldo não comprovado: valor da PP menos o gasto. Vira estorno de verba só na aprovação.';
comment on column public.pp_verba_prestacoes.motivo_reprovacao is
  'Motivo da última reprovação (mín. 10 caracteres). Fica guardado depois do reenvio; a tela só o mostra enquanto a prestação está reprovada.';
comment on column public.pp_verba_prestacoes.documentos_na_aprovacao is
  'Foto dos documentos e valores conferidos na aprovação: [{id, nome, documento_tipo, documento_numero, valor}] — o mesmo registro que a decisão 070 guarda para a PP.';
comment on column public.pp_verba_prestacoes_anexos.valor is
  'Quanto este documento comprova. O gasto da prestação é a soma.';
