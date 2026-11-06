# 241 — O arquivo da PP com o fornecedor no nome, o baixar na linha e a PP aberta ao lado do painel do item

**Data:** 2026-11-06
**Status:** aceita e implementada em 06/11/2026.
**Quem decidiu:** Tiago, em 06/11/2026, no protótipo "Baixar e ver a PP" (proposta D, sugerida por ele no comentário do protótipo: "D Aprovado. Pode implementar").
**Origem:** pedido da produção: "Quando for salvar o arquivo da PP, poderia vir com o nome do fornecedor além do número da PP, como era no Publi."

## O problema

- O PDF da PP salvo pela tela saía como `PP-00613.pdf`. Aberto pelo olho do painel do item, numa aba nova, saía com o nome do bucket (`pp-PP-00613.pdf`). Para a produção, que manda a PP para o fornecedor, o arquivo não dizia de quem era.
- Para baixar, era preciso abrir o documento primeiro: não havia atalho na linha da PP.
- No painel "Destrinchar realizado", o olho tirava a pessoa da tela (aba nova). Na aba PPs, abria a tela lado a lado da aprovação com o espaço da NF vazio quando ainda não havia nota.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| 1 | Nome do arquivo | `PP-00613 - FORNECEDOR TESTE LTDA.pdf`: o número, um hífen e quem a PP paga. Quem a PP paga é o fornecedor (razão social), a plataforma do cartão corporativo ("Cartão corporativo — …", decisão 209) ou quem recebe a verba. Sem ninguém, só o número. Saem os caracteres que o sistema de arquivos não aceita, e o nome para em 80 caracteres |
| 2 | Onde o nome vale | Em todo lugar que baixa o PDF da PP: a linha da aba PPs, a linha do painel do item, a tela da PP (a da produção e a da aprovação do financeiro, que é a mesma), a conferência dos documentos do envio e o ⓘ das planilhas de títulos. A NF e os outros anexos continuam com o nome com que foram enviados |
| 3 | Baixar na linha | Botão de ícone ao lado do olho, na linha da aba PPs (coluna de 46 para 82 px) e no cartão da PP do painel do item. A dica mostra o nome do arquivo. Toda parcela baixa o mesmo documento (decisão 112) |
| 4 | Olho no painel do item | Abre a PP no espaço livre à esquerda do painel, com o fundo escuro da tela da aprovação: a PP sozinha, ou PP e NF lado a lado quando a NF já foi anexada. Sem a coluna de dados (o painel ao lado já mostra a PP). "Baixar PP" no topo. O painel continua funcionando: o olho de outra PP troca o documento. Sai pelo "Fechar" ou pelo Esc, e o painel fica aberto |
| 5 | Olho na aba PPs e no "Visualizar" do Ver PP | Sem painel ao lado, a tela cheia de sempre, mas só com o que existe: sem NF, a PP ocupa o espaço do anexo vazio. Os dados abrem recolhidos na calha da direita. "Baixar PP" no topo |
| 6 | Largura do painel do item | 540 px (era 500), para o quarto botão caber no cartão. Com 4 botões (PP em avaliação com NF), o cartão já passava 16 px da borda |
| 7 | Financeiro | A tela de aprovação não muda além do nome do arquivo: o baixar continua no cabeçalho do PDF, com os dados abertos |

## Como fica no código

- `lib/nome-do-arquivo-da-pp.ts`: `nomeDoArquivoDaPP(codigo, quem)` e `quemVaiNoNomeDoArquivo(pp)`, com teste.
- `pp-tela.tsx`: o nome no painel do PDF; na leitura, "Baixar PP" no topo, o anexo vazio escondido e os dados recolhidos. A prop nova `aoLadoDoPainel` (largura do painel) prende a camada à esquerda dele, sem dados e sem modal (`Dialog modal={false}`), para o painel seguir clicável.
- `painel-pps-item.tsx`: o olho carrega a PP por `carregarPPParaVisualizar` (a mesma consulta da aba PPs) e abre a `PPTela` por dentro do drawer, para o Radix empilhar as camadas. Campo obrigatório `nomeDoArquivo` no `PPDoItem`, montado em `job-item-realizado-table.tsx`.
- `job-pps-section.tsx`: botão de baixar ao lado do olho.
- `conferencia-dos-documentos.tsx`: prop obrigatória `nomeDoArquivoDoPdf`.
- `actions-detalhes-do-titulo.ts`: a consulta da PP traz fornecedor, cartão e titular da verba para o nome.
- O baixar busca o arquivo e salva por `blob:` (`baixarArquivo`), que é o que permite escolher o nome: `<a download>` não vale para a URL assinada do Storage. O "Abrir em outra aba" continua abrindo o PDF no visualizador do navegador, e salvo de lá sai com o nome do bucket.
- Sem migration.
