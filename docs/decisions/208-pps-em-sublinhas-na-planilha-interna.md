# 208 — A linha da Planilha Interna abre em sublinhas, uma por PP

**Data:** 2026-10-23
**Status:** aceita e implementada em 23/10/2026.
**Quem decidiu:** Tiago, no protótipo "PPs na Planilha Interna" (22/10/2026,
versão 2): a opção A, sem quem recebe na sublinha, e "deve ser implementado
tanto em job quanto em financeiro" (23/10/2026).
**Migrations:** nenhuma.

## O pedido

> "Penso que podemos criar uma maneira de expandir uma linha com PPs em suas
> PPs, de maneira similar a como acontece quando exportamos a planilha do
> sistema."

Nasceu do caso da verba do ANI-1001/26 (19/10/2026): a GP criava uma linha
por gasto com errata, e a PP da linha nova esperava a revisão da abertura
(decisão 185). Com várias PPs na mesma linha de verba não há errata — mas a
planilha só mostrava o total. Com duas PPs ou mais o realizado do item
guarda só o total e zera R$ Unit., QT e D/M
(`recalcular_realizado_do_item`): o detalhe de cada gasto sumia da planilha.

## A regra

1. **Seta ao lado do nome** em toda linha com PP não cancelada. Clicar abre
   as PPs dessa linha embaixo dela; clicar de novo fecha.
2. **Uma sublinha por PP**, como as sublinhas da planilha exportada
   (decisão 088): `↳ PP-00214 · Pago — Viagem Itabira · hospedagem` —
   código, situação e serviço, em itálico e cinza. **Sem quem recebe**
   (fornecedor ou titular da verba): pedido do Tiago, 22/10/2026; o painel
   do item mostra. No Realizado, R$ Unit., QT, D/M e Total da PP; Orçado,
   Planejado e as rentabilidades ficam vazios.
3. **As mesmas PPs que somam o realizado**: toda PP não cancelada, a gerada
   inclusive (decisão 074). A soma das sublinhas é o total bruto da linha.
4. **Exibir › PPs › "PPs abertas em todas as linhas"** abre todas de uma
   vez; desligar fecha todas. Mudar a opção zera as setas abertas à mão. A
   opção só aparece quando o job tem PP, e nasce desligada: a planilha
   abre como antes.
5. **Job e financeiro:** a planilha é a mesma seção nas duas telas
   (`/jobs/[jobId]` e `/financeiro/jobs/[jobId]`). Na produção, clicar na
   sublinha abre o painel das PPs do item, o mesmo da trilha ("PPs · N").
   No financeiro, que não tem a trilha nem o painel da produção, a
   sublinha é só leitura.
6. **Na errata e no "Editar orçado" do financeiro as PPs ficam fechadas**:
   ali a linha está sendo reescrita e a errata arrasta linhas. A seta some,
   e o item do Exibir fica travado com a dica.

## Onde mora

| O quê | Onde |
|---|---|
| Seta, estado aberto/fechado e sublinhas | `jobs/[jobId]/realizado/job-item-realizado-table.tsx` (`SublinhasDasPPs`, `ppsAbertasAqui`, prop `ppsNasLinhas`) |
| Item do Exibir | `jobs/[jobId]/realizado/job-realizado-section.tsx` (`ppsNasLinhas`, `temPP`) |

- As sublinhas seguem as colunas da linha do item (Save, Orçado com ou sem
  moeda estrangeira, rentabilidades dentro dos blocos que as geram): a
  grade não desalinha com nenhuma combinação do Exibir.
- A trilha à direita remede quando as sublinhas abrem (`assinaturaDasPPs`
  nas dependências de `usePosicoesDaCalha`): sem isso as pílulas ficavam na
  altura antiga.
- Números da sublinha em `NUMEROS_PLANILHA.detalhe`, fundos e bordas de
  `blocos.ts` (regra das cores das planilhas).

## Fica para depois

Na planilha exportada a verba devolvida (prestação aprovada) e o BV
confirmado também entram como sublinhas, com valor negativo. Na tela ainda
não: numa linha com devolução aprovada, ou na vista Líquido com BV, a soma
das sublinhas é o bruto e o total da linha é o líquido.

## Conferido (23/10/2026, logado como administrador)

TES-1014/26, produção e financeiro: 4 linhas com seta e 8 sublinhas
(Produtor 250,00 + 6.000,00 = 6.250,00; Passagem 100,00 + 100,00 + 200,00 =
400,00, a linha com "—" na quebra); grade alinhada com Save e as duas
rentabilidades ligadas; trilha alinhada; o Exibir abre as 8 e fecha todas;
na produção a sublinha da PP-00146 abriu o painel da Passagem; no
financeiro a sublinha não abre nada; no "Editar orçado" as setas e as
sublinhas somem e voltam no "Descartar". Nada foi gravado.
