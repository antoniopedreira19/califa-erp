-- O cartão vira uma conta.
--
-- Segunda fatia do módulo de Fatura de Cartão. O desenho combinado com o
-- Tiago (28/08/2026): cada compra no cartão gera lançamento NA CONTA DO
-- CARTÃO, com o plano de contas do item; pagar a fatura é uma
-- transferência banco -> cartão. Assim o DRE mantém a granularidade por
-- item E o extrato bancário mostra um débito só, igual ao banco.
--
-- A alternativa — a fatura virar UM lançamento com um plano de contas só —
-- faria a assinatura, o fornecedor e o material de escritório de dentro
-- dela virarem uma linha indistinta no DRE.
--
-- ⚠️ O cartão nasce como linha de `contas_bancarias`, e não como um segundo
-- tipo de conta em paralelo. É a decisão que mantém a Conciliação, o fluxo
-- de caixa e o saldo funcionando sem aprender um conceito novo — todos eles
-- já sabem ler `conta_bancaria_id`, que é NOT NULL em
-- `lancamentos_financeiros` e continuará sendo.
--
-- `contas_bancarias.tipo` é texto, mas NÃO é livre: `chk_conta_tipo_valido`
-- limita a corrente/poupanca/investimento/caixa. O valor novo entra
-- ampliando esse CHECK — ampliar é aditivo, ninguém perde linha.

-- ---------------------------------------------------------------------
-- 1. O cartão passa a pertencer a uma empresa
-- ---------------------------------------------------------------------
-- A conta espelho precisa de `empresa_id` (NOT NULL em contas_bancarias), e
-- a trava de baixa compara a empresa da conta com a do título. Sem isso o
-- cartão da California pagaria conta da outra empresa.
--
-- NOT NULL direto: `cartoes_credito` está com 0 linhas.

alter table public.cartoes_credito
  add column if not exists empresa_id uuid references public.empresas (id);

alter table public.cartoes_credito
  alter column empresa_id set not null;

comment on column public.cartoes_credito.empresa_id is
  'Empresa dona do cartão. A conta espelho herda daqui, e é o que impede um cartão de pagar título de outra empresa (28/08/2026).';

-- ---------------------------------------------------------------------
-- 2. A conta espelho
-- ---------------------------------------------------------------------

-- O CHECK do tipo precisa aceitar o valor novo ANTES do trigger existir —
-- senão a primeira inserção de cartão morre com erro de constraint, que é
-- exatamente o que aconteceu ao testar.
alter table public.contas_bancarias
  drop constraint if exists chk_conta_tipo_valido;
alter table public.contas_bancarias
  add constraint chk_conta_tipo_valido check (
    tipo = any (array['corrente', 'poupanca', 'investimento', 'caixa', 'cartao_credito'])
  );

alter table public.contas_bancarias
  add column if not exists cartao_credito_id uuid
    references public.cartoes_credito (id) on delete cascade;

comment on column public.contas_bancarias.cartao_credito_id is
  'Quando preenchido, esta conta É um cartão de crédito (tipo = cartao_credito) e não uma conta bancária de verdade. Criada e mantida pelo trigger trg_conta_do_cartao.';

create unique index if not exists uniq_conta_por_cartao
  on public.contas_bancarias (cartao_credito_id)
  where cartao_credito_id is not null;

-- A conta do cartão acompanha o cartão: nasce com ele, e nome/banco/ativo
-- seguem o cadastro. Trigger, e não action, porque é invariante: cartão sem
-- conta seria um cartão em que nenhuma compra pode ser lançada, e o erro
-- só apareceria muito depois.
create or replace function public.sincronizar_conta_do_cartao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.contas_bancarias (
      tenant_id, empresa_id, nome, banco, tipo,
      saldo_inicial, saldo_inicial_data, ativo, cartao_credito_id, created_by
    ) values (
      new.tenant_id, new.empresa_id,
      new.nome, new.banco, 'cartao_credito',
      0, current_date, new.ativo, new.id, new.created_by
    );
    return new;
  end if;

  update public.contas_bancarias
     set nome        = new.nome,
         banco       = new.banco,
         empresa_id  = new.empresa_id,
         ativo       = new.ativo,
         updated_at  = now()
   where cartao_credito_id = new.id;

  return new;
end;
$function$;

drop trigger if exists trg_conta_do_cartao on public.cartoes_credito;
create trigger trg_conta_do_cartao
  after insert or update on public.cartoes_credito
  for each row
  execute function public.sincronizar_conta_do_cartao();

-- ---------------------------------------------------------------------
-- 3. Permissões
-- ---------------------------------------------------------------------

grant select, insert, update on public.contas_bancarias to authenticated;
grant select, insert, update on public.cartoes_credito to authenticated;
