# 029 — Data do evento, "recebimento" no lugar de "faturamento" nas datas, e a planilha abrindo em Líquido

**Data:** 2026-08-27
**Migrations:** `20260827100001_job_data_evento.sql`
**Design:** `Enviar Job - Ajustes de Campos.dc.html` (projeto Claude Design
`69342d83`), telas 1a, 1b e 1c.
**Contexto:** pop-up "Enviar job para abertura"
(`/orcamentos/[projetoId]/[orcId]`), a chave Bruto ↔ Líquido (− BV) de
todas as planilhas, e o nome da data de recebimento em todo o produto.

---

## 1. A planilha abre em Líquido (− BV)

`VISAO_BV_PADRAO` era `"bruto"` desde que a chave existe (decisão
[022](022-bv-liquido-e-realizado-por-pp.md)). Passa a ser `"liquido"`:
quem abre a tela quer o custo já sem a comissão que volta para a
California — o número que o financeiro persegue —, e o bruto vira a
escolha explícita de quem precisar dele.

Nada mais muda: a chave continua valendo para grupos, itens e Totais ao
mesmo tempo, continua mexendo só em PLANEJADO e REALIZADO, e continua
**não sendo memorizada entre sessões**.

⚠️ **A constante é uma só e serve seis telas, não três.** O design cita
três editores (versão do orçamento, agregado e multi-jobs); na prática
`VISAO_BV_PADRAO` também abre a conferência da abertura
(`/financeiro/abertura-de-job/[jobId]/planilha`), as planilhas do projeto
(`/jobs/projeto/[projetoId]`) e o Realizado do job. As seis passaram a
abrir em Líquido — que é o comportamento coerente, mas foi consequência,
não pedido explícito.

---

## 2. `jobs.data_evento` — campo novo, obrigatório no formulário

A abertura ganhou **Data Evento**, entre "Data de fim" e a data de
recebimento. É obrigatória: nenhum job novo nasce sem ela.

A coluna, porém, é **nullable**. Os jobs abertos antes de 27/08/2026 não
têm o dado e não há de onde inferi-lo — `NOT NULL` com default inventaria
uma data de evento que ninguém informou. A obrigatoriedade mora no Zod
(`aberturaJobSchema`) e no formulário.

**A data do evento fica só no job.** Nome, cidade, regional, início e fim
são gravados também no orçamento; esta não, porque `orcamentos` não tem o
campo e o design não pede que passe a ter. Se um dia o orçamento precisar
dela, é migration nova — não deduzir do job.

⚠️ Não confundir com `vw_fluxo_caixa.data_evento`, que já existia e é
outra coisa: a data do evento **financeiro** de uma linha do fluxo.

---

## 3. Data é "recebimento"; "faturamento" fica para o valor e o processo

Decisão do Tiago (27/08/2026): **a palavra "faturamento" só aparece
quando se fala do valor a ser faturado ou do processo de emitir a nota.
Quando o assunto é a data em que o dinheiro entra, o nome é
"recebimento".**

A coluna continua `jobs.data_prevista_faturamento`, o campo do formulário
continua `dataFaturamento` e a chave de erro do servidor continua
`data_prevista_faturamento`. Renomear a coluna não traria nada e quebraria
o financeiro, o fluxo de caixa e a fila de abertura, que já leem por esse
nome. **Mudou só o que o usuário lê:**

| Onde | Antes | Agora |
|---|---|---|
| Formulário de abertura | Data prevista para faturamento | Data prevista para recebimento |
| Pop-up de conferência (orçamento) | Faturamento em | Recebimento em |
| Barra da versão | Faturamento previsto para {data} | Recebimento previsto para {data} |
| Banner "Job enviado para abertura" | · faturamento previsto para {data} | · recebimento previsto para {data} |
| Conferência da fila do financeiro | Faturamento em | Recebimento em |
| Abertura do financeiro · resumo | Faturamento em | Recebimento em |
| Abertura do financeiro · parcelas | Faturamento previsto para {data} | Recebimento previsto para {data} |
| Ficha do job | Prev. faturamento | Prev. recebimento |

**Ficaram como estavam**, porque falam de valor ou de processo:
"Faturamento previsto" (o que a California emite nota), "Faturamento
save previsto", "Enviado para faturamento em {data}" (quando o job foi
mandado para a emissão) e o próprio módulo de Faturamento.

---

## 4. Nova ordem dos campos: as três colunas sempre cheias

Até aqui a grade tinha buracos — Produto e Categoria vinham sozinhos, cada
um com dois espaçadores, e Cidade/Regional dividiam a linha seguinte. A
ordem agora é:

| | col 1 | col 2 | col 3 |
|---|---|---|---|
| 1 | Projeto | Código do projeto | Código do job |
| 2 | Nome do Job (2 col.) | | Cliente |
| 3 | Produto | Regional | GP Responsável |
| 4 | Categoria | Cidade | Produtor Responsável |
| 5 | Data de início | Data de fim | **Data Evento** |
| 6 | Data prevista para recebimento | *(vazio)* | |

**Separar Cidade de Regional é seguro.** O comentário antigo do modal
dizia que o par "não pode se separar, já que as regionais dependem da
cidade" — não dependem: as opções saem de `regionaisDoProjeto`, do
**projeto**, e nunca olharam para a cidade escolhida.

---

## 5. "Total gerado em save" no fechamento da versão

O card "Fechamento da versão" ganha uma terceira linha, abaixo de "Valor
total do Job", e o pop-up de conferência ganha a linha **Save**, abaixo de
"Valor total". **As duas somem quando o valor é zero** — versão sem save
não ganha uma linha a explicar.

O número é `totais.save.totalSaveGerado` — o **crédito**, não a receita.
É o mesmo que o card de Totais já mostra como "Saldo em save"
([028](028-save-entre-jobs.md) §4): o crédito que o cliente tem a gastar é
o principal das linhas em save; a receita (principal + honorários +
imposto proporcionais, que vira `jobs.faturamento_save_previsto`) é outra
coisa. O design pede "Crédito gerado pelos itens deste job" — portanto o
primeiro.

⚠️ **A cor não seguiu o design — e isso foi decidido, não deduzido.** O
desenho pinta a linha de `#1e4fa3` (azul), mas ele é anterior à entrada do
save no produto, que trouxe identidade própria — grafite `#5f5d57`, em
`SAVE` de `app/(app)/_planilha/blocos.ts`. Seguir o desenho deixaria o
**mesmo número** em duas cores: azul aqui e grafite no card de Totais, a
dois cliques de distância. As duas hipóteses foram montadas lado a lado e
o Tiago escolheu o grafite em 27/08/2026, depois de ver as duas telas
reais. **Vale a paleta do produto, não o desenho.**

---

## 6. "Ver dados do job" abre a conferência, não o formulário

Com o job já enviado, o botão "Ver dados do job" abria o **formulário de
abertura** inteiro, travado campo a campo. Passa a abrir o **pop-up de
conferência** — o mesmo de antes do envio, sem os botões que decidem:
título "Dados do job", ícone de pasta no lugar do avião, e só "Fechar".

O motivo: quem volta ao orçamento quer rever *o que foi conferido*, numa
lista curta, não navegar um formulário de 15 campos desabilitados.

Duas correções que a conferência precisou para servir de leitura:

- **Código** vinha de `proximoCodigoJob`, que é só um preview do próximo
  número. Com o job enviado agora vem de `job.codigo`.
- **Cidade · Regional** vinha do formulário, que é pré-preenchido com o
  **orçamento de hoje**. Com o job enviado passa a vir de `herdados`, que
  é o que o job congelou — o orçamento pode ter mudado desde então.

**O modo `somenteLeitura` de `EnviarJobModal` foi removido**, em task
própria logo depois (27/08/2026), com a leitura pela conferência já
aprovada no navegador. Eram 25 pontos no componente — título, descrição,
oito `disabled`, os ramos travados de Regional e Cidade, o contato
"nenhum registrado", os botões de remover e adicionar contato, o texto do
rodapé e o par Fechar/Confirmar. **O formulário agora só sabe editar.**

`HerdadosJob` manteve `cidadeNome` e `regionalNome`: quem passou a lê-los
é o resumo da conferência, que com o job enviado precisa mostrar o que o
JOB congelou — não o que está no orçamento hoje.
