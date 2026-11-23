# 271 — O controle único de NFs: a seção Notas Fiscais e os seis pontos

**Data:** 2026-11-23
**Status:** aceita em 23/11/2026; revista no mesmo dia (protótipo v7 a
v10): a aba "Recebidas" passou a "Tomadas", o ponto 6 é feito na própria
tabela, as perguntas do ponto 6 foram respondidas e a tela ganhou CNAE,
retido, os dados da leitura da NF e a visão Impostos. O ponto 3 está
implementado (decisão [269](269-nf-da-prestacao-entra-no-cadastro-no-envio.md));
a seção Notas Fiscais está implementada desde 23/11/2026 (Emitidas,
Tomadas, navegador de período, visão Impostos e a leitura da NF pela IA;
ver "Implementação" no fim) e o ponto 6 ("Editar registro", com os ajustes
4 e 6c) também, no mesmo dia; os pontos 1 e 2 aguardam a implementação; o ponto 5 vai junto com a revisão das retenções;
o ponto 4 não pede nada.
**Quem decidiu:** Tiago, sobre o protótipo "Notas Fiscais" da Central
Financeira (v3 a v14, 23/11/2026), com um seletor por ponto:
https://claude.ai/artifact/2JLetfAPvFHaNr9kZJKX5f.
**Relaciona-se com:** [152](152-nf-do-fornecedor-com-cadastro-proprio.md)
(cadastro único de notas), [189](189-prestacao-de-contas-da-verba-documento-a-documento.md)
(prestação da verba), [187](187-pp-de-reembolso.md) (PP de reembolso),
[264](264-desembolso-com-comprovante-e-nf.md) (desembolso, que deixou estes
pontos para cá) e [269](269-nf-da-prestacao-entra-no-cadastro-no-envio.md).

## Onde fica

Uma seção própria na Central Financeira, **Notas Fiscais**
(`/financeiro/notas-fiscais`), com duas abas:

- **Emitidas** — as NFs que as empresas da California emitem (faturamento,
  BV, save, avulsa e o histórico da planilha).
- **Tomadas** — as NFs emitidas contra as empresas da California, de todas
  as origens: PP, desembolso, prestação da verba, folha PJ, avulsas e
  recorrências. É o controle único de NFs. O nome era "Recebidas"; o Tiago
  trocou porque confundia com recebimento, e é o contrário (são as notas
  que nós pagamos). "Tomadas" é o termo fiscal (serviços tomados) e
  combina com a coluna "CNPJ tomador".

Cada aba é uma tabela com os dados registrados de cada NF, com filtro por
período, por CNPJ e por coluna. O **Valor vem logo depois da NF**.

- **Emitidas:** NF (com a série), Valor, Emissão, CNPJ emissor, Tomador,
  CNAE, Job, Origem, Retido (o que o cliente reteve nas baixas) e
  Recebimento.
- **Tomadas:** NF, Valor, Emissão, Emitente, CNAE (o da nota; sem ele, o do
  cadastro do emitente, marcado), CNPJ tomador, Origem · Documento, Retido
  (as retenções destacadas na NF), Situação e Pagamento.
- **O painel da nota tomada** mostra também o que a leitura da NF traz:
  descrição do serviço, CNAE, regime do emitente, município da prestação,
  competência, código de verificação, as retenções e o valor líquido. Hoje a
  IA lê só número, emissão, valor, os CNPJs, as razões sociais e a
  descrição (que é descartada): os outros dados pedem a leitura ampliada e
  colunas novas na nota.

## A navegação: o navegador de período

Sem "De" e "Até". No lugar, **‹ Novembro de 2026 ›** com **Mês, Trimestre,
Ano e Tudo**: as setas andam um mês, um trimestre ou um ano, "Este mês"
volta ao atual, e **Tudo** mostra todas as notas, sem período. As duas abas
**abrem em Tudo** (pedido do Tiago); o recorte é escolha de quem olha. Escolhido
pelo Tiago entre três formas (abrir no pendente sem data, como os Títulos
a Pagar; este navegador; e o De/Até de antes). Na implementação, o "Tudo"
das Emitidas inclui o histórico da planilha (3.674 notas em 23/11): a lista
precisa do mesmo corte das listas grandes.

O valor da NF que não está inteiro em documentos aparece embaixo do valor
como **"falta lançar R$ X"**, e a dica diz quanto cada documento cobre.

## Os impostos de cada NF: a visão Impostos

Acima da tabela, **"Notas | Impostos"**. A visão Impostos troca as colunas de
documento, situação e pagamento pelas dos impostos, com o valor e a
alíquota na mesma célula, e o total de cada imposto no pé (com o percentual
sobre o valor). Escolhida entre três formas (colunas a mais com rolagem
lateral, linha que abre embaixo e esta).

- **Emitidas:** ISS, PIS e COFINS pela alíquota do CNAE da nota no cadastro
  de impostos; IRPJ, adicional e CSLL **estimados por nota** com a
  presunção de 32%, como a planilha faz (o devido sai da apuração do
  trimestre), marcados como estimativa; CBS/IBS da fase de teste (256),
  sem guia, fora do total; o retido pelo cliente. No histórico, os valores
  da própria planilha.
- **Tomadas:** ISS retido, IRRF, PIS, COFINS e CSLL destacados na NF, o total
  retido e o líquido a pagar. Ficam de fora, por ora, o crédito de
  PIS/COFINS e o INSS retido.

## Os seis pontos

| # | Tema | Decisão |
|---|---|---|
| 1 | NF do PJ (folha) | Entra no cadastro de notas com o **colaborador como emitente**, sem fornecedor espelho. A NF do PJ passa a ter número, emissão e valor no envio; a chave da busca é CNPJ + número. |
| 2 | Avulsas e recorrências | A NF de cada mês entra pelo **título do mês** (o documento da cobrança), no cadastro de notas e com saldo. A avulsa segue a mesma regra, pelo próprio título. |
| 3 | Prestação da verba | A NF entra no cadastro **no envio** da prestação. Implementado na 269. |
| 4 | NF do reembolso | **Fica fora** do cadastro de notas, na PP de reembolso e no desembolso de reembolso: ali a NF só comprova o gasto. Quando a NF sai em nome da California, quem paga é a própria California, por PP ou desembolso ao fornecedor. Em 23/11, as 6 NFs das 54 PPs de reembolso estavam sem tomador da California. |
| 5 | Retenções na aprovação | Retenções e crédito de PIS/COFINS na aprovação do **desembolso e da avulsa**, como na PP. Entra junto com a revisão das retenções, não antes. Em 23/11 havia 0 PPs com retenção na aprovação e 5 baixas com retenção. |
| 6 | NF com erro | **O financeiro corrige** número, emissão, valor e CNPJ da nota enquanto ela não foi registrada. Todos os documentos ligados à nota (PP, desembolso, prestação) acompanham a correção, e fica o registro de quem mudou. Substitui o "rejeita para quem enviou corrigir" que a 264 deixou no desembolso. É exceção: os dados vêm da leitura da NF. Como fica, abaixo. |

## O ponto 6 na tela: "Editar registro" na própria tabela

Pedido do Tiago: corrigir na própria tabela da aba Tomadas, como numa
planilha.

- **"Editar registro"** destrava só as notas em avaliação (as registradas
  ficam com cadeado). As células de número, emissão, valor e CNPJ tomador
  viram campos; a alterada fica destacada, com o valor antigo riscado, e
  embaixo da linha aparece o que acompanha (os documentos da nota) ou o
  erro que impede salvar.
- **Nada grava até o rodapé:** "Cancelar" ou "Salvar alterações". O salvar
  abre o pop-up de confirmação com o de → para de cada nota, quem
  acompanha e o **motivo obrigatório**.
- **Registro:** a nota guarda quem alterou, quando, o que mudou e o motivo
  ("Alterações do registro" no painel, ícone na NF da tabela), e cada PP da
  nota ganha no histórico o evento "NF corrigida" com o motivo.
- **Só o financeiro e o administrador** veem o botão; o banco confere de
  novo (uma RPC que corrige a nota e as cópias em PP, desembolso e
  prestação e confere o saldo com `_conferir_partes_da_nota`).

As três perguntas, respondidas pelo Tiago (sem objeção às recomendações):

| | Pergunta | Decisão |
|---|---|---|
| 6a | Qual CNPJ se corrige | **Só o tomador**, como a correção da NF da PP. Emitente errado volta para quem enviou (na prestação da verba, o financeiro já corrige o emitente pela própria prestação, 189 e 269). |
| 6b | Número que já é de outra nota do mesmo emitente | **Junta as duas**, como a correção da PP: os documentos passam para a nota que já existe, com o saldo conferido. |
| 6c | O "Corrigir a NF" da PP | **Fica**: com a PP em avaliação, quem a enviou continua corrigindo por lá, sem motivo (é antes da conferência), e passa a levar junto o desembolso e a prestação da mesma nota. |

E os ajustes que a revisão dos pontos achou, recomendados e postos no
protótipo v8 com o OK do Tiago ("Sim, fazer a v8"):

1. **Trocar o CNPJ tomador muda a empresa da PP** (revisão da 156): o pop-up
   avisa "A PP-x passa de A para B, e o PDF da PP é refeito". No desembolso,
   a empresa acompanha do mesmo jeito.
2. **Os outros documentos ficam sabendo:** o evento no histórico de cada um.
3. **Juntar pode juntar notas diferentes** (a nota é fornecedor + número, sem
   a série): o aviso mostra a emissão e o valor da nota que já existe e
   alerta quando são diferentes.
4. **Nota registrada com erro:** reverter a aprovação do documento passa a
   desfazer o registro da nota, que volta a "Em avaliação" e se corrige na
   tabela. Hoje reverter não desfaz (4 notas registradas sem documento
   aprovado em 23/11).
5. **Duas pessoas ao mesmo tempo:** quem salvar por último recebe "a NF foi
   alterada por <nome> depois que você abriu a edição" e nada é
   sobrescrito.

Pendência no mesmo assunto (resolvida em 23/11/2026): o texto da tela do
desembolso "Registrada no controle de notas (Fiscal › Notas recebidas)"
apontava para uma tela que não existia; passou a "Central Financeira ›
Notas Fiscais › Tomadas".

## Retrato de 23/11/2026 (produção)

204 notas não registradas: 195 em PPs, 9 em prestações, nenhuma em
desembolso; 75 notas estão em mais de um documento. A correção da NF da PP
foi usada 2 vezes (a última em 26/10).

## Implementação (23/11/2026)

Entrou a seção, sem o "Editar registro" (ponto 6), que vem em seguida.

- **Onde:** `app/(app)/financeiro/notas-fiscais/` e o card "Notas Fiscais"
  na Central Financeira. Só o administrador e o financeiro abrem.
- **Emitidas:** as notas do sistema (`faturamentos`) e as do histórico da
  planilha (cargas ativas, decisão 211). O olho abre o mesmo painel do
  Contas a Receber, em leitura; a nota do histórico não tem painel. A
  nota que está nos dois (mesmo número e mesmo CNPJ emissor; em 23/11 só
  a 6116 de 13/08/2026) aparece uma vez, pela do sistema.
- **Tomadas:** as notas do cadastro único (decisão 152) com os documentos
  que as trazem (PP, desembolso, prestação da verba); o desembolso de
  reembolso fica fora (ponto 4) e a prestação só conta em avaliação ou
  aprovada. O olho abre o painel da nota, com a PP ao lado ou o PDF do
  anexo.
- **A lista desenha 200 notas por vez** ("Mostrar mais 200" no pé). Com
  "Tudo", as emitidas passam de 3.600 (o histórico): desenhar todas fazia
  12,9 MB de página e 106 mil elementos. Os totais, os filtros, a busca e
  a exportação continuam sobre todas as notas do filtro.
- **A leitura da NF pela IA** (os dados da coluna "Da leitura da NF"):
  descrição do serviço, CNAE, município da prestação, competência, código
  de verificação e as retenções destacadas. O financeiro dispara pela
  barra acima da tabela ("Ler as N notas pela IA", as notas da lista ainda
  não lidas, de 4 em 4, com o progresso) ou pelo "Ler esta NF" no painel.
  A leitura é recusada quando o arquivo traz outro número de nota ou outro
  CNPJ de emitente. Nada é lido sozinho: as ~500 notas que já existem
  esperam o financeiro disparar. Sem a leitura, o CNAE é o do cadastro do
  emitente (com "*") e o retido fica em branco.
- **Banco:** `20261123800001_nota_tomada_dados_da_leitura.sql` (as colunas
  da leitura em `notas_fiscais_fornecedor`) e
  `20261123800002_gravar_leitura_da_nota.sql` (a RPC
  `gravar_leitura_da_nota`, só administrador e financeiro, só nestas
  colunas). Cada leitura entra na auditoria
  (`nota_fiscal.leitura_ampliada`, com tokens e custo) e no cache das
  leituras pelo hash do arquivo. Conferida na versão publicada em
  23/11/2026, na NF 603 do Sandbox: ~1.000 tokens de entrada e ~130 de
  saída, cerca de US$ 0,0006 por nota (as ~500 notas da produção dariam
  uns US$ 0,30).
- **CNAE × código do serviço (esquema v2, 23/11/2026):** na primeira
  leitura em lote da produção, parada em 30 notas, a IA gravou como CNAE o
  código de tributação do serviço (item da LC 116, ex. "17.06.01 / -") em
  17 delas; nenhuma tinha CNAE de verdade — a maior parte das NFS-e não
  traz CNAE. A leitura passou a separar os dois: o CNAE só no formato de
  CNAE (7 dígitos, "NNNN-N/NN"); o código do serviço em coluna própria
  (`codigo_servico`, migration `20261123800003`), mostrado no painel e na
  exportação. A nota lida com o esquema antigo (`leitura_modelo` termina em
  `nota-tomada-v1`) volta a ser oferecida e a releitura grava por cima.
- **A leitura das notas da produção (23/11/2026, OK do Tiago):** das 508
  notas tomadas, 476 lidas e 32 não. Das lidas: 463 com código de
  verificação, 396 com competência, 316 com código do serviço, só 6 com
  CNAE (a NFS-e quase nunca traz) e 48 com retenção destacada (R$
  109.158,91 no total). Custo: 506 leituras, US$ 0,88. As 32 foram
  recusadas porque o arquivo traz outro número de nota ou outro emitente:
  número digitado diferente do PDF (chave de acesso, apólice ou protocolo
  no lugar do número), números inventados nas NFs da prestação da verba
  ("03", "04"... da mesma prestação) e PDF de outro emitente. São casos do
  ponto 6: o financeiro corrige o registro e a nota volta a ser lida. Até
  lá, a barra continua oferecendo a leitura delas.

Achados no dado, sem correção (produção só leitura):

- A NF 6479 (California · Salvador, R$ 300.000,00) está com emissão em
  01/03/2027.
- No Sandbox, 6 notas tomadas apontam para fornecedores da produção (sobra
  da mudança da Empresa Teste): o emitente aparece "—".

## Implementação do ponto 6 (23/11/2026)

- **"Editar registro"** na aba Tomadas, como no protótipo v8: só as notas em
  avaliação ficam editáveis (as registradas com cadeado); número, emissão,
  valor e CNPJ tomador viram campos; a célula alterada fica destacada com o
  valor antigo riscado; embaixo da linha, o erro que impede salvar ou o que
  acontece junto (junção, a PP que muda de CNPJ) e quem acompanha; rodapé
  "Cancelar" / "Salvar alterações"; pop-up com o de → para e o motivo
  obrigatório (10+ caracteres).
- **Banco:** `notas_fiscais_fornecedor_alteracoes` (o registro de cada
  alteração: de → para, motivo, documentos que acompanharam, quem e quando)
  e a RPC `alterar_registro_das_notas`, só administrador e financeiro, só
  nota não registrada. As cópias nos anexos da PP, do desembolso e da
  prestação acompanham; a parte de cada documento (na prestação, o `valor`
  do documento) não muda, e o saldo é conferido. Número que já existe no
  mesmo emitente junta as duas notas (6b). A edição simultânea é barrada
  pelo que a tela viu ao abrir ("a NF foi alterada por <nome> depois que
  você abriu a edição"). Migration `20261123800004`.
- **CNPJ da PP:** depois de gravar, cada PP da nota segue o CNPJ tomador e
  tem o PDF refeito (`seguirDocumentoNasPPs`, revisão da 156) — também na
  junção, quando a nota que já existia estava em outro CNPJ.
- **Histórico:** "Alterações do registro" no painel da nota e o ícone na NF
  da tabela; o evento "NF corrigida" com o motivo em cada PP (e na PP da
  prestação); o desembolso mostra "NF corrigida no controle de notas" no
  histórico dele.
- **Ajuste 4:** reverter a aprovação de uma PP ou de um desembolso desfaz o
  registro da nota (`_desfazer_registro_das_notas`): ela passa a outro
  documento aprovado que a traga ou volta a "Em avaliação". As 4 notas
  registradas sem documento aprovado de antes não foram mexidas (pedem o OK
  do Tiago).
- **6c:** o "Corrigir a NF" da PP passou a levar junto as cópias do
  desembolso e da prestação, e a nota antiga que fica sem PP leva os outros
  documentos para a corrigida (antes, um desembolso na nota antiga fazia a
  correção falhar). Migration `20261123800005`.
- **Conferido no Sandbox:** a NF 9156 da PP-00146 virou 9158 com outro valor
  e outro CNPJ tomador (a PP mudou de CNPJ, evento e histórico gravados), e a
  NF 7001 foi juntada à 9158 (as duas PPs na mesma nota, a PP-00146 de volta
  ao CNPJ da linha). Erros na tela: valor abaixo das partes e junção que
  estoura o saldo. No banco, em transação desfeita: conflito de edição, nota
  registrada, GP sem permissão, motivo curto, reversão da PP-00110 desfazendo
  o registro da NF 602 e o "Corrigir a NF" da versão nova.

Das 32 notas da produção que a leitura recusou, 15 estão em avaliação e se
corrigem pela tabela; 17 estão registradas e precisam da reversão da
aprovação do documento antes.

## Leitura v3: o que o PDF traz fica na nota (23/11/2026)

O Tiago não entendeu por que 32 notas foram recusadas: a tela não dizia. O
cruzamento do cadastro com o que a IA leu dos PDFs mostrou quatro casos:

- **8 recusas por engano:** a IA leu um ou dois dígitos do CNPJ do emitente
  trocados (o CNPJ lido nem fecha os dígitos verificadores); o cadastro
  estava certo.
- **11 com o número digitado errado**, mesmo emitente e mesmo valor do PDF:
  números inventados nas NFs da prestação ("03", "04"…) e chaves de acesso
  no lugar do número.
- **6 com o PDF de outro CNPJ** que não o fornecedor do documento.
- **7 sem leitura útil:** guia municipal e apólices no lugar da NF, e PDFs
  que a IA não leu.

Mudou (`lib/ia/ler-nota-tomada.ts`, esquema v3, migration `20261123800006`):

- O CNPJ lido só diverge se for válido pelos dígitos verificadores.
- A emissão entra na leitura; emissão e valor diferentes viram divergência,
  não recusa.
- Toda leitura grava na nota o que o PDF traz (`leitura_pdf`: número, CNPJ,
  emissão, valor) e o que diverge (`leitura_divergencias`). Com número ou
  emitente diferentes, o PDF não é desta nota e os dados da leitura ficam
  vazios.
- A aba Tomadas ganhou o filtro "PDF diferente do registro", o alerta na NF
  com o registro × PDF, a mesma caixa no painel, a coluna na exportação e,
  no "Editar registro", o "Usar os dados do PDF" (número, emissão e valor;
  o emitente continua voltando para quem enviou).

## Revisão: o "Editar registro" corrige a nota registrada (23/11/2026)

A releitura (v3) mostrou 12 notas registradas com número, emissão ou valor
diferentes do PDF: o "Número da DPS" digitado no lugar do "Número da NFS-e"
(DANFSe v2.0), a chave de acesso no lugar do número, o ano errado, o valor
líquido no lugar do bruto. A regra da v8 mandava reverter a aprovação do
documento, mas a maioria das PPs já está paga e não reverte. O Tiago
liberou ("Sim, liberar"):

- a nota registrada corrige **número, emissão e valor** pelo "Editar
  registro", com o mesmo motivo, histórico e evento nos documentos; o
  registro (quem, quando, em qual documento) continua;
- o **CNPJ tomador** da registrada não muda (a célula não vira campo);
- a registrada **não se junta** a outra nota: o número que já existe no
  emitente é recusado.

Migration `20261123800008`. A nota sem documento ativo continua travada.

### O que foi corrigido na produção (23/11/2026)

Releitura das 508 notas na v3: 504 lidas, 30 com o PDF diferente do registro.
Cada caso foi conferido no PDF antes de corrigir; as correções foram feitas
pela tela ("Editar registro" → "Usar os dados do PDF"), com motivo:

- **10 em avaliação:** as 7 NFs da prestação da PP-00455 (números "01" a
  "11" digitados no lugar dos números reais, e a emissão), uma NF de 5
  dígitos que era a 22 (PP-01150) e duas NFs da PP-00949 (valor bruto da
  nota; o cadastro tinha o líquido, sem o IRRF de 1,5%).
- **9 registradas** (depois da liberação): o número da DPS ou da chave de
  acesso no lugar do número da NFS-e (PP-00271, PP-00269, PP-00282),
  emissões (PP-00346, PP-00357, PP-00090, PP-00861, PP-00123) e valores
  (PP-00137 e PP-00123).

Ficaram 12, que dependem de decisão: o ano lido errado pela IA (3 notas; o
cadastro está certo), PDF emitido por outro CNPJ que não o fornecedor do
documento (PP-01434, PP-01465, PP-01423, PP-01233 e PP-00952), PDF de outro
documento (PP-01367/PP-01368) e documentos que não são NF (uma guia
municipal e duas apólices de seguro). Em aberto também: a PP-00123 pagou
R$ 250 de uma NF de R$ 2.500 e a PP-00137 cobre R$ 1.200 de uma NF de
R$ 2.400.

## "O registro está certo" (23/11/2026)

Para quando quem errou foi a leitura, não o cadastro (o PDF diz 2026 e a IA
leu 2016). No aviso de divergência do painel da nota, o financeiro confirma
com motivo: a divergência sai, a confirmação fica no histórico da nota
(o que o PDF trazia × o registro mantido), e a releitura que trouxer o mesmo
PDF não volta a acusar. Se o número, a emissão ou o valor mudarem depois, a
confirmação deixa de valer e a nota volta a ser comparada com o PDF. O
"Editar registro" continua sendo o caminho quando o cadastro é que está
errado. RPC `confirmar_registro_da_nota`, migration `20261123800009`.

## Leitura v4: o texto do PDF como segunda leitura (23/11/2026)

Pedido do Tiago depois que a leitura por imagem errou o ano em 3 notas e
trocou dígitos de CNPJ em 8.

- A leitura por imagem (IA) continua em todo PDF; para foto, cupom e PDF
  sem texto, segue sendo a única fonte.
- Quando o PDF tem texto selecionável, número, emissão, valor e CNPJ do
  emitente saem dos rótulos do layout, sem IA (`lib/ia/texto-da-nf.ts`):
  DANFSe v2.0 ("Número da NFS-e", nunca o "Número da DPS"; "Data e Hora da
  Emissão da NFS-e"; "Valor da Operação / Serviço"; CNPJ do prestador),
  NFS-e municipais e DANFE.
- As duas concordam → normal. Discordam → vale o texto, e a nota guarda em
  que discordaram ("as leituras discordaram; valeu o texto"). Sem texto →
  vale a imagem, e a divergência aparece como "só pela leitura da imagem —
  pode ser erro de leitura; confira o PDF".
- A releitura reaproveita a leitura por imagem do cache (sem custo); se a
  IA falhar e o texto trouxer os campos, vale o texto.
- Migration `20261123800010` (colunas `leitura_imagem`, `leitura_texto`,
  `leitura_texto_bruto`, `leitura_discordancias`, `leitura_so_imagem`).

