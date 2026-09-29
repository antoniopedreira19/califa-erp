# 123 — O envio para faturamento vira notas fiscais

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migrations:** `20260929500001_envio_faturamento_em_notas_fiscais.sql` e
`20260929500002_nota_emitida_guarda_cnpj_e_agrupa_por_cnpj.sql`.
**Protótipo aprovado:** https://claude.ai/artifact/V7ki1mCF23ok99yDD8imJV

---

## 1. O pedido

O envio do job para faturamento era um drawer com um valor, uma descrição
da nota, uma PO e N parcelas — e cada parcela virava uma nota própria. O
Tiago pediu, por nota fiscal, **CNPJ, valor, vencimento, CNAE sugerido
(opcional) e descritivo (opcional)**; a possibilidade de dividir o job em
**várias notas**, além das parcelas; e a de **revisar e acrescentar os
contatos de cobrança** que a abertura registrou. Achou que era informação
demais para um drawer — e era.

## 2. As regras

| Ponto | Decisão |
|---|---|
| Formato | Pop-up centralizado em duas colunas: as notas à esquerda; valor total, divisão entre as notas, PO, anexos, portal e contatos fixos à direita. |
| CNPJ | Do **cliente tomador**. Campo livre por nota, que nasce com o CNPJ do cadastro do cliente. Sem cadastro de vários CNPJs por cliente por enquanto (clientes chegam a ~20 CNPJs; a lista pode nascer um dia do histórico dos envios). |
| Parcela | **Uma nota, vários vencimentos.** A parcela deixou de ser nota própria. |
| D1 · Contatos | O que mudar no envio vale para o job — é a mesma lista que o financeiro lê —, com auditoria do antes e do depois. |
| D2 · Descritivo | Opcional. Nota sem descritivo, o financeiro escreve na emissão. Revê 31/08/2026, quando a descrição entrou obrigatória no lugar do CNAE. |
| D3 · CNAE sugerido | Chega no "CNAE a ser utilizado" do Faturar como **texto de fundo**, sem preencher. O campo continua obrigatório e o financeiro escolhe e confere. No futuro o Tiago cadastra os CNAEs de cada CNPJ para escolher numa lista. |
| D4 · Nota agrupada | Só junta o que for do mesmo cliente **e** do mesmo CNPJ. Uma nota não sai para dois tomadores. |
| D5 · PO e portal | Um por envio. Envios diferentes podem citar a mesma PO: o número não é único. |
| D6 · Valores | Todas as notas se digitam, com o aviso "a soma não fecha", como as parcelas. O envio só sai quando a soma bate com o total. |
| D7 · Mensal | O mesmo formulário serve para o envio de cada mês (078), com o valor do mês e o vencimento em branco. |
| Nota emitida | Guarda o CNPJ para o qual saiu (`faturamentos.cnpj_tomador`). |
| Anexos da PO | Opcionais, **vários arquivos**, PDF ou imagem (PNG/JPG), até 10 MB cada. |

## 3. Como ficou

**Banco (`...500001`):**
- `jobs_envio_faturamento_notas` — uma linha por nota: ordem, CNPJ (14
  dígitos), CNAE sugerido, descritivo. **Sem coluna de valor**: o valor da
  nota é a soma das parcelas dela.
- `jobs_envio_faturamento_parcelas.nota_id` — a parcela é um vencimento da
  nota. Continua sendo **a unidade de saldo** do financeiro
  (`faturamento_itens.envio_parcela_id`).
- `jobs_envio_faturamento_anexos` + bucket `envios-faturamento`
  (`{tenant}/{job}/{uuid}-{nome}`). O navegador sobe o arquivo direto ao
  Storage, como a importação (110): Server Action tem teto de 1 MB.
- `enviar_job_para_faturamento` grava envio, notas, parcelas, anexos e a
  lista de contatos numa transação só. **Aceita também o payload antigo**
  (parcelas + descrição), porque a migration vale para o app no ar antes
  do deploy: no antigo, cada parcela vira uma nota — o que ela significava.
- As guardas da 117 valem nas tabelas novas: nota e anexo só nascem junto
  do envio; alterar nota é do financeiro; ninguém apaga pela API. Um
  gatilho confere que a parcela aponta para uma nota do mesmo envio.

**Banco (`...500002`):**
- `faturamentos.cnpj_tomador`, preenchido por `emitir_faturamento`: o CNPJ
  das notas do envio que a nota cobre; na avulsa, o do cadastro; no BV,
  nulo. As notas anteriores ficam nulas — saíram para o CNPJ do cadastro
  da época, e gravar o de hoje poderia registrar um CNPJ que mudou.
- `emitir_faturamento` recusa nota que cubra parcelas de CNPJs diferentes
  (D4), com os CNPJs na mensagem.
- `vw_faturamento_pendente` ganha, no fim, a nota de cada parcela: id,
  posição, total de notas do envio, CNPJ, CNAE sugerido e descritivo.

**Jobs:** `enviar-faturamento-dialog.tsx` substitui
`enviar-faturamento-drawer.tsx`. A barra do job diz "N notas fiscais, 1º
vencimento em …", e o "Ver envio" mostra cada nota (CNPJ, valor,
vencimentos, CNAE, descritivo) e abre os anexos da PO.

**Financeiro:**
- A aba Faturamento junta as parcelas de uma nota numa linha só, com o
  CNPJ embaixo do cliente, a coluna **Nota** (1/2, "2 venc.") e o
  vencimento "até …" quando a nota tem mais de um.
- O Faturar de uma nota do envio nasce com um título a receber por
  vencimento, o descritivo da nota na descrição e o CNAE sugerido de fundo.
- O Faturamento Agrupado recusa CNPJs diferentes antes de abrir.
- O botão `i` mostra CNPJ, CNAE sugerido, descritivo da nota e os anexos da
  PO, que também aparecem em Títulos a Receber.

## 4. O que não mudou, de propósito

A parcela continua a unidade de saldo. Por isso ficaram intactos o saldo e
a trava da emissão, `job_esta_faturado`, `save_rateio_das_notas` (a
divisão job × save por parcela), o fluxo de caixa e a edição do orçado
pelo financeiro (115), que reescreve o valor das parcelas — e a nota, que
não tem valor próprio, acompanha.

## 5. Conferência (29/09/2026)

- **Banco, em transação desfeita:** envio com 2 notas, 3 parcelas, anexo e
  2 contatos; anexo fora da pasta do job recusado; CNPJ fora do formato
  recusado; nota cobrindo 2 CNPJs recusada com a mensagem; nota de uma nota
  do envio com 2 vencimentos gravou `cnpj_tomador` e 2 títulos.
- **Tela, envio real no TES-1013/26** (projeto de teste TES-P001/26):
  2 notas (CNPJ do cadastro R$ 1.000,00; 11.222.333/0001-81 R$ 391,82 em 2×),
  PO com 1 PDF, 1 contato novo. Gravou notas, parcelas, anexo no Storage,
  contatos e as duas auditorias (`job.enviado_para_faturamento`,
  `job.contatos_cobranca_alterados`). "Ver envio" abre o PDF. Financeiro:
  2 linhas na fila, o agrupado recusa os 2 CNPJs, o Faturar da nota 2
  abre com 2 vencimentos e "Sugerido pelo GP: 7311-4/00" de fundo.
- Saídas do pop-up (X, Cancelar, Esc) fecham e o preenchimento continua ao
  reabrir.
- **Não emitido:** nenhuma NF real saiu da tela nesta conferência; a
  emissão com o CNPJ foi conferida no banco (transação desfeita).
