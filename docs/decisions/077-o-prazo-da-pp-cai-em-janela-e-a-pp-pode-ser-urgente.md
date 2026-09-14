# 077 — O prazo da PP só cai em janela de pagamento, e a PP pode ser urgente

**Data:** 2026-09-14
**Status:** aceita
**Contexto:** formulário de gerar/editar PP (`gerar-pp-drawer.tsx`),
correção da PP rejeitada (`editar-pp-drawer.tsx`), `actions-pp.ts`, e no
financeiro a lista de aprovação, a tela da PP e Títulos a Pagar. Pedido do
Tiago em 14/09/2026; o desenho "Janelas, parcelas e urgência" foi aprovado
com as respostas **1a, 2a, 3a, 4a, 5a, 6a, 7a**.

## O que o código mostrou antes do desenho

- A abertura de job **não trata feriado**: a regra das janelas morava em
  `curva.ts` e rolava só sábado e domingo. "Exatamente como a abertura" e
  "rolando em feriado" eram regras diferentes — daí a pergunta 1.
- O envio ao financeiro já tinha **três** travas, não duas: job não aberto
  (decisão 056), abertura em revisão (decisão 040) e, fora da verba de
  produção, PP sem NF anexada. O "Gerar e enviar" herda as três.
- Havia 8 PPs editáveis (geradas ou rejeitadas), algumas com prazo fora
  das janelas — daí a pergunta 6.

## A regra

### 1. Janelas de pagamento, num lugar só

Dia **08** e dia **20** de cada mês; caindo em sábado ou domingo, vale a
segunda-feira seguinte. A regra saiu de `curva.ts` para
`lib/calculos/janelas-pagamento.ts`, e a abertura de job passou a importar
de lá (`curva.ts` reexporta os mesmos nomes).

⚠️ **Feriado continua fora (pergunta 1a).** Não existe calendário de
feriados no sistema. Duas janelas próximas já caem em feriado —
**20/11/2026** (Consciência Negra, nacional) e **08/12/2026** (Conceição
da Praia, municipal em Salvador) — e hoje o sistema as aceita. Quando o
calendário existir, o ajuste entra em `ajustarParaDiaUtil` e vale para a
abertura e para a PP de uma vez.

### 2. Prazo de pagamento

- O calendário só acende janelas, e nunca no passado. O prazo sugerido é a
  primeira janela **depois** de hoje (era hoje + 15 dias).
- O servidor checa de novo, nas três portas: gerar
  (`finalizarPedidoCompra`), editar a gerada (`editarPedidoCompraGerada`) e
  corrigir a rejeitada (`reenviarPedidoCompra`). Sem isso a regra
  dependeria só do calendário.
- "Hoje" é o de São Paulo (`hojeEmSaoPauloIso`): o servidor da Vercel roda
  em UTC, e depois das 21h o "hoje" já seria amanhã.

### 3. Parcelas (perguntas 5a e 7a)

- Seletor **1 a 6** e uma sétima opção, **"Mais de 6…"**, que abre o
  número para digitar de **7 a 24**. O teto do servidor caiu de 36 para 24
  — o maior parcelamento gravado até 14/09/2026 tinha 12.
- As **datas ficam travadas**: cada parcela é a **mesma janela** do 1º
  vencimento no mês seguinte (08/10 → 08/11 → 08/12; a janela do 08 que
  cai no domingo vira 09). São calculadas **a partir da 1ª**, não em
  cadeia: um 20 que escorregou para 21 não arrasta a seguinte para uma
  "janela do 21".
- Os **valores** continuam editáveis, e a soma continua tendo de fechar
  com o valor da PP.
- Na correção da rejeitada, trocar o prazo refaz as parcelas pela mesma
  regra (era "+1 mês" a partir da data, que tirava as seguintes das
  janelas).

### 4. PP anterior à regra (pergunta 6a)

A data gravada fora das janelas aparece com o aviso "Prazo fora das
janelas de pagamento — esta PP é anterior à regra". **Salvar sem mexer
mantém**; qualquer troca só aceita janela. No servidor, cada data é
comparada com a data **gravada na mesma posição**: igual passa, diferente
precisa ser janela e não pode estar no passado.

### 5. Pagamento urgente (perguntas 2a e 7a)

- Logo abaixo de prazo e parcelas, um interruptor **"Pagamento urgente"**.
  Ligado, pede **Justificativa**, com pelo menos **10 caracteres** — o
  mesmo mínimo do motivo de rejeição (`PP_URGENTE_JUSTIFICATIVA_MIN`).
- **A urgência não libera prazo fora das janelas.** A produção marca e
  justifica; quem antecipa é o financeiro, ao escolher a data na
  aprovação.
- `urgente_por` e `urgente_em` guardam quem **marcou** e quando, e só
  mudam na virada: corrigir a justificativa de uma PP que já era urgente
  não troca o autor. Desmarcar zera os quatro campos.
- Constraint no banco (`pedidos_compra_urgente_justificada`): urgente sem
  justificativa é um estado que nenhuma porta consegue gravar.

### 6. No financeiro (perguntas 3a e 4a)

- **Lista de aprovação:** as urgentes **em avaliação** sobem para o topo,
  com faixa vermelha na borda e a divisória "Demais PPs". Busca e filtros
  continuam valendo para elas. A etiqueta "Urgente" aparece em avaliação e
  aprovada.
- **Tela da PP:** etiqueta "Urgente" no cabeçalho e, no topo do dossiê, o
  bloco com a justificativa, quem marcou e quando.
- **A data escolhida na aprovação continua livre** — é justamente onde a
  urgência se resolve.
- **A urgência segue depois de aprovada:** o título a pagar sobe para o
  topo de Títulos a Pagar com a etiqueta e a mesma justificativa, até ser
  pago.
- **Vencimento original** no dossiê perdeu o amarelo — dois alertas
  disputariam o mesmo olho. Ficou cinza neutro, com o selo "✓ janela do
  dia 08/20" ou "fora das janelas".

### 7. "Gerar e enviar ao financeiro"

- O rodapé do formulário ganha o segundo botão ("Salvar e enviar ao
  financeiro" na edição). Ele só fica liberado quando o servidor aceitaria
  o envio: job aberto, abertura fora de revisão, NF anexada fora da verba
  de produção e — no AR fora do save — as PPs fechando o orçado do item
  (decisão 062).
- ⚠️ A trava do AR **escapou do desenho** e apareceu no teste de
  14/09/2026: no Item 3 (AR) do JOB-0029, a PP de verba foi gravada e o
  envio voltou recusado ("faltam R$ 1.000,00"). O formulário fez o que
  devia quando o envio falha — a PP ficou gerada e o motivo foi para o
  aviso —, mas não deveria ter oferecido o botão. Desde então ele checa o
  orçado a fechar antes, e o aviso com motivo fica 12 s na tela (eram 4 s,
  curtos para ler a frase).
- Travado, o principal volta a ser "Gerar PP" e a frase ao lado diz por
  quê — o mesmo texto do painel do item. Botão cinza mudo parece defeito.
- Acima do planejado, o "tem certeza?" vem **antes** de gravar, com os
  mesmos números do painel.
- Gravar e enviar são as duas actions de sempre, uma depois da outra. Se o
  envio não sair, a PP fica **gerada** — um estado válido — e a mensagem
  diz por quê. As travas do servidor valem igual.

## Banco

`supabase/migrations/20260914170001_pp_urgente.sql` — aditiva:
`urgente` (boolean, default false), `urgente_justificativa`,
`urgente_por` (FK `profiles`), `urgente_em`, a constraint acima, índice
parcial das urgentes e índice da FK. As PPs existentes nasceram não
urgentes; nenhum dado mudou. RLS e GRANT da tabela já cobrem as colunas.

## Conferido em 14/09/2026 (Projeto Teste · JOB-0029)

- **Formulário:** prazo sugerido 21/09 (o 20 é domingo); em setembro o
  calendário só deixa clicar o 21. Três parcelas saíram 21/09 · 20/10 ·
  20/11, travadas, com 1.333,33 · 1.333,33 · 1.333,34. "Mais de 6…" com 10
  montou 10 parcelas.
- **Justificativa curta:** 5 caracteres barraram na tela (borda e contador
  em vermelho) e a constraint recusou no banco, numa transação desfeita.
- **PP-00056** (fornecedor, sem NF): "Gerar e enviar" travado com "Anexe a
  NF…"; gerada urgente, parcelas certas no banco, marcada por Tiago
  Mendonça.
- **PP-00057** (verba, Item 3 · AR): revelou a trava do AR descrita acima.
  Corrigido e reconferido: o botão agora trava com "faltam R$ 1.000,00".
- **PP-00058** (verba, Item 1 · B): "Gerar e enviar" → "gerado e enviado
  ao financeiro". No financeiro: topo da lista com faixa, etiqueta e
  "Demais PPs"; tela com etiqueta, bloco da justificativa e "✓ janela do
  dia 20"; aprovada com pagamento em **16/09** (data livre, antes da
  janela); o título apareceu no topo de Títulos a Pagar com etiqueta e
  justificativa.
- **JOB-0007** (aguardando abertura): botão travado com a frase do painel e
  "Gerar PP" como principal.
- **PP-00044** (JOB-0025, prazo 24/09) e **PP-00007** (JOB-0010,
  rejeitada): formulários abertos **sem salvar** — o primeiro mostra o
  aviso da PP anterior à regra; o segundo, o calendário de janelas e o
  bloco de urgência.
- **Funções de janela:** 14 casos-limite passaram (domingo, virada de ano,
  escada que não vira "janela do 9", reexport de `curva.ts`).

**Não conferido:** a ordenação de Títulos a Pagar isolada (o título urgente
também era o de data mais próxima) e a recusa do servidor para data fora da
janela chamada por fora da tela — a regra está nas três actions, mas só a
tela foi exercitada.

## O que ficou de fora

- **Feriados** — entrega própria, para a abertura e para a PP juntas.
- A ficha de leitura da PP no job (`ver-pp-drawer.tsx`) e o PDF da PP não
  mostram a urgência: o pedido citou a lista de aprovação e a tela da PP.
- O pop-up de aprovação não mudou (pergunta 3a).
