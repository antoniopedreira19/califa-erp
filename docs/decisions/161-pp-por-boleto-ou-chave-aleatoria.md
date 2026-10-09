# 161 — A PP paga por boleto ou chave aleatória, e o fornecedor pode não ter conta nem PIX no cadastro

**Data:** 2026-10-09
**Status:** aceita e implementada (09/10/2026).
**Quem decidiu:** Tiago, em 09/10/2026, sobre o protótipo "Boleto e chave aleatória" (2 rodadas).
**Revê:** a [127](127-pp-com-pagamento-fora-do-cadastro.md) (as opções fora do cadastro e o motivo) e a [137](137-fora-do-cadastro-visivel-e-pago-pela-remessa.md) (a remessa não paga boleto).
**Completa:** a [150](150-cadastro-de-veiculos.md) (o veículo usa o mesmo formulário do fornecedor) e a [152](152-nf-do-fornecedor-com-cadastro-proprio.md) (as regras de anexo no envio).
**Migration:** `20261009200001_boleto_e_chave_aleatoria.sql`.

## O que aconteceu

O Tiago foi avisado de fornecedores sem meio de pagamento fixo: na hora de
cobrar, eles mandam um boleto ou uma chave PIX aleatória temporária. O
formulário da PP oferecia "Outro PIX" (qualquer tipo de chave) e "Outra
conta", e o cadastro de fornecedor exigia conta ou PIX. Ao mesmo tempo, a
produção achava que só dava para cadastrar conta OU PIX, porque os dois
ficavam em abas. O banco confirmou: dos 49 fornecedores ativos em
09/10/2026, 8 tinham conta e PIX, 31 só PIX e 10 só conta. Nenhuma PP usou
"Outra conta"; só a PP-00102, de teste, usou chave aleatória fora do cadastro.

## A regra

1. **O campo Pagamento da PP** passa a ser `Cadastro do fornecedor | Chave
   aleatória | Boleto`. "Outra conta" saiu.
   - **Chave aleatória**: um campo só, que aceita apenas chave aleatória
     (o formato do DICT, conferido como no cadastro — decisão 101).
   - **Boleto**: nenhum campo no formulário. O boleto vai nos anexos, com o
     tipo Boleto.
2. **Sem motivo.** O motivo do pagamento fora do cadastro saiu da tela: o
   motivo é o meio que o fornecedor escolheu. As PPs anteriores guardam o
   motivo que tinham, e as telas o mostram quando existe.
3. **"Sem conta nem PIX no cadastro"**: marcação nova no cadastro de
   fornecedor e de veículo (página, "+" da PP e pop-up da mídia). Marcada,
   o cadastro não guarda conta nem chave PIX — os dois blocos ficam
   apagados e o salvar grava os dois vazios. Se havia algo digitado, um
   aviso diz que vai sair.
4. **Fornecedor marcado, na PP**: "Cadastro do fornecedor" fica riscado e a
   PP só sai com chave aleatória ou boleto. Salvar, gerar e o servidor
   recusam sem um dos dois.
5. **Boleto exige o boleto e a nota no envio.** Com Boleto escolhido, os
   anexos do formulário e do pop-up de envio mostram "Exigidos no envio: NF ·
   Boleto", com ✓ em cada um que já tem arquivo do tipo. O envio ao
   financeiro (e o "Deixar pronta para envio", decisão 160) recusa sem o
   anexo do tipo Boleto e sem a nota — NF, ou recibo, que é o documento
   fiscal da pessoa física. As demais regras do envio (decisão 152) seguem
   como eram.
6. **O PDF da PP não muda de desenho** (regra da 127): na chave aleatória,
   a linha do PIX traz a chave escolhida; no boleto, a linha do PIX vira
   **"Pagamento: Boleto"**. O resto da faixa de dados bancários continua o
   do cadastro.
7. **Conta e PIX à vista no cadastro**: as abas viraram dois blocos,
   "Conta bancária" e "Chave PIX", cada um com o selo "preenchido". A
   descrição diz "Cadastre conta e PIX sempre que houver; uma das duas já
   basta". O veículo continua com o pagamento opcional (decisão 147).
8. **A Empresa emissora vem antes do Fornecedor** no formulário da PP (e
   antes do Responsável, na verba de produção): primeiro quem contrata,
   depois quem recebe.
9. **O "X" do pop-up "Novo fornecedor"** caía em cima do seletor PJ/PF. O
   cabeçalho reserva o espaço dele — no pop-up do fornecedor e no do
   veículo da planilha de mídia, que tem o mesmo cabeçalho.

## Onde a regra mora

| Parte | Arquivo |
| --- | --- |
| Marcação no cadastro, trava no banco | migration `20261009200001`: `fornecedores.sem_dados_pagamento` + CHECK `fornecedores_sem_dados_pagamento_vazio` |
| Meio `boleto`, motivo opcional | mesma migration: CHECKs `pp_fora_do_cadastro_meio_valido`, `_motivo` e `_formato` (o `conta` continua aceito para o legado) |
| Só chave aleatória ou boleto, sem motivo | `lib/validations/pagamento-fora-do-cadastro.ts` |
| Cadastro: marcação zera conta e PIX | `lib/validations/fornecedores.ts` (`sem_dados_pagamento`), `app/(app)/fornecedores/actions.ts` |
| Fornecedor marcado só sai com chave ou boleto | `finalizarPedidoCompraImpl` em `actions-pp.ts`; o resumo do cadastro (`resumoDoPagamentoDoFornecedor`) devolve `semDadosPagamento` |
| Boleto exige boleto e nota | `faltaNosAnexosDoEnvio` (servidor) e `faltaNosAnexosParaEnviar` + `ExigidosNoEnvio` (`anexos-da-pp.tsx`) |
| Foto do pagamento | `lib/data/foto-pagamento-da-pp.ts`: no boleto a foto é o cadastro, e o asterisco da 067 não acende |
| PDF | `lib/pdf/pedido-compra.ts` (`pagamentoPorBoleto`) |
| Remessa | `actions-cnab.ts` recusa a parcela ("pague pelo boleto anexado"); a lista da remessa nem a mostra (`contas-a-pagar/page.tsx`) |

## As telas do financeiro

O cartão "Fora do cadastro" (dossiê, Ver PP, baixa) mostra "Boleto · Pagar
pelo boleto anexado", e a marcação de aprovação continua obrigatória
("Aprovar pagamento fora do cadastro"). A linha do motivo só aparece nas PPs
antigas que o trazem. Título de PP por boleto não entra na baixa em lote
(como toda PP fora do cadastro, decisão 137) nem na remessa.

## O que ficou de fora

- **A remessa não paga boleto**: o gerador CNAB ainda não tem o segmento J.
  A PP paga por boleto é paga pelo arquivo anexado.
- **A aprovação não preenche "Como vai ser pago"** com Boleto sozinha: o
  financeiro escolhe, como antes.
- **O vencimento do boleto** continua nas janelas de pagamento (decisão
  077). Boleto que vence antes da janela usa o "Pagamento urgente".
- **A lista de Veículos**: o selo "Sem pagamento" não aparece no veículo
  marcado "Sem conta nem PIX", porque o cadastro dele está completo.

## Como foi testado (09/10/2026)

No sistema, pelo servidor do worktree, logado como o Tiago, no job
TES-1025/26 (projeto TES-P001/26):

- Fornecedor Teste (PIX e-mail): Boleto escolhido → "Exigidos no envio: NF ·
  Boleto" → PP-00149 gerada com meio `boleto`, motivo vazio e a foto do
  cadastro; o PDF saiu com "Pagamento: Boleto". No envio, sem arquivo trava
  como antes; só com o boleto, pede a NF. Pela action direta (sem a tela),
  `enviarPedidoCompraAoFinanceiro` e `deixarPPProntaParaEnvio` recusaram só
  boleto ("Anexe também a NF…") e só NF ("Esta PP é paga por boleto…").
- ZZ Veículo Teste 150 A: marcado "Sem conta nem PIX" pelo formulário
  (coluna e auditoria gravadas), reativado para o teste. Na PP, "Cadastro do
  fornecedor" riscado; salvar sem escolher trava na tela; pela action, gerar
  sem meio e com chave CPF foram recusados; com chave aleatória gerou a
  PP-00150.
- Limpeza: PP-00149 e PP-00150 canceladas, o arquivo de teste do envio
  removido do Storage, e o veículo devolvido (desmarcado e inativo).
- `npm run test:foto-pp` (10), `test:cnab-fora` (5) e `test:cnab` (22)
  passam; tsc e lint limpos.
