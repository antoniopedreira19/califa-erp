# 033 — A descrição da NF vem do GP, e o CNAE vem do financeiro

**Data:** 2026-08-31
**Decidido por:** Tiago

Primeira das três entregas da reforma de Contas a Receber. As outras duas
— a aba Faturamento e a aba Títulos a Receber — dependem desta, porque é
aqui que nasce o dado que o botão de informações mostra.

---

## 1. O campo errado estava na mão errada

O envio para faturamento pedia o **CNAE** ao gerente de projetos. CNAE é
classificação fiscal da nota, e quem emite a nota é o financeiro. O GP não
tem como saber qual usar, e na prática digitava qualquer coisa para o
formulário deixar enviar — o campo era obrigatório.

O que o GP **tem** para dizer é como o cliente exige que a nota seja
descrita. Sem isso a nota volta e o recebimento atrasa. Esse texto viajava
por fora do sistema, em mensagem ou e-mail, e o financeiro escrevia de
memória.

Os dois trocaram de lugar:

| Campo | Antes | Agora |
| --- | --- | --- |
| **Descrição da NF** | financeiro escrevia do zero no drawer | GP manda no envio; o financeiro recebe pronto |
| **CNAE** | GP informava no envio, obrigatório | financeiro informa no drawer "Faturar", obrigatório |

## 2. Onde cada um mora no banco

- `jobs_envio_faturamento.descricao_nf` — **novo**, aceita nulo. Os envios
  anteriores a 31/08/2026 não têm o que preencher, porque o campo não
  existia. A obrigatoriedade vale para envio NOVO e é imposta no servidor,
  pelo `envioFaturamentoSchema`, não pelo navegador.
- `jobs_envio_faturamento.cnae` — **perdeu o `not null` e o CHECK**. O que
  já estava gravado continua lá: é o registro do que a produção declarou, e
  serve de rastro. Só deixou de ser exigido.
- `faturamentos.cnae` — **novo**, `not null` com CHECK de não-vazio. A
  trava é do banco de propósito: CNAE errado é problema fiscal, e regra
  crítica não vive só no navegador (`CLAUDE.md`).

O `emitir_faturamento` monta o INSERT com a lista de colunas explícita,
então precisou ser reescrito para passar o CNAE — sem isso o `not null`
barraria toda emissão. A checagem sai antes de qualquer escrita, para o
erro aparecer em português em vez de vazar como violação de constraint.

**Backfill das notas existentes.** As duas notas emitidas até aqui nasceram
antes do campo e receberam o marcador `NAO INFORMADO — nota anterior a
31/08/2026`. Marcador explícito, e não um código plausível: um número
inventado seria lido como dado real por quem abrisse a nota depois. A base
é de teste e será zerada antes da implantação — o que precisa estar certo
agora é a lógica.

## 3. A descrição pré-preenchida, e por que a agrupada nasce em branco

No drawer "Faturar":

- **Job único** — o campo nasce com a instrução que o GP mandou. Sem
  instrução (envio antigo, ou BV, que não tem envio) cai no nome do job,
  que era o que a tela sugeria antes.
- **NF agrupada** — nasce **em branco**. Cada job tem a sua instrução, e
  emendar as três produziria um texto que nenhum dos clientes pediu. Quem
  emite lê uma a uma pelo botão de informações da linha do job e escreve a
  descrição da nota.

## 4. O botão de informações nasce no drawer

O `i` de cada job aparece primeiro **dentro do formulário de faturar**, e
não só nas tabelas: a instrução do GP precisa poder ser lida na hora de
escrever a descrição da nota. Na agrupada, um por linha de job.

Ele abre `components/financeiro/info-faturamento-modal.tsx`, que é o mesmo
componente que as duas abas vão usar — bloco repetido é bloco que diverge,
como as cores das planilhas já mostraram
(`docs/09-identidade-visual-ui.md`). O modal tem quatro blocos: PO,
descrição de NF, composição do valor (só quando há saldo em save) e
contatos de cobrança.

A **composição job × save** saiu da coluna Valor da aba Faturamento e veio
para cá: lá ela disputava espaço com o número que a coluna existe para
mostrar. A regra continua a da [028](028-save-entre-jobs.md) — job
primeiro, e o que passar dele é crédito do cliente.

## 5. O que o protótipo não tinha

O handoff `Contas a Receber - Faturamento Agrupado.dc.html` não previa nem
o campo de CNAE no drawer nem o bloco de composição no modal. Os dois
entraram por decisão do Tiago em 31/08/2026, e o protótipo é que está
desatualizado nesses dois pontos.

## 6. O BV, e onde o botão `i` fica (entrega 2)

`vw_faturamento_pendente` ganhou `job_id` e, no ramo do BV, `codigo`
deixou de ser nulo: BV sempre pertence a um job, e o caminho
`itens_bv.job_item_orcado_id → jobs_itens_orcado.job_id` já existia
preenchido em 100% dos casos. `origem_id` **não** mudou — continua sendo o
id do BV, que é o que o item da nota aponta.

**O `i` do BV nomeia o job e explica cada vazio.** PO, instrução do GP e
contato de cobrança são todos do JOB, e o BV é cobrado do FORNECEDOR.
Mostrar o contato do cliente numa linha que se cobra do fornecedor seria
errado; esconder o bloco não diria por quê. Então cada vazio tem a sua
frase.

**O botão fica na calha nas duas abas**, fora do frame da tabela, como o
"Gerar PP" da planilha interna. O protótipo desenhou o da aba Faturamento
dentro de uma coluna de 44px — é o terceiro ponto em que ele está
desatualizado.

## 7. Inadimplência (entrega 3)

Inadimplente é o título que passou do **vencimento** sem ser recebido. A
previsão nasce igual ao vencimento, continua editável, e — passado o
vencimento sem repactuação — rola sozinha para o mesmo dia da semana na
semana seguinte, toda semana, enquanto o título não for pago.

`titulos_receber.inadimplente_desde` guarda o dia do primeiro atraso e
**sobrevive ao pagamento**: um status sozinho viraria `pago` na baixa e
levaria a informação embora, e o relatório não conseguiria mais listar
quem atrasou. A rotina diária é
`rolar_previsao_de_titulos_vencidos()`, no cron das 06:00 UTC.

**A tela não depende da rotina.** A pastilha "Inadimplente" e o "N dias de
atraso" derivam de `data_vencimento < hoje`. Cron que falha não faz a aba
mentir; só atrasa o registro histórico.

**O valor `inadimplente` NÃO entrou no enum**, e isso está aguardando
decisão. Medido antes de mexer, ele quebraria cinco objetos do banco e três
do código — entre eles `dar_baixa_titulo_com_plano`, que recusa
`status <> 'em_aberto'` e faria a baixa parar justamente no inadimplente, e
`vw_fluxo_caixa`, que sumiria com ele do fluxo de caixa. O
`inadimplente_desde` entrega o relatório sem esse risco.

## 8. A aba Títulos a Receber, e a quinta divergência do protótipo

Chips de status com contagem, pastilha vermelha com os dias de atraso,
jobs cobertos sem repetição, contatos fora da célula, botão `i` na calha e
"Baixar" renomeado para "Dar baixa".

A linha já recebida ganhou o **botão de olho**, que abre a baixa
registrada com o estorno em dois tempos — a mesma reversão da decisão
016 §9 que Títulos a Pagar já tinha feito em 18/08/2026. O protótipo mostra
só o texto "Conciliação" ali: é o quarto ponto em que ele está
desatualizado, e o Tiago avisou disso ao entregar o arquivo.

`BaixaRegistradaDialog` ganhou `sentido?: "pagar" | "receber"`, que troca
apenas três frases. O padrão é `"pagar"`, então Contas a Pagar não mudou.

Uma ideia registrada e **não** implementada: uma PO pode se referir a mais
de um job, e hoje isso é o mesmo texto digitado em N envios. Um cadastro de
PO de verdade, com os jobs pendurados nele, ficou de fora por ora — pode
voltar.
