# 230 — Mútuo entre empresas

**Data:** 2026-10-31
**Status:** aceita e implementada em 31/10/2026, em duas etapas: o mútuo e a Apuração do IOF.
**Quem decidiu:** Tiago, ao aprovar o protótipo em 31/10/2026 ("Ok. Aprovado, vamos implementar").
**Revê:** a [124](124-recebimento-avulso-transferencia-e-rendimento.md), D4: entre CNPJs diferentes o dinheiro muda de dono, e agora isso tem nome.
**Migrations:** `20261031100001` (origens do lançamento), `20261031100002` (estrutura e funções) `20261031100003` (IOF e saídas da abertura), `20261031100004` (o IOF na Apuração), `20261031100005` (o trimestre do IOF), `20261102100001` (o IOF que já está no histórico), `20261102100002` (a abertura volta a 30/09) e `20261102100003` (a guia presa à linha do banco).

## O problema

A conciliação de outubro tinha dinheiro entre CNPJs do grupo que a transferência recusa. O saldo de quem deve a quem vivia em fórmulas à mão na planilha, uma por previsão.

## O que é um mútuo

Dinheiro emprestado entre empresas. Pessoa física não usa mútuo: segue no Tipo `EMP` da planilha, pelo avulso, acima do Lucro líquido.

Na DRE e no fluxo da planilha, as linhas `(−) MÚTUO INTERNO` e `(+) MÚTUO INTERNO` existem desde 2015. Na DRE ficam abaixo do Lucro líquido e acima do Reinvestimento.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Onde mora | Em `transferencias_contas`, com `tipo = 'mutuo'` e código `MU-00001`. É a mesma mecânica da transferência: título, baixa, cancelar, excluir e Conciliação |
| D2 | Pernas | Origem própria (`mutuo_saida`, `mutuo_entrada`), com empresa, Tipo 12 · 998 Mútuo interno e regional vazia, que é TD |
| D3 | Devolução | Um mútuo no sentido contrário. Um saldo por par de empresas |
| D4 | Trimestre | O do mútuo original, não o da data. Um só para as duas pernas, com a sugestão do par e troca à mão. O ano também é do Tipo: a volta de um mútuo de 2025 cai na DRE de 2025 |
| D5 | Saldo de abertura | Pela planilha, em 30/09/2026, em `mutuos_saldo_abertura`. Não mexe em DRE, fluxo nem banco |
| D6 | IOF | Como a planilha, por conta: California junto do mútuo (Tipo 12, abaixo do lucro), GoCrazy em 03 · 007 IOF do mútuo, regional SS. Entra pela linha do banco, e "Referente a" é opcional. Com ele preenchido, fica no trimestre do mútuo, como a planilha. Fica nas nossas contas, sem cobrar da outra parte. A guia que já está no histórico da planilha não é lançada de novo: `mutuos_iof_historico` marca a linha do banco, e a tela soma o valor dela no IOF do par |
| D7 | Juros | Campo opcional, no mútuo e no saldo de abertura. Vazio é sem juros. Só informa: nada é lançado até o dinheiro passar pelo banco |
| D8 | Empresa de fora | Não entra como empresa do sistema. Cadastro em Fornecedores com `empresa_de_fora`, uma perna só e bloco próprio na tela de mútuos. A volta prevista é um título a receber |
| D9 | Quem lança | Admin e financeiro, como a transferência |
| D10 | Empresa gerencial da perna | A conta bancária não tem empresa (decisão 064). A gerencial vem do CNPJ, em `empresas_contabeis.empresa_gerencial_id`: California e GoCrazy entram na Agência California, Hitlab na Hitlab |

## O reconhecimento pela linha do banco

É o último passo do motor, só na linha sem correspondência:

1. Procura a linha oposta, mesmo valor, até 1 dia, pendente, em conta de outro CNPJ.
2. Sem ela, o crédito se reconhece pelo CNPJ que o PIX traz no histórico. O débito não diz o destino: fica em "Sem correspondência", e o "Lançar avulso" oferece o mútuo.
3. Se já há mútuo sem linha por perto, não oferece outro.

Se quem paga é quem deve, a linha aparece como "Devolução de mútuo". Se houver previsão do mesmo mútuo, a linha a baixa em vez de criar outro.

## A Apuração do IOF

Só o IOF do mútuo tem guia nossa: quem concede o crédito recolhe (Decreto 6.306/2007, art. 5º, III). Câmbio, cartão e crédito de banco são cobrados pelo banco.

- **Uma guia por CNPJ que emprestou e por mês,** só para empresa de fora. Nos mútuos do grupo nada é apurado por enquanto, seguindo os registros.
- **Base:** a soma dos saldos de cada dia (art. 7º, I, "a"), a 0,0082% ao dia.
- **Adicional:** 0,38% sobre o que aumentou o saldo no mês (art. 7º, § 16): as saídas e os juros que entraram nele.
- **Vencimento:** 3º dia útil depois do dia 10 do mês seguinte (art. 10). A primeira guia real é a de outubro, com vencimento em 13/11.
- **Vale o valor da guia.** O calculado fica ao lado, com o motivo da diferença. Essa diferença mês a mês é a calibragem que o Tiago quer ver.
- **Juros:** o campo mostra os juros até hoje e entra na base, sem lançar nada até o dinheiro passar pelo banco.
- **Baixa:** o centro vem do CNPJ, como D6. A guia paga soma no IOF do par.
- **Guia aprovada com valor errado:** o Corrigir de Impostos a Pagar passa a ter botão, em "Corrigir o valor". Antes ele existia, mas nenhuma tela o abria.
- **Código 1150:** tomador pessoa jurídica, segundo fontes não oficiais. A confirmar com a contabilidade.
- **Só o regime mensal.** Mútuo com valor fixo em contrato tem IOF na entrega do dinheiro (art. 10, VII) e fica para quando aparecer.

## O que ficou de fora

- **"Abate qual mútuo":** não entra. Cada devolução abate a saída mais antiga, por regra automática. O vínculo pode ser calculado a qualquer momento, e um campo de escolha única não cobre uma volta sobre duas saídas.
- **Lançamento de juros:** o campo só informa e alimenta a base do IOF.
- **DRE:** só lê `historico_movimentos`. Lançamento novo, inclusive mútuo, não chega nela.
- **Mútuos do grupo sem IOF:** seguem os registros, com o campo vazio. Está com a contabilidade.
- **Notas de sócio da GoCrazy:** outra entrega. Não abatem saldo de mútuo.
- **Saldos no razão:** o novo plano de contas, em partidas dobradas, vai ler estes mútuos como documento.
