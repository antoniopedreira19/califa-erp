-- A avulsa a pagar fora do cartão não nasce nem fica sem data (revisão de
-- 26/10/2026 da decisão 082).
--
-- Por quê: a "Data prevista de pagamento" do Pagamento avulso era opcional,
-- e a avulsa nasce aprovada. Sem data, o título não tinha dia: ia para o fim
-- da aba Títulos da Conciliação e a faixa "Hoje" aparecia duas vezes
-- (revisão de 26/10/2026 da decisão 195). As duas avulsas assim, a AV-00003
-- e a AV-00004 (testes da remessa Santander, R$ 0,05), entravam em toda
-- remessa nova e foram excluídas pela tela em 26/10/2026. A tela e a
-- validação do servidor já exigem a data; esta trava garante o "nunca" para
-- qualquer outro caminho (SQL, outra tela, outra frente).
--
-- A data é a que a tela lê como data do título:
-- coalesce(data_pagamento, data_prevista_pagamento). Nenhuma função do banco
-- zera essas colunas, e os caminhos que criam avulsa a pagar já mandam a
-- data: o formulário, a folha (último dia da competência), o 13º do RH e a
-- recorrência (a data da ocorrência).
--
-- Fora da trava, de propósito:
--   * o cartão de crédito: a data não se escolhe, vem do vencimento da
--     fatura (gatilho avulsa_entra_na_fatura, decisão 093), e o estorno no
--     cartão é entrada;
--   * a avulsa a receber (tipo_entrada preenchido): o pedido foi só para o
--     lado a pagar; o recebimento avulso e o rendimento já exigem a data no
--     formulário.
--
-- Cada termo do CHECK é booleano (nunca nulo): um nulo no meio não deixa a
-- linha passar sem querer. Nenhuma linha violava em 26/10/2026 (3 avulsas).

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'chk_avulsa_a_pagar_tem_data'
       and conrelid = 'public.contas_avulsas'::regclass
  ) then
    alter table public.contas_avulsas
      add constraint chk_avulsa_a_pagar_tem_data check (
        tipo_entrada is not null
        or forma_pagamento is not distinct from 'cartao_credito'::public.forma_pagamento
        or coalesce(data_pagamento, data_prevista_pagamento) is not null
      );
  end if;
end
$$;

comment on constraint chk_avulsa_a_pagar_tem_data on public.contas_avulsas is
  'Avulsa a pagar fora do cartão sempre tem data (data_pagamento ou data_prevista_pagamento). Revisão de 26/10/2026 da decisão 082.';
