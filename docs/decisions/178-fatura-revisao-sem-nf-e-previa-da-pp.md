# 178 — "Fatura" no tipo do anexo, a revisão da PP sem a linha "Nota fiscal" quando não há NF, e a prévia da PP na conferência lado a lado

**Data:** 2026-10-15
**Status:** aceita e implementada (15/10/2026).
**Quem decidiu:** Tiago, em 15/10/2026, a partir do retorno de uma produtora
com dois prints, e depois de três rodadas de protótipo com os componentes
reais.
**Revê:** a [153](153-pp-a-emitir.md), entrega 3 (no formulário, a tela lado
a lado não tinha o PDF da PP) e a linha "Nota fiscal" da revisão "Gerar o
Pedido de Produção?"; a [161](161-pp-por-boleto-ou-chave-aleatoria.md) §5
("a nota" da PP paga por boleto passa a aceitar a fatura).
**Migration:** `20261015950001_documento_tipo_fatura.sql`.

## O que aconteceu

Uma produtora anexou a fatura de locação de banheiros químicos às PP-00197 e
PP-00198 (DEE-1001/26) e marcou o arquivo como **Recibo**, porque a lista de
tipos não tinha opção melhor: na locação de bens móveis o fornecedor emite
fatura, não nota fiscal de serviço. Na revisão "Gerar o Pedido de
Produção?", a linha **"Nota fiscal"** disse "Ainda sem os dados da nota — são
pedidos no envio ao financeiro", e ela entendeu que o envio ia travar.

O envio não travava: ele pede um anexo, o tipo e o número de cada documento,
e os dados da NF só quando o arquivo é marcado NF. A frase vinha de a linha
"Nota fiscal" aparecer em toda PP fora da verba, com ou sem NF anexada.

Na mesma rodada, o Tiago viu no protótipo que a tela "Ver documentos lado a
lado" do formulário mostrava só o anexo, e pediu a prévia da PP ali, para
conferir a PP com o documento antes de gerar.

## A regra

1. **"Fatura" é um tipo de documento do anexo**, entre Recibo e Boleto:
   NF, Recibo, **Fatura**, Boleto, Contrato, Outro. É genérica (o Tiago
   preferiu a "Fatura" à "Fatura de locação"); o contrato de locação segue
   no **Contrato**, que já existia.
   - Pede só o **número do documento**, como o Recibo. Não é NF: não abre
     os dados da nota, não entra no cadastro de notas (decisão 152) nem no
     fiscal.
   - Vale como **comprovante da despesa**, como o recibo
     (`DOCUMENTO_TIPOS_FISCAIS`): entra na coluna Documento e vale como "a
     nota" da PP paga por boleto (161 §5). Boleto + fatura passa no envio.
   - Aparece também na lista dos anexos do financeiro (conta avulsa e
     desembolso), que leem a mesma lista de tipos.
   - A **prestação de contas da verba** continua só NF ou recibo (a trava é
     da função `enviar_prestacao_verba`, que não mudou).
2. **A revisão mostra a linha "Nota fiscal" só com arquivo marcado NF**:
   com os dados da nota, ou "Ainda sem os dados da nota — são pedidos no
   envio ao financeiro" quando falta algum. Sem NF anexada, a linha não
   aparece. A linha **"Anexos"** passou a mostrar o número de cada
   documento: "Fatura 0129-2026 · arquivo.pdf". Vale também para a revisão
   da edição da PP gerada (173).
3. **A tela lado a lado do formulário mostra a prévia da PP** (na PP a
   emitir nova, na edição dela e na edição da PP gerada), em três colunas:
   prévia da PP, documento anexo, documentos e dados.
   - A prévia é o PDF que a geração vai imprimir, montado pelo mesmo
     gerador (`lib/pdf/pedido-compra.ts`) com os dados do formulário de
     quando a tela abre: fornecedor, valor, parcelas, CNPJ da PP.
   - **Marcada como prévia:** "PRÉVIA" no lugar do código, "Não vale como
     PP" embaixo, a marca d'água "PRÉVIA" em toda página e o selo "Prévia"
     no cabeçalho do painel ("Com os dados do formulário · não vale como
     PP").
   - **Sem baixar:** o painel não tem os botões de baixar e de abrir em
     outra aba, e o visualizador abre sem a barra (`#toolbar=0`), que traz o
     baixar e o imprimir. O navegador não deixa bloquear de todo (o atalho
     de salvar ainda funciona): quem protege é a marcação — o arquivo não
     tem código e diz "PRÉVIA" em toda página.
   - **Nada é gravado:** nem no banco, nem no Storage, nem na auditoria. O
     PDF volta em base64 e a tela o abre num `blob:`, que sai da memória ao
     fechar.
   - Com o formulário incompleto, o painel diz o que falta ("A prévia
     aparece quando o fornecedor estiver escolhido.").
   - O envio ao financeiro não muda: lá o painel mostra o PDF da PP
     gerada, com baixar e abrir em aba.

## O que não muda

- Os anexos antigos marcados Recibo ou Outro ficam como estão: o tipo não
  se adivinha pelo nome do arquivo. Quem quiser trocar troca no envio ou na
  edição.
- A trava do envio (decisão 152) é a mesma: anexo, tipo e número; os dados
  da NF só no arquivo NF.
- A verba de produção não tem a tela lado a lado no formulário, nem a
  prévia.

## Onde a regra mora

| Parte | Arquivo |
| --- | --- |
| Lista de tipos, rótulo e comprovantes | `lib/types.ts` (`DOCUMENTO_TIPOS`, `documentoTipoLabel`, `DOCUMENTO_TIPOS_FISCAIS`) |
| "A nota" da PP por boleto | `actions-pp.ts` (`faltaNosAnexosDoEnvio`) e `anexos-da-pp.tsx` (`ExigidosNoEnvio`, `faltaNosAnexosParaEnviar`) |
| Revisão "Gerar o Pedido de Produção?" | `pp-a-emitir-ui.tsx` (`RevisaoDialog`) |
| Prévia no servidor | `actions-pp.ts` (`previaDoPdfDaPP`, `renderizarDocumentoDaPP` com `previa`) e `lib/pdf/pedido-compra.ts` (`previa`: marca d'água e cabeçalho) |
| Prévia na tela | `conferencia-dos-documentos.tsx` (`previaDoPdf`), `components/documentos/painel-documento.tsx` (`semBaixar`, `semBarra`) e `gerar-pp-drawer.tsx` |
| Enum no banco | `public.documento_tipo` (valor `fatura`) |

Todas em `app/(app)/jobs/[jobId]/realizado/`, menos as de `lib/` e
`components/`.

## Como foi testado (15/10/2026)

- `tsc` e `lint` limpos.
- Protótipo com os componentes reais (https://claude.ai/artifact/6SdRoc3aLHj95JFcvLCqj9),
  aprovado pelo Tiago na terceira rodada.
- Migration aplicada pelo MCP e conferida: o enum com
  `nota_fiscal, recibo, fatura, boleto, contrato, outro` e o comentário do
  tipo.
- No sistema, no servidor do worktree, logado como administrador, no
  TES-1014/26 (item Passagem, Fornecedor Teste, R$ 100):
  - a lista do tipo mostrou NF, Recibo, Fatura, Boleto, Contrato e Outro;
    com Fatura, só o "Número do documento";
  - "Ver documentos lado a lado" mostrou a prévia montada pelo servidor
    (CNPJ da PP, Fornecedor Teste, R$ 100,00, TES-1014/26, "PRÉVIA" e a
    marca d'água), sem a barra do visualizador e só com o "Ver só este
    documento"; a fatura ao lado manteve baixar e abrir em aba;
  - a revisão saiu sem a linha "Nota fiscal", com "Anexos = Fatura
    0129-2026 · Fatura de Locação 0129-2026.pdf";
  - a PP a emitir gravou `fatura` no banco; gerada, virou a PP-00199 com o
    anexo `fatura`; o pop-up de envio mostrou a fatura com o número, sem
    campos de NF. A PP-00199 foi fechada sem enviar e cancelada pela tela.

## Pendências

- **As PP-00197 e PP-00198** seguem com o anexo como "Recibo 149-2026". O
  nome do arquivo diz "129-2026", mas o PDF diz "Fatura Nº 149-2026": **o
  número está certo** (conferido em 16/10/2026). Só o tipo poderia ser
  Fatura, e o GP pode trocá-lo no próprio envio.
- **Fiscal:** a fatura não entra na apuração. ~~Se a locação de máquinas e
  equipamentos deve gerar crédito de PIS/COFINS, é conversa com a
  contabilidade, para outra entrega.~~ **Resolvido em 17/10/2026: a fatura
  não gera crédito de PIS/COFINS** (Tiago). Fica fora do fiscal, como está.
- **Ler o anexo ao subir e já sugerir o tipo:** ideia do Tiago de
  16/10/2026, virou a [192](192-ia-le-o-anexo-da-pp-ao-anexar.md).
