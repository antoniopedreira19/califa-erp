# Errata na planilha — o que olhar no teste ponta a ponta

**Data:** 2026-08-28
**Combinado com o Tiago:** quando as alterações em curso fecharem, rodar um
teste completo das últimas implementações no navegador, logado, e corrigir
o que aparecer.

Este arquivo existe porque a errata (decisão 030) foi implementada e
verificada **só até a borda da gravação**. Todo o modo de edição é rascunho
local: conferi digitação, recálculo ao vivo, linha nova, linha vermelha,
barra do rodapé e pop-up de confirmação sem escrever uma linha no banco.
O caminho do servidor nunca rodou.

---

## 1. O que ficou SEM verificação nenhuma

### 1.1 Gravar a errata

`registrarErrata` nunca foi executada. Ela grava `jobs_erratas` +
`jobs_erratas_itens`, cria as linhas novas em `jobs_itens_orcado`, aplica
as correções, apaga as remoções e atualiza `jobs.valor_total` /
`faturamento_previsto` / `faturamento_save_previsto`.

**No teste:** uma errata com as três ações de uma vez — corrigir uma linha
(R$ unitário, QT e D/M), criar uma linha normal e remover outra. Conferir
que os números do pop-up batem com os da planilha DEPOIS de confirmar, ao
centavo. É onde uma divergência apareceria.

### 1.2 A linha vermelha gerando PP — o ponto mais importante

A linha vermelha nasce com orçado zero, e o trigger
`pp_valida_saldo_do_item` recusa PP que passe do orçado da linha. A
isenção que eu escrevi (`if v_vermelha then return new`) **nunca foi
exercitada**.

**No teste:** criar linha vermelha por errata, emitir uma PP nela de
qualquer valor, e conferir que passa. Depois emitir uma segunda PP na
mesma linha — também tem que passar, porque não há teto. Numa linha
normal, a trava tem que continuar recusando acima do orçado.

Se isto falhar, a linha vermelha não faz a única coisa que ela faz.

### 1.3 A âncora de realizado da linha nova

Toda linha criada por errata ganha uma linha em `jobs_itens_realizado` com
`item_id` nulo e `job_item_orcado_id` preenchido. Se o insert falhar, a
action desfaz tudo e devolve mensagem própria.

**No teste:** conferir que a calha da linha nova oferece "Gerar PP" logo
depois de confirmar a errata, sem refresh manual.

### 1.4 Devolver o job ao mural, e destravar

`abertura_em_revisao` nunca foi marcada por código real.

**No teste:** depois da errata, conferir que (a) o job aparece na faixa
**Erratas** do mural de abertura, com "Revisar abertura"; (b) o pop-up de
resumo mostra a descrição escrita e os valores antes/depois; (c) o botão
"Enviar job para faturamento" sumiu da tela do job; (d) chamar a action
`enviarJobParaFaturamento` pelo console recusa com a mensagem da revisão
(o bypass de Server Action que já usamos); (e) salvar a abertura no
financeiro limpa a marca e o botão volta.

### 1.5 As travas de remoção

`barrarRemocao` recusa apagar linha com PP (mesmo cancelada), com BV, em
save ou com save consumido. Nenhuma das quatro foi exercitada.

**No teste:** tentar remover a linha do GP (que tem PP-00009) e conferir
que a mensagem nomeia a PP. As FKs discordam entre si — PP é `restrict` e
`saves_consumos` é `cascade` —, então uma falha aqui pode apagar consumo
de save em silêncio.

---

## 2. Armadilhas conhecidas

### 2.1 O re-chaveamento da planilha

A planilha do job passou a se chavear por `jobs_itens_orcado.id`
(commit `56ba52e`). O backfill foi conferido (123 realizados, 6 BVs, zero
órfãos) e as telas foram abertas, mas **nenhuma PP ou BV novo foi criado
depois da mudança**.

**No teste:** emitir uma PP e lançar um BV em linhas que vieram da versão,
e conferir que aparecem na planilha. É o caminho que a migration mexeu.

### 2.2 BV em linha de errata não existe

Decisão consciente (030): as actions de BV carregam o contexto pelo item da
versão, que a linha de errata não tem. Linha nova nasce tipo `B`, que não
aceita BV, então não estorva — mas se alguém trocar o tipo dela para `A`,
o botão de BV simplesmente não aparece. `itens_bv.job_item_orcado_id` já
existe para quando isso incomodar.

### 2.3 Errata anterior à abertura não devolve o job

`devolveAoMural` só marca quando `data_abertura_financeiro` não é nula. Uma
errata em job que ainda está na fila não tem o que revisar.

**No teste:** confirmar que uma errata em job pré-abertura NÃO cria faixa
de Erratas no mural.
