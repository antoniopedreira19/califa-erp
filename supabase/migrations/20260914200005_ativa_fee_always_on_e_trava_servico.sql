-- =====================================================================
-- Ativa as categorias Fee e Always On e trava o par serviço × categoria
--
-- Vai junto com o código que entende o modelo mensal (entrega 1 da
-- decisão 076). Antes dele, categoria ativa apareceria no Select da versão
-- em produção, que não sabe mostrar meses; e a trava abaixo recusaria
-- criar orçamento de serviço Fee pela tela antiga, que ainda não trava a
-- categoria.
--
-- A TRAVA DO PAR É NO BANCO porque regra crítica não depende da tela
-- (CLAUDE.md). A server action confere antes e devolve frase de campo;
-- este trigger é quem garante quando alguém chama a API por fora.
--
-- Só confere quando serviço ou categoria MUDAM: os 5 orçamentos que já
-- tinham serviço Fee/Always On com categoria nacional ficam como estão
-- (decisão do Tiago, 14/09/2026) e continuam editáveis nos outros campos.
--
-- Decisão 076. Aditivo: `ativo` só passa de false para true nas duas
-- categorias criadas pela 20260914200002, e o trigger é novo.
-- =====================================================================

update public.categorias_dominio
   set ativo = true
 where escopo = 'orcamento'
   and modelo_planilha = 'mensal'
   and servico_exclusivo_id is not null
   and ativo = false;

create or replace function public.orcamento_servico_e_categoria_coerentes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_exclusivo uuid;
  v_servico_tem_exclusiva boolean;
begin
  if tg_op = 'UPDATE'
     and new.servico_id is not distinct from old.servico_id
     and new.categoria_id is not distinct from old.categoria_id then
    return new;
  end if;
  if new.categoria_id is null or new.servico_id is null then
    return new;
  end if;

  select servico_exclusivo_id into v_exclusivo
    from categorias_dominio
   where id = new.categoria_id;

  if v_exclusivo is not null and v_exclusivo <> new.servico_id then
    raise exception 'A categoria escolhida é exclusiva de outro serviço.'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from categorias_dominio where servico_exclusivo_id = new.servico_id
  ) into v_servico_tem_exclusiva;

  if v_servico_tem_exclusiva and v_exclusivo is distinct from new.servico_id then
    raise exception 'Este serviço só aceita a categoria dele.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.orcamento_servico_e_categoria_coerentes() is
  'Recusa orçamento com categoria exclusiva de outro serviço, ou serviço com categoria exclusiva usando outra categoria. Só confere quando serviço ou categoria mudam. Decisão 076.';

drop trigger if exists trg_orcamento_servico_e_categoria_coerentes on public.orcamentos;
create trigger trg_orcamento_servico_e_categoria_coerentes
  before insert or update of servico_id, categoria_id on public.orcamentos
  for each row execute function public.orcamento_servico_e_categoria_coerentes();
