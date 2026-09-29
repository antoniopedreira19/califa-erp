# 129 — A planilha importada é descartada depois da importação

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migrations:** `20260929700003_importacao_sem_arquivo_guardado.sql`
(`arquivo_path` aceita nulo) e `20260929700004_importacoes_sem_caminho.sql`
(limpeza do que já estava guardado, depois do deploy).

---

## 1. A regra

Nas palavras do Tiago, em 29/09/2026, ao saber que o arquivo ficava
guardado:

> Descartar depois de importar, vamos fazer isso. Nao consigo pensar em um
> motivo para giardarmos o arquivo, sendo que a planilha do sistema já
> conterá os seus dados, e não poderemos acessar esse arquivo de nehhum
> modo. Qualquer exportação tambem sera feita pela planilha no sistema,
> logo penso que seja melhor descartarmos depois de importar mesmo.

E, sobre o que já estava gravado: **aplicar a tudo** — apagar o arquivo que
restava e limpar o caminho das linhas antigas do histórico.

## 2. Como era

Toda importação confirmada guardava o XLSX original no bucket
`orcamento-importacoes`:

- **Importar na versão** (nova versão e substituir): o arquivo ia da pasta
  de envios para `<tenant>/<orcamento>/<importacao>-<nome>`.
- **Editor do orçamento do projeto** (rascunho e agregada): o mesmo, no
  "Salvar".
- **Planilha do projeto** (decisão 041): o arquivo subia para
  `<tenant>/projeto-<id>/` na confirmação.

Nenhuma tela lia o arquivo guardado nem o histórico
(`orcamento_importacoes`): o app só gravava. E havia vazamentos: o
rascunho abandonado (a decisão 110, §3, deixou de fora de propósito), a
planilha trocada no mesmo orçamento, o orçamento removido do rascunho e o
orçamento desfeito quando o lote do "Salvar" falhava no meio deixavam o
arquivo esquecido no Storage.

## 3. Como fica

O arquivo é só de passagem: sobe para `<tenant>/envios/` (é assim que ele
fura o limite de 1 MB da Server Action, decisão 110), é lido, e sai.

| Porta | Quando o arquivo sai |
|---|---|
| Importar na versão (nova versão ou substituir) | Logo depois de gravar a versão e o histórico. Fechar o modal sem gravar já apagava. |
| Editor do orçamento do projeto | No fim do "Salvar", com o lote inteiro gravado (se um orçamento falha, o "Salvar" de novo ainda lê a planilha). A tela descarta também o arquivo trocado, o do orçamento removido, o que sobra depois de salvar (importação num orçamento que já existia, que não vai no payload) e tudo o que estiver pendente ao sair da tela sem salvar. |
| Planilha do projeto (041) | Não sobe mais: chega no corpo da action e some com ela. |
| Qualquer resto (aba fechada no meio, falha no descarte) | Limpeza dos envios do tenant com mais de um dia, a cada envio novo (`limparEnviosAntigos`). |

**O histórico continua:** cada importação segue registrada em
`orcamento_importacoes` — nome e tamanho do arquivo, aba, linhas lidas,
importadas e ignoradas, avisos, autor e data —, agora com
`arquivo_path` nulo. A auditoria (`versao_orcamento.importada` e as
irmãs) não mudou.

## 4. O que já estava guardado

Na hora da decisão havia 1 arquivo no bucket (a planilha BUDWEISER
importada em 29/09 no TES-P002/26-04, de teste) e 12 linhas do histórico
com caminho — 11 delas apontando para planilhas já apagadas na decisão
126. Com o OK do Tiago, o arquivo sai e as 12 linhas ficam sem caminho
(`20260929700004`), depois do deploy, para pegar também o que o código
antigo guardar até lá.

## 5. Testado

No servidor local, logado como administrador, no TES-P001/26, pelos
fluxos reais, com a exportação interna do "Teste A":

1. **Fechar o modal sem gravar:** o arquivo sumiu de `envios/`.
2. **Substituir versão** ("Teste novo", v1 vazia): 4 itens gravados,
   histórico sem caminho, nenhum arquivo.
3. **Nova versão importada** ("Teste novo", v2 "Importada de
   teste-129-descarte.xlsx"): idem.
4. **Rascunho do editor do projeto cancelado** ("Sair sem salvar"): o
   arquivo, que ficava em `envios/` até o "Salvar", sumiu, e nada foi
   gravado.
5. **Rascunho salvo:** nasceu o "Teste 129 descarte" (TES-P001/26-17), v1
   com 4 itens, histórico sem caminho, `envios/` vazia.

Ficaram no TES-P001/26, como dado de teste: a v1 preenchida e a v2 do
"Teste novo", e o orçamento "Teste 129 descarte".

## 6. Onde está no código

- `lib/importacao/envio.ts`: `descartarEnvio` e `limparEnviosAntigos`; o
  `arquivarEnvio` saiu.
- `app/(app)/orcamentos/_importacao/envio-actions.ts`: a limpeza roda em
  `prepararEnvioPlanilha`.
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/importar-actions.ts`,
  `_rascunho/salvar-em-lote.ts` e `_selecao/importar-actions.ts`: histórico
  sem caminho e descarte.
- `app/(app)/orcamentos/[projetoId]/agregado/editor-agregado.tsx`: o
  descarte do lado da tela.
- `lib/types.ts`: `OrcamentoImportacao.arquivo_path` é `string | null`.
