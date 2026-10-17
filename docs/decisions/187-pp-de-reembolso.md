# 187 — PP de reembolso: despesas com comprovantes e deslocamento com veículo próprio

**Data:** 2026-10-17
**Status:** aceita e implementada em 17/10/2026.
**Quem decidiu:** Tiago, em 16 e 17/10/2026, sobre o protótipo interativo
(seis versões, comentadas no próprio protótipo) e quatro perguntas
respondidas no chat.
**Relaciona-se com:** [164](164-verbas-de-alimentacao-e-transporte.md) e
[171](171-verba-de-producao-com-titular-e-conta-do-rh.md) (titular e conta do RH),
[081](081-a-producao-presta-contas-da-verba-e-o-financeiro-aprova.md) (prestação de contas,
que o reembolso **não** tem), [152](152-nf-do-fornecedor-com-cadastro-proprio.md)
(campos do anexo no envio) e [172](172-quarta-de-excecoes-na-pp-urgente.md) (quartas de
exceção, que a verba — e portanto o reembolso — acende).
**Migrations:** `20261017400001_documento_tipo_cupom_fiscal.sql` e
`20261017400002_pp_de_reembolso.sql`, aplicadas pelo MCP em 17/10/2026.

## O pedido

> "Estou pensando em adicionar um novo tipo de PP para reembolso (além da
> normal e de verba)."

E, na aprovação do protótipo (17/10/2026):

> "Vamos seguir com: 'Marcar Empilhado'. No caso de reembolso, o anexo deve
> ser obrigatório para o envio ao financeiro; o campo titular da verba se
> tornará titular do reembolso com a mesma base de colaboradores e freelas
> (só que sem a opção de colocar terceiros). Além disso, deve haver alguma
> maneira de selecionar reembolso de locomoção por transporte próprio
> (melhore o nome), onde deverá ser possível calcular o valor com o cálculo
> da planilha anexada."

A planilha é a "Reembolso de Gasolina" que o financeiro usa hoje: por
trajeto, km ida e volta × vezes; combustível = km ÷ consumo × preço do
litro; e um desgaste do veículo por km somado à parte.

## As respostas que fecharam a regra

1. **Desgaste por km:** R$ 0,40, fixo, e só o financeiro muda. — "Correto."
2. **Consumo e preço do litro:** informados em cada PP. — "Correto."
3. **Trajeto que paga só desgaste** (sem combustível): "por hora, vamos
   considerar que não". Não existe; se vier a existir, é uma coluna nova na
   linha do deslocamento.
4. **Anexo do veículo próprio:** obrigatório no envio, **sem tipo nem
   campos** — "poderá ser uma foto da quilometragem ou qualquer coisa que
   resolvam enviar para convencer o financeiro da ocorrência".

## A regra

### Três tipos de PP, um seletor

O formulário troca o switch "Verba" pelo seletor **"Marcar empilhado"**:
Normal · Verba · Reembolso, um embaixo do outro. Marcado "Verba", as três
verbas aparecem à direita como antes; marcado "Reembolso", aparece
**Despesas · Veículo próprio**.

### O que o reembolso herda da verba

No banco o reembolso é `verba_producao = true` com `tipo_verba =
'reembolso'` — o mesmo caminho de "pagar uma pessoa, não um fornecedor":

- **Titular do reembolso** com a lista da verba (colaboradores ativos do RH
  + freelas trabalhando), **sem "Terceiro (fornecedor)"** — a CHECK do
  banco recusa titular fornecedor no reembolso.
- O PDF sai com a conta, o PIX e o CPF da ficha do RH, copiados pelo mesmo
  gatilho da 171 (`trg_pp_foto_do_colaborador`).
- Sem fornecedor, sem NF de fornecedor registrada, fora da retenção e da
  remessa — como a verba.
- Acende as quartas de exceção (172), porque `ppAceitaQuarta` olha
  `verba_producao`.

### O que o reembolso NÃO herda

- **Não presta contas.** O dinheiro sai depois do gasto, com os
  comprovantes já na PP: `situacaoDaVerba` devolve nulo para o reembolso,
  o encerramento do job não espera prestação dele, e um gatilho
  (`trg_prestacao_recusa_reembolso`) recusa prestação de PP de reembolso no
  banco.
- **Leva anexo**, obrigatório no envio ao financeiro (e não na geração):

| Tipo | No envio ao financeiro |
|---|---|
| **Despesas** | Pelo menos 1 comprovante; cada um com **tipo** (Cupom fiscal, NF, Recibo ou Outro), **número**, **data da despesa** e **valor pago**; a **soma fecha o valor da PP**. |
| **Veículo próprio** | Pelo menos 1 arquivo (foto da quilometragem, print do mapa…), sem tipo nem campos. |

A regra mora em `lib/calculos/reembolso.ts` e roda no cliente e no
servidor (`enviarPedidoCompraAoFinanceiro` e `deixarPPProntaParaEnvio`).
"Cupom fiscal" é valor novo do enum `documento_tipo`, oferecido só nos
comprovantes do reembolso. Os comprovantes **não viram nota fiscal** do
módulo fiscal (o envio do reembolso não chama `ligar_notas`).

### Veículo próprio: a conta da planilha

O "Valor desta PP" vira a conta:

```
km     = Σ (km ida e volta × vezes)
valor  = km ÷ consumo × preço do litro  +  km × desgaste por km
```

arredondado no fim, e o trio da PP fica **total × 1 × 1**. Cada linha tem
data (até hoje), trajeto, km ida e volta e vezes.

- Consumo (km/l) e preço do litro: **por PP**.
- Desgaste por km: **do financeiro**, em Financeiro → Cadastros →
  "Reembolso de veículo próprio" (tabela `financeiro_parametros`; só
  administrador e financeiro gravam, pela tela e pela RLS; auditoria
  `financeiro_parametro.atualizado`).
- **A PP guarda o desgaste da data em que nasceu**
  (`reembolso_deslocamentos.desgaste_por_km`). Mudar o cadastro vale para
  as PPs novas; a edição de uma PP gerada mantém o dela.
- O servidor **refaz a conta** e recusa valor que não bata.

**A divergência da planilha de hoje:** nela o desgaste era digitado à parte
e não batia com os km dos trajetos (1ª aba: R$ 87,48 digitados × R$
85,80 dos 214,5 km; 2ª aba: R$ 63,32 × R$ 64,20). No sistema o desgaste
sai da mesma lista de trajetos. O combustível bate ao centavo com a
planilha nas duas abas (testes em `lib/calculos/reembolso.test.ts`).

## Onde aparece

- **Job:** formulário da PP (gerar, salvar a emitir, editar a gerada,
  cancelar e refazer), revisão antes de gerar, envio ao financeiro (painel
  do item e aba PPs), cartão da PP ("Reembolso — Nome"), lista da aba PPs
  ("Reembolso · Nome") e ficha da PP (tipo, deslocamentos, comprovantes com
  número, data e valor).
- **PDF:** "Titular do reembolso", "DADOS BANCÁRIOS DO TITULAR DO
  REEMBOLSO", tabela "DESLOCAMENTOS COM VEÍCULO PRÓPRIO" com a conta por
  extenso, natureza e assinatura do titular do reembolso.
- **Financeiro:** selo "Reembolso" na lista de PPs, "Reembolso — Nome" nos
  títulos, e no dossiê o bloco "Reembolso" (tipo e resumo dos
  deslocamentos) e os comprovantes com tipo, número, data e valor — sem o
  bloco de prestação de contas.

## Banco

| Objeto | O quê |
|---|---|
| `pedidos_compra.tipo_verba` | aceita `'reembolso'` |
| `pedidos_compra.reembolso_tipo` | `'despesas'` \| `'veiculo_proprio'`; nulo fora do reembolso |
| `pedidos_compra.reembolso_deslocamentos` | jsonb `{consumo_km_l, preco_litro, desgaste_por_km, linhas:[{data, trajeto, km_ida_volta, vezes}]}`; só no veículo próprio |
| `chk_pp_reembolso` | coerência das três colunas |
| `chk_pp_verba_coerencia`, `chk_ppae_verba` | ganharam o 4º ramo (reembolso: titular colaborador ou freela, sem fornecedor nem responsável) |
| `pp_prestacao_recusa_reembolso()` + gatilho | recusa prestação de contas de reembolso |
| `financeiro_parametros` | `reembolso_desgaste_por_km` = 0,40 por tenant; RLS, GRANT para `authenticated`, nada para `anon` |
| `documento_tipo` | valor novo `cupom_fiscal` |

A PP a emitir guarda o tipo e os deslocamentos dentro de `dados`. Tudo
aditivo: as CHECKs só ganharam um ramo, e nenhuma linha existente mudou.

## Conferido

No TES-1001/26 (projeto TES-P001/26), como administrador, com o
colaborador de teste do RH como titular:

- **PP-00250**, veículo próprio, 2 deslocamentos (55 km × 2 e 40,1 km),
  10 km/l, R$ 7,09: 150,1 km → combustível R$ 106,42 + desgaste R$ 60,04 =
  **R$ 166,46** na tela, no banco e no PDF; gerada sem anexo; envio sem
  anexo recusado; edição reabre com os deslocamentos e refaz o PDF.
- **PP-00253**, despesas, R$ 150,00: gerada sem comprovante; envio recusado
  sem campos e com soma R$ 140,00 (na tela **e** chamando a action direto,
  sem o cliente); enviada com cupom fiscal R$ 100,00 + recibo R$ 50,00; no
  financeiro, selo, dossiê e comprovantes certos.
- Desgaste por km mudado para R$ 0,45 e de volta para R$ 0,40 pela tela,
  com autor e auditoria.
- As duas PPs foram canceladas pela tela no fim.

## Fica para depois

- Trajeto que paga só o desgaste (resposta 3: "por hora, não").
- A conta dos freelas: o titular freela segue sem conta no PDF até a
  tabela `freelancers` do RH ter dado (ver a 171).
