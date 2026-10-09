-- =============================================================================
-- Decisão 160 — PP "Pronta para envio" (09/10/2026)
-- =============================================================================
--
-- Por quê: desde a decisão 136 o produtor (e o freelancer) GERA a PP, mas só
-- o GP (ou o administrador) a ENVIA ao financeiro. Em 08/10/2026 havia 14 PPs
-- geradas paradas no job, várias do produtor, e nada avisava o GP. O Tiago
-- pediu um passo do meio: quem tem a nota do fornecedor confere os documentos
-- no mesmo pop-up do envio, com as mesmas regras (tipo de cada arquivo e os
-- dados da NF obrigatórios), e em vez de enviar deixa a PP "Pronta para
-- envio". O GP vê a marca na aba Pedidos de Produção e envia com o pop-up já
-- preenchido.
--
-- O que muda no banco: duas colunas na PP — quando e quem deixou pronta. A PP
-- continua "gerada" (sem status novo: um status novo mexeria nos filtros do
-- financeiro, na conta do realizado e no código da outra frente). A marca fica
-- depois do envio, como registro.
--
-- A trava não depende da tela: o gatilho abaixo só aceita a marca na PP
-- gerada e grava QUEM e QUANDO pelo usuário da sessão, não pelo que a tela
-- mandar. Desmarcar (em = null) limpa o autor. Sem sessão (chave de serviço),
-- vale o que foi gravado.
--
-- Fora daqui, de propósito: evento novo no histórico da PP (a linha do tempo
-- do "Ver PP" — sugestão ainda não aprovada) e a ligação das NFs ao cadastro
-- de notas, que segue acontecendo no envio (`ligar_notas_fiscais_da_pp`).
--
-- Aditiva: colunas novas, nulas, sem backfill. Os grants são da tabela
-- (authenticated já lê e escreve; anon não tem nada) e a RLS de
-- pedidos_compra vale para elas. Sem índice no autor: nenhuma tela filtra por
-- ele, como os outros "*_por" da PP.
-- =============================================================================

alter table public.pedidos_compra
  add column if not exists pronta_para_envio_em timestamptz,
  add column if not exists pronta_para_envio_por uuid references public.profiles(id);

comment on column public.pedidos_compra.pronta_para_envio_em is
  'Decisão 160: quando o produtor/freelancer deixou a PP pronta para o GP enviar (conferiu os documentos no pop-up do envio). A PP segue gerada. Gravado pelo gatilho trg_pp_carimba_pronta_para_envio.';
comment on column public.pedidos_compra.pronta_para_envio_por is
  'Decisão 160: quem deixou a PP pronta para envio. Gravado pelo gatilho com o usuário da sessão.';

create or replace function public.pp_carimba_pronta_para_envio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Só reage quando a marca muda.
  if new.pronta_para_envio_em is not distinct from old.pronta_para_envio_em
     and new.pronta_para_envio_por is not distinct from old.pronta_para_envio_por then
    return new;
  end if;

  if old.status <> 'gerada' then
    raise exception 'Só a PP gerada, ainda no job, fica pronta para envio.';
  end if;

  -- Desmarcar limpa o autor.
  if new.pronta_para_envio_em is null then
    new.pronta_para_envio_por := null;
    return new;
  end if;

  -- Quem e quando: a sessão, não o que veio da tela.
  if auth.uid() is not null then
    new.pronta_para_envio_por := auth.uid();
    new.pronta_para_envio_em := now();
  end if;
  return new;
end;
$$;

comment on function public.pp_carimba_pronta_para_envio() is
  'Decisão 160: aceita a marca "Pronta para envio" só na PP gerada e grava quem/quando pela sessão.';

drop trigger if exists trg_pp_carimba_pronta_para_envio on public.pedidos_compra;
create trigger trg_pp_carimba_pronta_para_envio
  before update of pronta_para_envio_em, pronta_para_envio_por on public.pedidos_compra
  for each row execute function public.pp_carimba_pronta_para_envio();
