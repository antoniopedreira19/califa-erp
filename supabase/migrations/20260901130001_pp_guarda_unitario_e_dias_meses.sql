-- A PP passa a ser montada como a linha da planilha: R$ Unit. x QT x D/M.
--
-- Ate aqui a PP guardava so `quantidade`, e o valor era derivado no
-- servidor de `quantidade x (total_orcado / quantidade_orcada)`. Essa
-- conta dobrava o D/M dentro do "unitario": o item de R$ 5.000 x 1 x 2
-- aparecia no formulario como "R$ 10.000,00 por unidade do orcado", que
-- nao e o unitario de lugar nenhum.
--
-- Agora os tres fatores sao do GP e vem do formulario, e o valor e o
-- produto deles. Guardar so o produto perderia a negociacao: e a
-- decomposicao que diz se o fornecedor deu desconto no unitario ou
-- entregou menos diarias.
--
-- Aditiva. As PPs existentes recebem a decomposicao equivalente ao que ja
-- valia: D/M = 1 e unitario = valor / quantidade. `valor` NAO e tocado —
-- em quantidade que nao divide redondo (R$ 100,00 em 3) o produto da
-- decomposicao fica um centavo do valor gravado, e quem manda continua
-- sendo a coluna `valor`. Nenhuma PP muda de preco.
--
-- Escalas espelham as colunas irmas da propria tabela: dinheiro em
-- numeric(14,2) como `valor`, fator em numeric(12,3) como `quantidade`.

alter table public.pedidos_compra
  add column if not exists valor_unitario numeric(14,2),
  add column if not exists dias_meses     numeric(12,3);

-- Backfill: preenche o que nasceu vazio, sem tocar em `valor`.
update public.pedidos_compra
   set valor_unitario = round(valor / nullif(quantidade, 0), 2),
       dias_meses     = 1
 where valor_unitario is null
    or dias_meses is null;

-- Sobra defensiva: PP com quantidade zerada nao existe hoje (o schema da
-- action exige positiva), mas o nullif acima devolveria null e travaria o
-- NOT NULL logo abaixo.
update public.pedidos_compra
   set valor_unitario = 0
 where valor_unitario is null;

alter table public.pedidos_compra
  alter column valor_unitario set not null,
  alter column dias_meses     set not null;

alter table public.pedidos_compra
  drop constraint if exists pedidos_compra_dias_meses_positivo;
alter table public.pedidos_compra
  add  constraint pedidos_compra_dias_meses_positivo check (dias_meses > 0);

comment on column public.pedidos_compra.valor_unitario is
  'R$ por unidade contratado NESTA PP. Nasce do unitario orcado do item, mas o GP pode fechar por outro valor - o teto e o saldo em R$ do item, nao o unitario.';
comment on column public.pedidos_compra.dias_meses is
  'Diarias/meses desta PP. valor = valor_unitario x quantidade x dias_meses.';
