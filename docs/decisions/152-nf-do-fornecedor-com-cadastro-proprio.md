# 152 — A NF do fornecedor tem cadastro próprio e conta uma vez só

**Data:** 2026-10-07
**Status:** aceita e no ar (07/10/2026); revista no mesmo dia — a parte da
NF numa PP vai até o valor da PP, e a NF da PP em avaliação se corrige sem o
financeiro aprovar (ver "Revisão de 07/10/2026")
**Quem decidiu:** Tiago, em 07/10/2026, junto da aprovação do protótipo da
PP a emitir (decisão 153). As respostas seguiram a recomendação que
acompanhava cada pergunta.
**Número:** nasceu como 150 e foi renumerada para 152 antes de publicar: o
`main` já tinha o 150 (Cadastro de Veículos) e o 151 (errata que cancela a
linha). Regra de colisão do Tiago: a mais nova move. As migrations
`20261007300001` e `20261007300002` já tinham sido aplicadas citando 150 e
151 e ficam como estão; a `20261007300003` corrige os comentários que o
banco mostra. Os comentários DENTRO das funções continuam dizendo 150.
**Revê:** o registro da NF na aprovação da PP da [139](139-modulo-fiscal-entrega-1.md)
(uma NF por PP, gravada em `pedidos_compra.nf_*` por `registrar_nf_da_pp`).

## A ideia em uma frase

A NF do fornecedor deixa de ser um campo da PP e vira um **cadastro
próprio**, identificado por **fornecedor + número**: uma mesma NF pode cobrir
mais de uma PP, e cada NF conta **uma vez só** no fiscal, pelo total.

Palavras do Tiago: "pode ocorrer casos onde uma mesma NF abrange mais de uma
PP. Por isso precisamos ter o controle de todas as NFs colocadas no sistema
individualmente."

## As regras

| Tema | Regra |
|---|---|
| Identidade da NF | Fornecedor + número. Pontuação, espaços e zeros à esquerda não contam: `00009001` e `9.001` são a mesma nota (`chave_do_numero_da_nf`). |
| Quando a NF conta | **Uma vez, pelo TOTAL, quando é registrada** — na aprovação da 1ª PP que a traz: crédito de PIS/COFINS e ISS retido no mês da emissão. |
| PPs chegam uma de cada vez | A 2ª PP vê a NF "já registrada" ("Registrada na aprovação da PP-…"). O crédito e o ISS dela não entram de novo. |
| A parte de cada PP | Cada PP guarda a sua parte da NF (`nf_valor_na_pp`). Padrão: a nota inteira. A soma das partes, nas PPs não canceladas, não passa do valor da nota (o banco recusa). ⚠️ Desde a revisão de 07/10/2026, a soma das partes numa PP também não passa do **valor da PP**. |
| CSRF e IRRF | Seguem o **pagamento de cada PP**, sobre a parte dela — como antes. |
| Quem corrige | A produção informa os dados no anexo. O financeiro recebe tudo preenchido e **editável**; a correção vale para **todas** as PPs da nota. ⚠️ Desde a revisão de 07/10/2026, com a PP em avaliação, o GP (e o financeiro) corrige pelo botão "Corrigir a NF", sem aprovar. |

## Na produção (formulário da PP a emitir e envio ao financeiro)

- Cada anexo do tipo NF pede número, data de emissão, valor e CNPJ tomador.
- O campo **"Valor nesta PP"** só aparece pelo link **"Esta NF também cobre
  outra PP"**. Sem o link, a parte é a nota inteira. ⚠️ Revisão de
  07/10/2026: com a nota maior que a PP, o campo abre sozinho, com o valor da
  PP, e o link some.
- NF que **já existe em outra PP** (mesmo fornecedor e número) vem
  preenchida e **travada**: "Esta NF já está na PP-… (R$ …). Os dados vêm
  de lá; só o financeiro corrige." O "Valor nesta PP" abre sugerindo o que
  falta da nota.
- No envio, `ligar_notas_fiscais_da_pp` liga cada anexo NF à sua nota: cria
  a nova ou liga à existente **sem mudar os dados dela**, e confere a soma
  das partes.

## No financeiro (Contas a Pagar)

- "Nota fiscal do fornecedor", um bloco por NF, com "Também na PP-…" e
  "Registrada na aprovação da PP-…" quando a nota cobre outras PPs.
- Retenções na fonte: a base é a **soma das partes** desta PP.
- Crédito de PIS/COFINS: por nota, pelo total. A nota que outra PP já
  registrou aparece como "R$ … já na apuração, registrada com a PP-…".
- A aprovação chama `registrar_notas_fiscais_da_pp` (substitui
  `registrar_nf_da_pp`, que fica no banco sem uso): grava as retenções,
  liga ou corrige cada nota e registra a nota na 1ª aprovação.

## No Fiscal (Apuração)

- `lib/fiscal/apuracao-fatos.ts` lê `notas_fiscais_fornecedor` registradas.
  Uma nota só conta enquanto **ao menos uma PP aprovada ou paga** a cobre: a
  PP que a registrou pode ter sido reprovada depois (decisão 083), e aí a
  nota espera a próxima.
- Os pagamentos de cada PP vão para a 1ª nota dela, com o código e o job da
  própria PP.
- Testado: com a NF 9001 (R$ 10.000) dividida entre a PP-00129 (R$ 6.000) e
  a PP-00131 (R$ 4.000), a base do IRPJ da Apuração ficou igual depois da
  2ª aprovação (R$ −19.335,00): a nota contou uma vez.

## Banco

- `notas_fiscais_fornecedor` — uma linha por nota; único por
  `(tenant_id, fornecedor_id, numero_chave)`. RLS de leitura para quem não é
  freelancer; escrita só pelas funções.
- `pedidos_compra_anexos` ganhou `nota_fiscal_id`, `nf_data_emissao`,
  `nf_valor`, `nf_tomador_estabelecimento_id` e `nf_valor_na_pp`.
- As colunas antigas `pedidos_compra.nf_*` ficam como histórico e não são
  mais escritas. `nf_registrada_em` da PP continua marcando "as notas desta
  PP foram conferidas".
- Backfill: as notas das PP-00110, PP-00111 e PP-00128, as únicas
  registradas antes.
- Migrations: `20261007300001_notas_fiscais_do_fornecedor.sql`,
  `20261007300002_pp_a_emitir.sql` (as funções da produção) e
  `20261007300003_renumera_decisoes_152_153.sql`. Revisão de 07/10/2026:
  `20261007300006` a `20261007300008`.

## Revisão de 07/10/2026 — a parte vai até o valor da PP, e a NF se corrige sem aprovar

**O que aconteceu.** A produção usou a NF 19 (R$ 450) em duas PPs: PP-00138
(R$ 250) e PP-00139 (R$ 200). Na PP-00138 não clicou em "Esta NF também
cobre outra PP", e a parte gravada foi a nota inteira — R$ 450 numa PP de
R$ 250; a tela só avisava em amarelo. A PP-00139 esbarrou na soma
(450 + 200 > 450) com "Ajuste o valor nesta PP", mas quem estava errada era
a PP-00138, já enviada, que ninguém da produção conseguia corrigir, e o
financeiro só corrigia aprovando. A parte da PP-00138 foi corrigida no banco
para R$ 250 (autorizado pelo Tiago; auditoria
`pedido_compra.nf_parte_corrigida`).

**Decidido pelo Tiago (07/10/2026):**

| Tema | Regra |
|---|---|
| Teto da parte | A soma das partes das NFs numa PP vai até o **valor da PP**: a PP não usa mais da nota do que ela mesma paga. A mesma NF continua cobrindo várias PPs (R$ 250 + R$ 200 de uma nota de R$ 450). |
| Nota maior que a PP | "Valor nesta PP" abre sozinho com o valor da PP; o link "Esta NF é só desta PP" some. Passar do valor da PP **barra** o envio (antes, aviso amarelo). Ficar abaixo continua só avisando. |
| A nota já está em outra PP | O campo vem com o que sobra da nota, até o valor da PP. Pedir mais do que sobra barra o envio **antes do clique**, com o atalho "Corrigir a PP-…" para a PP que está com a parte errada. |
| Correção pela produção | Botão **"Corrigir a NF"** na PP **em avaliação** (painel do item, "Já no financeiro"), para GP, administrador e financeiro (`jobs.corrigir_nf_pp`), sem aprovar: a parte desta PP sempre — **também depois que o financeiro registrou a nota pela aprovação de outra PP** (confirmado pelo Tiago em 07/10/2026: a parte é da PP em avaliação, que o financeiro ainda não conferiu); os dados da nota (número, emissão, valor, CNPJ tomador) enquanto o financeiro não a registrou, e então a correção vale para todas as PPs com ela. Depois do registro, só o financeiro mexe nos dados. |
| Rastro | A correção grava o evento `nf_corrigida` no histórico da PP, com o que mudou ("NF 19: valor nesta PP de R$ 450,00 para R$ 250,00"), na PP corrigida e nas outras com a mesma nota ("(corrigida na PP-…)"). A aprovação do financeiro mostra "NF corrigida por … em …" logo abaixo de "Enviada por". Auditoria `pedido_compra.nf_corrigida` com antes e depois. |
| Mensagens | Em reais ("R$ 450,00", não "450.00"), dizendo quanto cada PP usa da nota. |

**Banco.** `_conferir_partes_da_nota` passou a conferir também cada PP ligada
à nota (envio, aprovação e correção passam por ela); `_reais` formata as
mensagens; `corrigir_notas_fiscais_da_pp` (security definer; confere papel,
PP em avaliação e nota registrada); `notas_fiscais_do_fornecedor` devolve o
id da PP; `pedidos_compra.nf_corrigida_em/por`; evento `nf_corrigida` em
`pedidos_compra_eventos` (o primeiro escrito fora dos gatilhos da PP).
Migrations `20261007300006`, `20261007300007` e `20261007300008`.

**Testado (07/10/2026, TES-1014/26, item Passagem, NF 9019 de R$ 400):**
PP-00142 (R$ 250) abriu "Valor nesta PP" sozinho com R$ 250 e recusou R$ 300;
PP-00143 (R$ 200) veio com R$ 150 (o que sobrava), recusou R$ 200 com
"Da NF 9019 sobram R$ 150,00" e o atalho "Corrigir a PP-00142"; a correção
(R$ 250 → R$ 200) pelo atalho liberou o envio. A troca do CNPJ tomador pela
PP-00143 mudou a nota nas duas PPs e gravou o evento nas duas; a aprovação
da PP-00142 mostrou o aviso. No banco, o produtor é recusado e o GP passa.

## Pendências

1. **Retroativo (pedido do Tiago, depois desta entrega):** mapear as PPs com
   mais de uma NF anexada que ainda não foram registradas — o registro dos
   campos não existia — para registrar em lote.
2. **O ISS retido fica o da 1ª aprovação — e trava** (resposta do Tiago em
   07/10/2026: "Ao notar que a NF já está no sistema, os campos devem ser
   automaticamente preenchidos com o preenchimento já feito, e travados com
   o mesmo"). Na aprovação de outra PP da mesma nota, o ISS das retenções
   vem com a alíquota registrada e não se edita ("Sem ISS retido, como na
   aprovação da PP-00129: a NF é a mesma."); com ISS acima de zero, a chave
   "Reter na fonte" não desliga. O servidor confere
   (`registrar_notas_fiscais_da_pp`, migration `20261007300005`): com
   retenção, o ISS desta PP tem de ser o da nota. Testado na PP-00132 do
   TES-1014/26 — a tela trava, e a função recusa 2% e aceita sem ISS.
3. **Nota registrada por uma PP reprovada e refeita:** a PP nova mostra a
   nota como "já na apuração, registrada com a PP-…" (a reprovada) e
   mantém as decisões daquela aprovação. A nota volta a contar quando a PP
   nova é aprovada.
4. **Dois casos reais achados na revisão de 07/10/2026, para tratar em breve
   (pedido do Tiago):**
   - **CNPJ tomador da NF 19** (PP-00138 e PP-00139): a nota está gravada
     com tomador GoCrazy · Santo André, mas as duas PPs saem pela Califórnia
     Filmes. Conferir no PDF. Se a nota diz Califórnia, foi erro de
     digitação: a produção corrige pelo "Corrigir a NF" da PP-00138 enquanto
     a nota não foi registrada. Se a nota foi emitida para a GoCrazy, pedir
     outra ao fornecedor.
   - **NF 102 da Hellen Trindade (R$ 1.200) em duas PPs:** PP-00137
     (AMB-1021/26, em avaliação) e PP-00136 (AMB-1020/26, gerada), mesmo
     serviço e mesmo valor — parece PP duplicada. O envio da PP-00136 vai
     ser barrado ("já está inteira na PP-00137"). Perguntar à produção se a
     PP-00136 deve ser cancelada.
