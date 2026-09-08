-- =====================================================================
-- `A` e `D`: o planejado volta a ser digitado
--
-- Decisão do Tiago em 08/09/2026 (docs/decisions/062), que revê a 022 §4.
--
-- Em 21/08/2026 os tipos `A` e `D` perderam o planejado próprio: como o
-- cliente paga o fornecedor diretamente, entendeu-se que a agência não
-- tinha custo a planejar — o custo ERA o orçado, e o ganho era a
-- comissão. Na prática o GP precisa registrar quanto o serviço custa de
-- verdade, que é o que ele negociou, e esse número não é o que foi
-- orçado ao cliente. O `AR` nunca teve o espelho justamente por isso; A
-- e D passam a se comportar como ele.
--
-- Com A e D fora, NENHUM tipo espelha mais o orçado no planejado: a
-- função perde o ramo inteiro e fica só com o do save.
--
-- ⚠️ O NOME DA FUNÇÃO É HISTÓRICO. Ela se chama
-- `planejado_espelha_orcado` desde 21/08/2026 e continua assim de
-- propósito: renomear objeto de banco compartilhado com outra frente de
-- desenvolvimento quebra mais do que resolve. O que ela faz HOJE está no
-- comentário dela e aqui: zerar o planejado da linha em save.
--
-- O RAMO DO SAVE FICA, e é o motivo de a função não ser removida.
-- Decisão 028 §9: linha em save é venda sem execução — ela não tem custo
-- neste projeto, e o planejado dela é zero. São os mesmos seis caminhos
-- de escrita de sempre chegando na tabela (célula, linha nova, drawer,
-- importação, editor de rascunho, editor agregado); o trigger continua
-- sendo o único ponto por onde todos passam.
--
-- SEM BACKFILL, de propósito. Os 34 itens `A` das versões e os 20 das
-- cópias de job estão hoje com `planejado = orçado`, escrito pelo próprio
-- espelho. Eles continuam exatamente assim — o que muda é que agora dá
-- para editar. Zerá-los apagaria custo que já está na conta de job
-- aberto. (Não existe nenhum item `D` no banco.)
--
-- Aditiva: só o corpo da função muda. Nenhuma coluna, linha ou trigger
-- removido.
-- =====================================================================

create or replace function public.planejado_espelha_orcado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Linha em save não tem custo neste projeto: o serviço não acontece
  -- aqui, então não há fornecedor a pagar (decisão 028 §9).
  if new.em_save then
    new.valor_unitario_planejado := 0;
    new.quantidade_planejada     := 0;
    new.dias_meses_planejado     := 0;
  end if;
  return new;
end;
$$;

comment on function public.planejado_espelha_orcado() is
  'Zera o planejado da linha em SAVE (decisão 028 §9). O nome é histórico: até 08/09/2026 ela também fazia o planejado de A e D espelhar o orçado, e a decisão 062 devolveu o planejado digitado a esses dois tipos.';

-- Os dois triggers seguem nas mesmas colunas: `em_save` precisa disparar
-- (marcar uma linha existente zera o planejado dela na hora), e as do
-- planejado também — sem elas, gravar planejado numa linha JÁ em save
-- passaria batido.
drop trigger if exists trg_planejado_espelha_orcado on public.versoes_orcamento_itens;
create trigger trg_planejado_espelha_orcado
before insert or update of
  em_save, tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.versoes_orcamento_itens
for each row execute function public.planejado_espelha_orcado();

drop trigger if exists trg_planejado_espelha_orcado_job on public.jobs_itens_orcado;
create trigger trg_planejado_espelha_orcado_job
before insert or update of
  em_save, tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.jobs_itens_orcado
for each row execute function public.planejado_espelha_orcado();
