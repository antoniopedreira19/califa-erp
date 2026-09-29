# 126 — O código antigo sai do sistema, e a PP mostra só o código do job

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migrations:** `20260929700001_rastros_do_codigo_anterior.sql` (dado) e,
depois que as outras frentes atualizarem o código, a que remove as colunas
`codigo_anterior`.
**Scripts:** `scripts/rastros-codigo-anterior/` (cópia, PDFs das PPs e
arquivos).

---

## 1. A regra

A decisão 114 (28/09/2026) trocou os códigos de job, projeto, orçamento e
projeto do financeiro, e guardou o código de antes em `codigo_anterior`,
mostrado como "Código anterior". Um dia depois, nas palavras do Tiago:

> Eu gostaria de retirar esse "código anterior". Mas antes seria necessario
> apagarmos todos os rastros deles (nos casos de onde foram trocados por
> novos códigos) no sistema. De PPs, a abertura de job a todos os
> registros.

Sobre as PPs:

> Quero que isso seja feito mantendo toda a integridade das PP antigas,
> mantendo o mesmo número de PP e a mesma data de emissão. A única coisa
> que será modificada serão os códigos presentes nas mesmas. E, nos casos de
> parcelas de PP geradas antes da mudança do layout, que destrinche o valor
> das parcelas, que isso seja adequado também. PPs canceladas podem ser
> refeitas também para garantir que tudo fique igual.

E, no meio do trabalho:

> Atualmente o código do projeto está aparecendo na PP? Isso está errado.
> Deveria ser o código do Job.

Nada do que foi gerado saiu do sistema: a agência ainda roda em paralelo
com o método antigo. Por isso refazer os documentos não cria divergência com
papel que esteja na mão de alguém.

## 2. As respostas que fecharam o desenho

| Pergunta | Resposta |
|---|---|
| O histórico de auditoria (`audit_events`) cita códigos antigos. Troca? | **Não.** Fica como está: conta o que aconteceu, com o código da época, e guarda a única prova de qual código virou qual. Só o administrador vê, e nenhuma tela mostra. |
| Os PDFs de PP soltos (versões antigas que nenhuma PP aponta) e as planilhas importadas? | **Apagar os dois.** |
| A documentação (decisão 114, handoffs, o plano de 28/09) cita os códigos antigos. Limpa? | **Não.** Fica como registro do que foi feito. |
| Cópia de segurança local antes de mudar? | **Sim**, fora do repositório; apagada depois da conferência do Tiago. |
| As 11 PPs do Beats diziam cliente "Novo" (o provisório, até 18/09). O documento novo diz o quê? | **AMBEV / BEATS**, o cadastro de hoje. |

## 3. O documento da PP: só o código do job

Desde a decisão 121 a linha "Orçamento" do PDF virou "Job". A linha
"Projeto", logo abaixo, também sai: o código que a produção e o financeiro
usam para falar do trabalho é o do job, e o do projeto no documento só
confunde. A coluna da direita do cabeçalho fica com **Emissão** e **Job**;
cliente, fornecedor, marca, título e campanha seguem à esquerda, como antes.

Vale para toda PP emitida, editada ou reenviada daqui em diante
(`lib/pdf/pedido-compra.ts`) e para as 47 que já existiam, refeitas (§5).

## 4. "Código anterior" sai das telas e das buscas

- A ficha do job (produção e as duas telas do financeiro que a usam) não
  mostra mais o "Código anterior".
- As buscas da lista de Jobs, da lista de projetos, da fila e dos jobs
  abertos do financeiro e do campo Projeto da abertura acham só pelo código
  atual.
- `codigo_anterior` saiu dos tipos (`Projeto`, `Job`,
  `ProjetoFinanceiroOpcao` e as linhas das listas) e de todas as consultas.

O cabeçalho do projeto já não o mostrava desde a decisão 122, §6.

## 5. O que muda no dado

| Onde | O quê |
|---|---|
| **PDF das 47 PPs** (todas: 17 em avaliação, 11 aprovadas, 10 pagas, 6 canceladas, 3 geradas) | Refeito com o modelo de hoje. Mesmo número, mesma data de emissão (a impressa no documento, conferida com a do rodapé), mesmos dados bancários (a foto da emissão, decisão 067, quando existe). Muda só a linha do código ("Job: <código atual>", sem "Projeto") e, nas 11 do Beats, cliente e marca. |
| **PP-00040 e PP-00091** | Eram parceladas no modelo de antes da decisão 112, um PDF por parcela. Viram um documento só, com a tabela das parcelas (7.250 + 7.250 = 14.500; 6.000 + 4.000 = 10.000). A PP e as 4 parcelas passam a apontar para ele, e os 4 documentos por parcela saem. |
| **Descritivo do TES-1003/26** | "saldo do JOB-0032" vira "saldo do TES-1001/26". |
| **Histórico de importação** (`orcamento_importacoes`, 5 linhas) e **nome da versão** "Importada de interna-TES-0001_26-01-v3.xlsx" | O código antigo do orçamento no nome do arquivo vira o **nome** do orçamento, como a exportação nomeia o arquivo desde a decisão 121 (`interna-Orcamento de Teste-v3.xlsx`). Trocar pelo código novo poria o código do orçamento na tela, o que a 121 proíbe. |
| **Registro de números usados** (`codigos_de_projeto_usados`, 34 linhas no formato antigo) | Passam ao formato com "P" (`AMB-0003/26` → `AMB-P003/26`), com o mesmo número e o mesmo projeto. O gerador já lia as duas formas como o mesmo número, então nenhum número volta a ser usado. Três projetos tinham um código antigo de outra sigla (`NOV-0001/26`, `NOV-0003/26`, `0-0002/26`); convertido, esse número passa a ser "dele" para a decisão 122, §6. Os três têm orçamento com job, e o cliente deles já não muda. |
| **`codigo_anterior`** em projetos (16), orçamentos (39), projetos do financeiro (6) e jobs (23) | Esvaziado já; a coluna sai depois que as outras frentes atualizarem o código (ver §8). |
| **Storage** | Apagados os 63 PDFs de PP soltos, os 4 documentos por parcela das PPs acima e as 23 planilhas importadas. |

## 6. O que fica, e por quê

- **`audit_events`:** decisão do Tiago (§2).
- **Documentação e migrations** já no repositório: registro do que foi
  feito.
- **Anexos enviados pelas pessoas** (NF, comprovante, orçamento de
  fornecedor): são documentos de fora. O sistema não os gera e não os
  reescreve.
- **As 11 linhas do histórico de importação** ficam (5 com o nome
  corrigido), apontando para arquivos que não existem mais. Nenhuma tela lê
  essa tabela: o app só grava nela, e a planilha só é lida durante a
  própria importação.

## 7. Integridade

- **Número e data de emissão da PP:** os mesmos. A data vem do documento
  impresso, não de `created_at`.
- **Nada muda além do código** — nem `updated_at`. A data de alteração
  aparece no chat das PPs (cartões "PP paga", "rejeitada", "cancelada") e
  decide o "parado há 15 dias" dos orçamentos. A migration desliga só o
  gatilho de `updated_at` das tabelas que toca, dentro da própria
  transação.
- **Contagens exigidas:** a migration confere quantas linhas mudou em cada
  passo e desfaz tudo se alguma diferir do esperado.
- **O banco não mudou entre a cópia e a gravação:** o script confere o
  `updated_at` de cada PP e parcela e o MD5 de cada arquivo contra a cópia
  antes de subir o PDF novo.

## 8. As colunas `codigo_anterior`

Saem do banco depois que o código novo estiver publicado e as outras
frentes em andamento tiverem atualizado seus worktrees. Até lá, código que
ainda lê a coluna recebe vazio, sem quebrar.

## 9. Cópia de segurança

`~/Documents/California/backups/codigos-antigos-2026-09-29/` (fora do
repositório):

- `storage/`: os 135 arquivos de antes (112 PDFs de PP e 23 planilhas),
  conferidos por tamanho e MD5 contra o Storage;
- `manifesto.json`: caminho, tamanho, MD5 e SHA-256 de cada um;
- `banco.json`: os valores de antes de cada campo que muda.

Para voltar um arquivo, basta subi-lo ao mesmo caminho. Para voltar um
valor, `banco.json` tem o id e o valor. A pasta é apagada depois da
conferência do Tiago.

## 10. Execução (29/09/2026)

Na ordem, com os scripts de `scripts/rastros-codigo-anterior/`:

1. **Cópia** (`1-backup.ts`): 135 arquivos, 4,78 MB, cada um conferido por
   tamanho e MD5 contra o Storage.
2. **Ensaio** (`2-refazer-pdfs.ts`): as 47 PPs refeitas numa pasta local e
   comparadas linha a linha com o documento de antes. Nenhum erro:
   - 34 iguais, fora a linha do código;
   - 11 do Beats com cliente e marca de hoje;
   - PP-00040 e PP-00091 com a tabela das parcelas.

   Datas de emissão de 08/09 a 28/09, as mesmas impressas. 42 PPs têm a
   foto bancária da emissão; as outras 5 usam o cadastro, igual ao
   documento de antes.
3. **Gravação** (`--gravar`): nenhuma PP, parcela ou arquivo tinha mudado
   desde a cópia. Os 47 PDFs subiram, e cada um foi baixado de volta e
   conferido por SHA-256.
4. **Migration `20260929700001`**, ensaiada antes numa transação desfeita.
   A primeira rodada do ensaio parou numa contagem errada minha (esperei 17
   conversões no registro; são 18) sem gravar nada. Aplicada:
   - 2 PPs e 4 parcelas com o ponteiro novo;
   - 1 descritivo, 5 linhas de importação e 1 nome de versão;
   - registro de números usados: saíram as 34 linhas no formato antigo e
     entraram 18 no formato com "P" (as outras 16 já tinham o par); o
     registro foi de 56 para 40 linhas;
   - `codigo_anterior` esvaziado em 16 projetos, 39 orçamentos, 6 projetos
     do financeiro e 23 jobs;
   - `updated_at` idêntico nas 7 tabelas antes e depois, conferido por um
     hash de id + data dentro do bloco e de novo por fora.
5. **Arquivos** (`3-apagar-arquivos.ts`): saíram 67 PDFs (63 soltos e os
   4 por parcela) e 23 planilhas. Cada um foi conferido contra a cópia
   antes de sair, e o Storage confirmou os 90.
6. **Conferência** (`4-conferir.ts`):
   - 47 PPs e 47 PDFs no bucket; nenhum PDF solto, nenhum ponteiro sem
     arquivo;
   - todos com uma linha de código só, "Job: <código do job da PP>", e
     nenhum código antigo no texto;
   - nenhum nome de arquivo com código antigo.

   No banco inteiro, código antigo só aparece em `audit_events.metadata`:
   319 linhas, a mais recente de 28/09 às 05:46 UTC (a troca da 114).
   Nenhuma é nova.
7. **Navegador**, logado como administrador no servidor local, com o mesmo
   banco:
   - a ficha do TES-1003/26 sem "Código anterior" e com o descritivo novo;
   - listas de Jobs e de projetos, fila e abertura do financeiro, página do
     projeto do financeiro e do projeto da produção, sem erro;
   - o documento novo da PP-00091, conferido em imagem contra o antigo.

**Numeração:** a decisão nasceu como 125 e virou 126 antes do push, porque
a 125 já era citada no código em andamento da frente de lançamentos e
baixas. O SQL gravado no histórico de migrations do banco foi aplicado antes
da troca, e por isso o comentário do topo ainda diz "Decisão 125"; o
arquivo do repositório diz 126. O comando é o mesmo.

**Pendente:** remover as colunas `codigo_anterior` (§8).
