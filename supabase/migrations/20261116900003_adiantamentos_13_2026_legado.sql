-- One-off: marca como "legado" os adiantamentos de 13º/2026 que foram
-- registrados antes do sistema Califa entrar em vigor.
--
-- Contexto: os 18 adiantamentos cadastrados em 2026 foram pagamentos
-- feitos pela empresa ANTES do Califa — não passaram pelo fluxo do
-- financeiro aqui dentro. Como foram lançados via "Novo adiantamento",
-- o sistema criou folhas_pagamento vinculadas e o colaborador viu
-- "Aguardando NF" pra algo que o Califa não vai pagar.
--
-- Solução: deleta as folhas_pagamento vinculadas. A FK
-- decimo_terceiro_adiantamentos.folha_pagamento_id é ON DELETE SET NULL,
-- então os adiantamentos ficam com folha_pagamento_id = NULL — estado
-- que o código já reconhece como "Pré-fluxo (legado)" (badge cinza na
-- lista, fora da tela de anexar NF do colaborador, fora do financeiro).
--
-- Segurança (checada antes de aplicar):
-- - 18 adiantamentos em 2026, todos com folha_pagamento_id vinculado.
-- - 0 com NF anexada em colaboradores_nf_anexos.
-- - 0 com folha_pagamento em status aprovada ou paga.
-- Restrição de status no WHERE evita deletar qualquer folha que, por
-- algum caminho, tenha avançado no fluxo.

delete from public.folhas_pagamento
where id in (
  select folha_pagamento_id
  from public.decimo_terceiro_adiantamentos
  where ano = 2026
    and folha_pagamento_id is not null
)
and status in ('enviada', 'pendente_correcao', 'rascunho');
