# 244 — Nada se concilia sozinho: o que é certo fica em Prontos para conciliar

**Data:** 2026-11-06
**Status:** aceita e implementada em 06/11/2026.
**Quem decidiu:** Tiago, em 06/11/2026: "Não gosto da ideia de coisas serem feitas sem passar por ninguém" — opção 1 ("Pode fazer 1"), entre desligar a automação inteira e desligar só o que cria registro.
**Revê:** a [201](201-o-que-se-resolve-sozinho-na-importacao.md) inteira (o que se resolvia sozinho na importação) e o "N resolvidas sozinhas" da [243](243-conciliacao-automatica-fila-por-acao.md).

## O problema

Pela 201, ao abrir a Conciliação automática depois de importar, a tela conciliava sem clique: a baixa já lançada que batia com o banco (só ligava), a linha da planilha com confiança alta, a tarifa pela regra do histórico, o título certo (dava a baixa) e a remessa que somava centavo a centavo. Até 06/11/2026, 304 das 1.820 linhas importadas tinham se resolvido assim (201 da planilha, 54 tarifas, 49 baixas já lançadas; nenhum título nem remessa).

O critério de certeza era o mesmo de "Prontos para conciliar"; a diferença era só se a automação tinha rodado. E uma ligação automática também pode estar errada (duas baixas do mesmo valor perto da mesma data).

## Decisão

1. **Nada se concilia sem alguém clicar.** Tudo o que a automação fazia fica em **Prontos para conciliar**, com o motivo na Situação.
2. **"Conciliar os N"** de Prontos concilia a divisão inteira, uma linha por vez, pelas mesmas actions dos botões, e registra quem conciliou. A remessa grande (a da folha) continua indo em partes de 20 títulos.
3. **O aviso "N resolvidas sozinhas · Desfazer"** sai do topo. As linhas que já tinham se resolvido sozinhas continuam com "Conciliado sozinho" na Situação, porque é o que aconteceu, e com o Desfazer de cada linha.
4. A área de importar diz: "Linhas repetidas não entram; o que é certo vai para Prontos para conciliar".

## Como fica no código

- `aba-banco.tsx`: saiu o efeito da automação (a reserva `marcarLinhasAvaliadas` e as baixas sozinhas) e o estado "Resolvendo sozinho…".
- `motor-da-conta.ts`: saíram `automacaoDaLeitura` e `textoDosSozinhos`; o teste da automação saiu, e os da planilha passaram a conferir a confiança alta (o que vai para Prontos).
- `fila-da-conta.tsx`: saíram o aviso das resolvidas sozinhas e o desfazer em lote.
- Sem migration. A RPC `marcar_linhas_avaliadas` e a coluna `avaliada_em` ficam no banco, sem uso pela tela (apagar é mudança destrutiva e não é necessária).
