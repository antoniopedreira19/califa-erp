-- =====================================================================
-- A trava da categoria perde o SECURITY DEFINER
--
-- ⚠️ ESTA MIGRATION JÁ ESTÁ APLICADA. Ela existe para o histórico do
-- banco bater com o repositório, e NÃO deve ser reaplicada pelo MCP: o
-- `schema_migrations` já tem a entrada
-- `20260911033732 · orcamento_internacional_trava_sem_security_definer`,
-- de 11/09/2026 03:37. Aplicá-la de novo criaria uma segunda entrada para
-- a mesma mudança.
--
-- O QUE ACONTECEU
--
-- A 20260911000001 criou `categoria_modelo_proprio_travado` com
-- `security definer`. Isso anula a própria trava: dentro de uma função
-- SECURITY DEFINER o `current_user` passa a ser o DONO dela (postgres),
-- então a comparação `current_user <> 'authenticated'` nunca dá
-- verdadeiro e o trigger libera TODAS as alterações — inclusive as que
-- deveria recusar. A trava existiria no papel e deixaria tudo passar.
--
-- O conserto foi aplicado pelo MCP na hora, mas o arquivo da 000001 foi
-- corrigido NO LUGAR em vez de a correção virar migration à parte. O
-- resultado: clone novo produz o schema certo (a 000001 já declara a
-- função sem `security definer`), e só o histórico ficava com uma entrada
-- sem fonte. Este arquivo fecha essa lacuna.
--
-- Achado por outra sessão em 11/09/2026, cruzando `schema_migrations` com
-- os arquivos de `supabase/migrations/` — uma conferência que eu havia
-- afirmado ter feito e não tinha.
--
-- É idempotente e no-op na prática: `create or replace` sobre uma função
-- que já está exatamente assim. Rodar a 000001 e depois esta, num banco
-- limpo, dá o mesmo resultado que rodar só a 000001.
--
-- Decisão 072.
-- =====================================================================

create or replace function public.categoria_modelo_proprio_travado()
returns trigger
language plpgsql
-- SEM `security definer`: é o ponto inteiro desta correção.
set search_path = public, pg_temp
as $$
begin
  if old.modelo_planilha = 'nacional' then
    return new;
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.nome is distinct from old.nome then
    raise exception
      'A categoria "%" tem modelo de planilha próprio e não pode ser renomeada.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.escopo is distinct from old.escopo then
    raise exception
      'A categoria "%" tem modelo de planilha próprio e não pode mudar de escopo.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.modelo_planilha is distinct from old.modelo_planilha then
    raise exception
      'O modelo de planilha da categoria "%" só pode ser alterado por migration.', old.nome
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
