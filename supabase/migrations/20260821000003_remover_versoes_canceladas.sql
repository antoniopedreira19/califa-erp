-- 20260821000003 — o estado "cancelada" de versão de orçamento deixa de existir
--
-- Contexto: até 21/08/2026 a tela do orçamento oferecia "Cancelar versão",
-- que marcava `versoes_orcamento.status = 'cancelada'` e deixava a versão no
-- banco, ainda visível e selecionável. O Tiago apontou que isso não resolve
-- nada: se a versão continua existindo e navegável, basta NÃO aprová-la — o
-- estado extra só polui a fita de abas. O botão virou "Deletar versão"
-- (decisão 023).
--
-- Esta migration limpa o resíduo: as versões que já estavam canceladas quando
-- a regra mudou. No momento em que foi escrita eram DUAS, ambas com 1 item:
--
--   992e010c-2581-4150-86ca-1611f03634cc — PEVETE-0002/26-01 v1, de 29/07/2026
--   8b57c179-5aec-4ea2-9f81-39621360097d — TESTE-0003/26-01 v3, de 21/08/2026
--                                          (criada na conferência da própria
--                                           entrega, para testar o botão)
--
-- MUDANÇA DESTRUTIVA, autorizada explicitamente pelo Tiago em 21/08/2026.
-- Apaga linha de `versoes_orcamento`, `versoes_orcamento_grupos` e
-- `versoes_orcamento_itens`. Não há como desfazer.
--
-- Por que a ordem é explícita e não confiada ao CASCADE: `versoes_orcamento`
-- tem ON DELETE CASCADE para grupos E para itens, mas
-- `versoes_orcamento_itens.grupo_id` referencia o grupo com ON DELETE
-- RESTRICT. Se o Postgres processar a cascata dos grupos antes da dos itens,
-- o RESTRICT barra o delete inteiro. Apagando item → grupo → versão na mão, o
-- resultado não depende dessa ordem.
--
-- `itens_bv` cai junto por CASCADE a partir do item; nenhuma das duas versões
-- tem BV.
--
-- O valor 'cancelada' CONTINUA no enum de status. Remover valor de enum é
-- destrutivo, precisaria reescrever a coluna, e não ganharia nada: o código
-- que trata o status permanece como rede de segurança.

begin;

-- Rede de proteção: versão que virou job não pode ser apagada. O banco já
-- barraria (jobs.versao_orcamento_aprovada_id é ON DELETE RESTRICT), mas o
-- erro sairia como violação de FK. Melhor falhar dizendo o porquê.
do $$
declare
  travadas int;
begin
  select count(*) into travadas
  from versoes_orcamento v
  where v.status = 'cancelada'
    and exists (select 1 from jobs j where j.versao_orcamento_aprovada_id = v.id);

  if travadas > 0 then
    raise exception
      'Abortado: % versão(ões) cancelada(s) estão vinculadas a um job. Revise antes de apagar.',
      travadas;
  end if;
end $$;

delete from versoes_orcamento_itens
where versao_orcamento_id in (
  select id from versoes_orcamento where status = 'cancelada'
);

delete from versoes_orcamento_grupos
where versao_orcamento_id in (
  select id from versoes_orcamento where status = 'cancelada'
);

delete from versoes_orcamento
where status = 'cancelada';

commit;
