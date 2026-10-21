# 201 — O que se resolve sozinho na importação do extrato

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 3, entrega 3C).
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seção
4.7 da especificação: o modo "Baixa sozinho o que é certo"; protótipo, o
`useEffect` "Na importação, o que é certo…" de `main.jsx`).
**Migration:** `20261021700006_linhas_avaliadas_na_importacao.sql`.

## O problema

Com as ações da decisão 200, cada linha do banco pedia um clique, até a que
não tinha o que decidir: a baixa feita à mão que bate centavo a centavo, o
título de valor exato pago na data e pela forma previstas, a tarifa de todo
mês.

## A regra

### O que se resolve sozinho

1. **A baixa feita à mão que bate com o banco** (passo 1 do motor: mesmo
   valor e sinal, até 3 dias) **se liga sozinha a qualquer momento** — na
   importação e depois dela, porque a baixa pode vir depois do arquivo. Só
   liga, com a data do banco; nenhuma baixa nova.
2. **Nas linhas que ainda não passaram pela avaliação única** da importação,
   também se resolvem sozinhos:
   - o **título certo** (confiança alta e centro de custo completo, passos 3
     e 3a): a baixa vai pela baixa em lote de sempre, com a data, a conta e a
     forma do banco, e a linha se liga a ela;
   - a **remessa que soma centavo a centavo** (passo 4);
   - a **regra do histórico** (passo 6).
3. **Não se resolvem sozinhos:** a soma de títulos da mesma contraparte
   (passo 4b), que vai para Prontos, um clique; o título que não vai pela
   baixa em lote (desembolso, fatura, estorno de verba, transferência, o
   imposto sem guia); e tudo que pede alguém (empate, juros, retenção, centro
   a escolher, divergência, sem correspondência).
4. **Cada linha é avaliada uma vez.** A que ficou para alguém decidir não se
   resolve sozinha numa leitura seguinte. A que alguém **desfez** (`sem_auto`,
   decisão 199) não se resolve mais sozinha, nem pela baixa feita à mão.

### Como roda

5. **Na aba Conciliação automática, com as mesmas actions dos botões**
   (`conciliarLinha`, `baixarEConciliar`, `lancarPelaRegra`, agora com a
   marca de quem resolveu: `p_sozinha`). Nada novo grava baixa: a baixa
   sozinha passa pelas mesmas travas e pela retenção da aprovação relida no
   servidor.
6. **A reserva:** `marcar_linhas_avaliadas(p_linha_ids)` grava `avaliada_em`
   só nas linhas pendentes que ainda não tinham e devolve as que gravou. A
   tela só baixa sozinha as linhas que a chamada devolveu: duas abas abertas,
   ou dois usuários, não baixam a mesma linha duas vezes. A linha cuja baixa
   sozinha falhar fica avaliada e pendente, na seção dela, e o aviso diz
   quantas não se resolveram e por quê.
7. **A remessa grande vai em partes.** A da folha tem dezenas de títulos, e
   a baixa em lote faz uma chamada por título: a tela manda de 20 em 20
   (`baixarPelaLinha`) e liga a linha no fim (`ligarItensALinha`), para
   nenhuma chamada passar do tempo da função na Vercel. O desfazer faz o
   mesmo com as baixas que cancela (`cancelarBaixasDesfeitas`).
8. Enquanto a automação trabalha, os botões da aba esperam ("Resolvendo
   sozinho o que é certo…").

### O que a tela diz

9. **A faixa verde** (protótipo, `banco.jsx`): "N linhas do banco se
   resolveram sozinhas: 1 baixa feita à mão que bateu com o banco; N títulos
   baixados e conciliados (valor exato, pago na data e pela forma previstas,
   ou o CNPJ do cliente no histórico; com linhas iguais, quando são tantas
   quanto os títulos desse valor); a remessa, que soma centavo a centavo; N
   tarifas pela regra do histórico. A baixa feita à mão fica na seção dela,
   logo abaixo; o resto está em Conciliados. Tudo com Desfazer."
   - **Uma diferença deliberada do protótipo:** ele diz "a remessa da folha";
     aqui é "a remessa", porque a remessa que casa pode ser de fornecedores.
10. As linhas resolvidas sozinhas dizem "Conciliado sozinho" na Situação, e
    as seções ganharam as frases do protótipo ("Na importação elas se
    conciliam sozinhas e ficam aqui, à vista"; "…e se baixam sozinhas"; "…e
    se concilia sozinha").
11. A zona de arquivo não diz mais "nada muda nos títulos até você
    conciliar": diz o que se resolve sozinho, com Desfazer.

## Como ficou no banco

- `marcar_linhas_avaliadas(uuid[]) returns uuid[]`, `SECURITY DEFINER`,
  conferindo o papel (admin ou financeiro) em cada tenant das linhas; EXECUTE
  só para `authenticated`. Nenhuma tabela mudou: `avaliada_em`, `sem_auto` e
  `resolvida_sozinha` já existiam (decisão 198), e as RPCs da decisão 200 já
  recebiam `p_sozinha`.

## Como foi conferido

- No banco, numa transação desfeita: o GP recusado ("Só admin ou financeiro
  concilia o extrato do banco."); o financeiro reserva duas linhas e, na
  segunda chamada, nenhuma.
- Testes (`conciliacao/motor-da-conta.test.ts`): a baixa feita à mão liga
  mesmo na linha já avaliada; só as não avaliadas entram na reserva (a
  desfeita também, mas não se resolve); o título certo e a remessa se
  resolvem, o título sem centro não; a faixa verde.
- No navegador, na Conta Teste, com um OFX de teste de 4 linhas e um
  pagamento avulso de teste criado pelo formulário (AV-00005, PIX, 21/10, R$
  321,45): ao importar, a devolução de verba de R$ 1.263,60 de 19/10 se ligou
  à baixa que já existia, o AV-00005 foi baixado e conciliado sozinho, a
  tarifa de R$ 12,34 entrou pela regra TAR, e a linha de R$ 77,70 ficou
  avaliada e pendente; a faixa verde com as três. O Desfazer de cada uma
  devolveu tudo (o AV-00005 em aberto, sem baixa; a tarifa apagada, a regra
  com 0 usos), e nada voltou a se resolver sozinho na leitura seguinte.

## Pendências

1. **A automação roda quando alguém abre a aba** Conciliação automática da
   conta (a importação abre a aba), e não num processo do servidor: um
   extrato importado e nunca aberto não se resolve sozinho. Hoje a
   importação só existe pela aba, então os dois andam juntos.
2. **A remessa grande não foi testada com folha de verdade:** em 21/10/2026
   não existe folha no banco (nenhum título nem baixa de folha), e folha de
   teste não se gera (ela cria uma linha por colaborador). As partes de 20
   foram conferidas só no código.
