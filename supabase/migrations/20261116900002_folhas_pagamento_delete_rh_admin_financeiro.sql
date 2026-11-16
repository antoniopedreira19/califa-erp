-- Fecha o buraco de DELETE em folhas_pagamento.
--
-- Contexto: ao excluir um adiantamento de 13º enquanto ele ainda não foi
-- aprovado pelo financeiro e o colaborador ainda não anexou NF, o fluxo
-- (excluirAdiantamentoDecimoTerceiro em app/(app)/rh/decimo-terceiro/actions.ts)
-- precisa deletar a linha correspondente em folhas_pagamento antes de
-- apagar o adiantamento. Hoje bate em "permission denied for table
-- folhas_pagamento" porque:
--   1. O GRANT para authenticated é só a/r/w (INSERT/SELECT/UPDATE).
--   2. Não existe policy de DELETE na tabela.
--
-- A tabela já libera INSERT/SELECT/UPDATE para admin + RH + financeiro.
-- DELETE segue o mesmo trio — a action valida no app layer que o status
-- não é "aprovada"/"paga" e que não há NF anexada antes de chamar o
-- delete, então a policy pode seguir o padrão das outras operações sem
-- precisar replicar a regra de negócio aqui.

grant delete on public.folhas_pagamento to authenticated;

create policy folhas_delete on public.folhas_pagamento
  for delete
  to authenticated
  using (
    is_tenant_admin(tenant_id)
    or is_tenant_rh(tenant_id)
    or is_tenant_financeiro(tenant_id)
  );
