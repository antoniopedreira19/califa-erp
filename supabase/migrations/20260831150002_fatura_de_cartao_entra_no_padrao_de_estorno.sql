-- A baixa da fatura de cartão passa a seguir o padrão dos outros cinco
-- documentos estornáveis. Substitui o remendo da 20260831140001.
--
-- O que muda, na ordem:
--
--  1. TRÊS CHECKs passam a conhecer a tríade nova, e os três ficam
--     estritamente mais permissivos — nenhuma linha existente deixa de
--     passar. Substituição de constraint, autorizada pelo Tiago em
--     31/08/2026:
--       · `chk_estorno_consistente` aceita `fatura_cartao_estorno` no
--         lado que EXIGE `estorno_de_lancamento_id`;
--       · `chk_origem_contraparte_tem_id` e `chk_origem_tem_referencia`
--         ganham o ramo da fatura, que pede `fatura_cartao_id` e proíbe
--         os cinco documentos das outras origens.
--
--  2. Backfill das 8 linhas de pagamento/estorno que já existiam (FC-00001
--     e FC-00003). ⚠️ Ele SOBRESCREVE `origem`, que hoje vale 'manual' —
--     também autorizado, e é o que faz as faturas antigas responderem ao
--     mesmo filtro das novas. O par é reconstruído por
--     (fatura, conta, valor) na ordem de criação, que é único aqui.
--
--  3. Índice único parcial sobre `origem = 'fatura_cartao_baixa'`. A
--     chave é (fatura, conta) e não só (fatura), porque a baixa da fatura
--     tem DUAS pernas — a saída do banco e a entrada no cartão. Duas
--     baixas vivas da mesma fatura passam a ser impossíveis no banco.
--
--  4. `dar_baixa_fatura_cartao` grava `fatura_cartao_baixa`.
--
--  5. `estornar_baixa_fatura_cartao` vira o espelho de
--     `estornar_baixa_titulo`: marca o original como
--     `fatura_cartao_baixa_estornada` ANTES de inserir o reverso (é o
--     UPDATE que libera o índice único) e o reverso nasce apontando para
--     o que anulou. O corte por `created_at` da 20260831140001 sai: o
--     estado agora está na própria linha.
--
-- `papel_na_fatura` continua como está — ele distingue item, ajuste e
-- pagamento, que `origem` não faz, e `reabrir_fatura_cartao` apaga por ele.

-- ---------------------------------------------------------------- 1 ----
alter table public.lancamentos_financeiros
  drop constraint if exists chk_estorno_consistente;

alter table public.lancamentos_financeiros
  add constraint chk_estorno_consistente check (
    (
      origem = any (array[
        'pp_estorno'::origem_lancamento,
        'avulsa_estorno'::origem_lancamento,
        'pp_devolucao_verba_estorno'::origem_lancamento,
        'titulo_estorno'::origem_lancamento,
        'desembolso_estorno'::origem_lancamento,
        'fatura_cartao_estorno'::origem_lancamento
      ])
      and estorno_de_lancamento_id is not null
    )
    or (
      origem <> all (array[
        'pp_estorno'::origem_lancamento,
        'avulsa_estorno'::origem_lancamento,
        'pp_devolucao_verba_estorno'::origem_lancamento,
        'titulo_estorno'::origem_lancamento,
        'desembolso_estorno'::origem_lancamento,
        'fatura_cartao_estorno'::origem_lancamento
      ])
      and estorno_de_lancamento_id is null
    )
  );

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_contraparte_tem_id;

alter table public.lancamentos_financeiros
  add constraint chk_origem_contraparte_tem_id check (
    (origem = any (array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento]) and pedido_compra_id is not null)
    or (origem = any (array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento]) and conta_avulsa_id is not null)
    or (origem = any (array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento]) and titulo_receber_id is not null)
    or (origem = any (array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento]) and desembolso_id is not null)
    or (origem = any (array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento, 'pp_devolucao_verba_estorno'::origem_lancamento]) and pp_verba_devolucao_id is not null and pedido_compra_id is not null)
    or (origem = any (array['fatura_cartao_baixa'::origem_lancamento, 'fatura_cartao_baixa_estornada'::origem_lancamento, 'fatura_cartao_estorno'::origem_lancamento]) and fatura_cartao_id is not null)
    or (origem = 'manual'::origem_lancamento and pedido_compra_id is null and conta_avulsa_id is null and titulo_receber_id is null and desembolso_id is null and pp_verba_devolucao_id is null)
  );

alter table public.lancamentos_financeiros
  drop constraint if exists chk_origem_tem_referencia;

alter table public.lancamentos_financeiros
  add constraint chk_origem_tem_referencia check (
    (origem = any (array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento]) and pedido_compra_id is not null and conta_avulsa_id is null and titulo_receber_id is null and desembolso_id is null and pp_verba_devolucao_id is null)
    or (origem = any (array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento]) and conta_avulsa_id is not null and pedido_compra_id is null and titulo_receber_id is null and desembolso_id is null and pp_verba_devolucao_id is null)
    or (origem = any (array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento]) and titulo_receber_id is not null and pedido_compra_id is null and conta_avulsa_id is null and desembolso_id is null and pp_verba_devolucao_id is null)
    or (origem = any (array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento]) and desembolso_id is not null and pedido_compra_id is null and conta_avulsa_id is null and titulo_receber_id is null and pp_verba_devolucao_id is null)
    or (origem = any (array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento, 'pp_devolucao_verba_estorno'::origem_lancamento]) and pp_verba_devolucao_id is not null and pedido_compra_id is not null and conta_avulsa_id is null and titulo_receber_id is null and desembolso_id is null)
    or (origem = any (array['fatura_cartao_baixa'::origem_lancamento, 'fatura_cartao_baixa_estornada'::origem_lancamento, 'fatura_cartao_estorno'::origem_lancamento]) and fatura_cartao_id is not null and pedido_compra_id is null and conta_avulsa_id is null and titulo_receber_id is null and desembolso_id is null and pp_verba_devolucao_id is null)
    or (origem = 'manual'::origem_lancamento and pedido_compra_id is null and conta_avulsa_id is null and titulo_receber_id is null and desembolso_id is null and pp_verba_devolucao_id is null)
  );

-- ---------------------------------------------------------------- 2 ----
with pagamentos as (
  select l.id, l.fatura_cartao_id, l.conta_bancaria_id, l.valor,
         row_number() over (
           partition by l.fatura_cartao_id, l.conta_bancaria_id, l.valor
           order by l.created_at, l.id
         ) as rn
    from public.lancamentos_financeiros l
   where l.papel_na_fatura = 'pagamento'
), estornos as (
  select l.id, l.fatura_cartao_id, l.conta_bancaria_id, l.valor,
         row_number() over (
           partition by l.fatura_cartao_id, l.conta_bancaria_id, l.valor
           order by l.created_at, l.id
         ) as rn
    from public.lancamentos_financeiros l
   where l.papel_na_fatura = 'pagamento_estorno'
), pares as (
  select p.id as pagamento_id, e.id as estorno_id
    from pagamentos p
    join estornos e
      on e.fatura_cartao_id = p.fatura_cartao_id
     and e.conta_bancaria_id is not distinct from p.conta_bancaria_id
     and e.valor = p.valor
     and e.rn = p.rn
)
update public.lancamentos_financeiros l
   set origem = 'fatura_cartao_estorno',
       estorno_de_lancamento_id = pares.pagamento_id
  from pares
 where l.id = pares.estorno_id;

-- Pagamento com estorno apontando para ele = desfeito; o resto está vivo.
update public.lancamentos_financeiros l
   set origem = case
         when exists (
           select 1 from public.lancamentos_financeiros e
            where e.estorno_de_lancamento_id = l.id
              and e.origem = 'fatura_cartao_estorno'
         ) then 'fatura_cartao_baixa_estornada'::origem_lancamento
         else 'fatura_cartao_baixa'::origem_lancamento
       end
 where l.papel_na_fatura = 'pagamento';

-- ---------------------------------------------------------------- 3 ----
create unique index if not exists uniq_baixa_ativa_por_fatura_cartao
  on public.lancamentos_financeiros (fatura_cartao_id, conta_bancaria_id)
  where origem = 'fatura_cartao_baixa'::origem_lancamento;

comment on index public.uniq_baixa_ativa_por_fatura_cartao is
  'Uma baixa VIVA por perna (banco e cartão) de cada fatura. O estorno troca a origem para fatura_cartao_baixa_estornada e libera a vaga.';
