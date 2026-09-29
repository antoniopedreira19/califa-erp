-- =====================================================================
-- O status do orçamento só muda pelo sistema (decisão 117)
-- =====================================================================
-- "O status não pode ser modificado manualmente" (Tiago, 28/09/2026) vale
-- para o orçamento também. O campo Status do "Editar orçamento" saiu no
-- mesmo dia; esta guarda recusa a mesma escrita feita por fora, pela API
-- do Supabase com o próprio login (a RLS de `orcamentos` só olha tenant,
-- empresa e regional).
--
-- As mudanças que o app faz, cada uma com o papel da action
-- (lib/permissoes.ts):
--   * nasce `rascunho` (default da coluna)
--   * rascunho | em_revisao | enviado_cliente | recusado → aprovado
--       aprovar a versão (`aprovarVersao`)            administrador, GP
--   * aprovado → em_revisao
--       desfazer a aprovação (`cancelarAprovacaoVersao`) administrador, GP
--   * aprovado → job_criado
--       enviar para abertura (`enviarJobParaAbertura`)  administrador, GP
--   * job_criado → aprovado
--       cancelar o envio (`cancelarEnvioParaAbertura`)  administrador, GP,
--                                                        produtor
--   * enviado_cliente | recusado | cancelado → rascunho, só junto do
--     Reativar (`reativarOrcamento`): são os status manuais antigos, que
--     ninguém mais escolhe e deixariam o orçamento preso
--                                                        administrador, GP,
--                                                        produtor
-- Qualquer outra é recusada. Nenhuma função do banco muda esse status hoje;
-- a que passar a mudar, como `security definer`, traz a regra dela.
--
-- Arquivar não é status (decisão 118): a guarda do arquivamento é a
-- `orcamentos_guarda_arquivado`.
-- =====================================================================

create or replace function public.orcamentos_guarda_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_papel text;
  v_de    text;
  v_para  text;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'rascunho'::public.orcamento_status then
      raise exception 'O orçamento nasce em rascunho. O status dele é do sistema.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_de := old.status::text;
  v_para := new.status::text;
  if v_de is not distinct from v_para then
    return new;
  end if;

  v_papel := coalesce(public.session_role()::text, '');

  if not (
       (v_de in ('rascunho', 'em_revisao', 'enviado_cliente', 'recusado')
          and v_para = 'aprovado'
          and v_papel in ('administrador', 'gerente_producao'))
    or (v_de = 'aprovado'
          and v_para in ('em_revisao', 'job_criado')
          and v_papel in ('administrador', 'gerente_producao'))
    or (v_de = 'job_criado'
          and v_para = 'aprovado'
          and v_papel in ('administrador', 'gerente_producao', 'produtor'))
    or (v_de in ('enviado_cliente', 'recusado', 'cancelado')
          and v_para = 'rascunho'
          and old.arquivado_em is not null
          and new.arquivado_em is null
          and v_papel in ('administrador', 'gerente_producao', 'produtor'))
  ) then
    raise exception 'Mudança de status do orçamento não permitida (% → %). O status do orçamento é do sistema.', v_de, v_para
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.orcamentos_guarda_status() is
  'Decisão 117 (28/09/2026): o status do orçamento só muda pelas ações do sistema — aprovar, desfazer a aprovação, enviar para abertura, cancelar o envio e o Reativar do status manual antigo —, cada uma com o seu papel. Não vale dentro de função security definer.';

revoke all on function public.orcamentos_guarda_status() from public, anon;

drop trigger if exists trg_orcamentos_a_guarda_status on public.orcamentos;
create trigger trg_orcamentos_a_guarda_status
  before insert or update on public.orcamentos
  for each row
  execute function public.orcamentos_guarda_status();
