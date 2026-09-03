# 030 · A errata acontece na planilha, e existe linha vermelha

**Data:** 27/08/2026
**Design:** `Planilha Interna - Alterar Orcado (Errata).dc.html` (projeto Claude Design `69342d83`)

## O que mudou

"Alterar orçado" abria um drawer com uma **segunda tabela**, onde se corrigia
o R$ unitário e o tipo de custo de linhas já existentes. Ele agora liga o
**modo errata** na planilha que já está na tela.

Com isso a errata deixou de fazer uma coisa e passou a fazer três:

| Ação | O que a errata pode fazer |
|---|---|
| **Corrigir** | R$ unitário, **QT**, **D/M** e tipo de custo |
| **Criar** | linha normal, ou **linha vermelha** |
| **Remover** | linha que ainda não virou documento nem dinheiro |

QT e D/M passaram a ser editáveis. Até aqui a regra era o contrário — "QT e
D/M do orçado ficam como foram aprovados" —, e ela cai: quem corrige um
orçado precisa poder dizer que eram três diárias e não duas. O tipo de custo
continua editável, com a trava de PP ativa / BV confirmado que já existia.

## A linha vermelha

É o custo que o orçamento **não previu** e que alguém precisa pedir mesmo
assim. Ela nasce com **orçado e planejado zerados** e só recebe REALIZADO,
por Pedido de Produção.

Duas consequências que não são óbvias:

1. O banco **cobra** os zeros (`chk_jio_linha_vermelha_zerada`). O total
   alimenta valor do job e faturamento previsto: uma linha vermelha com
   orçado furaria os dois sem ninguém perceber.
2. Ela é **isenta do teto do orçado** na emissão de PP. O trigger
   `pp_valida_saldo_do_item` barra PP que passe do orçado da linha — com
   orçado zero, nenhuma PP passaria, e a linha não faria a única coisa que
   faz.

## Quem pode o quê

- **Criar linha normal** e **remover linha** ficam atrás de acesso.
- **Criar linha vermelha**, não.

Hoje todo mundo passa: os dez profiles do tenant são `administrador`. A
separação existe para o dia em que os papéis entrarem, e para o gate nascer
num lugar só (`podeEditarLinhas`, em `JobItemRealizadoTable`).

## A descrição substituiu o título

O pop-up de confirmação pede **um** campo, "Descrição da errata", e ele é
obrigatório. Ele grava em `jobs_erratas.titulo`, que é a coluna que o
histórico e o fio da Comunicação já liam.

**A coluna `justificativa` foi removida** (migration
`20260827120001`), com autorização explícita do Tiago no mesmo dia: ela
deixou de ser escrita e ficou sem leitor. O conteúdo que 2 das 8 erratas
tinham ali foi junto — era o preço combinado para não manter uma coluna
morta na tabela.

O resumo do card ("2 linhas alteradas · 1 nova") passou a ser **derivado** de
`jobs_erratas_itens.acao`, e não escrito por quem registra.

## A errata devolve o job ao mural de abertura

Toda errata sobre um job **já aberto** marca `jobs.abertura_em_revisao`.

O **status do job não muda**: ele segue aberto, e a produção segue emitindo
PP e BV. O que reabre é a conferência do financeiro — previsão de
recebimento, curva de desembolso e competência foram calculadas sobre
números que a errata acabou de mudar.

Enquanto a marca existe:

- o job aparece no mural de abertura, numa faixa **Erratas**, com o botão
  **Revisar abertura** (a faixa e o botão usam a mesma cor das aberturas
  novas — a distinção é o rótulo, o ícone e o texto do botão);
- o **envio para faturamento fica fechado**, na tela e na server action.

**Quem encerra a revisão é salvar a abertura de novo.** Não há botão
separado: salvar a abertura É a reconferência que a errata pediu.

## Por que a planilha do job trocou de chave

A linha criada na errata não existe na versão aprovada — e não deve existir:
a versão é o registro do que o cliente aprovou, e a errata fica registrada
*sobre* ele.

Só que a planilha inteira do job era chaveada por
`versoes_orcamento_itens.id`. A chave passou a ser a **cópia do job**
(`jobs_itens_orcado.id`), que existe em toda linha. `jobs_itens_realizado` e
`itens_bv` ganharam `job_item_orcado_id`, com backfill 1:1; `item_versao_id`
continua preenchido em quem veio da versão e fica de rede.

É o caminho que o save já tinha tomado — `saves_consumos` carrega as duas
pontas desde a decisão 028.

## O que a errata NÃO faz

- **Não mexe na versão aprovada.** Nem valor, nem linha nova.
- **Não remove linha com PP** (mesmo cancelada), **com BV** ou **com save**.
  A PP é `on delete restrict` e daria erro cru de banco; `saves_consumos` é
  `on delete cascade` e devolveria crédito de save ao job de origem sem que
  ninguém tivesse pedido.
- **Não roda depois do envio para faturamento.** A porta é a mesma do save
  (`lib/data/envio-faturamento.ts`).

  > ⚠️ **31/08/2026 — a porta existia na regra, não na planilha do job.**
  > A trava estava escrita aqui e valia nas server actions, mas a tela do
  > realizado continuava oferecendo "Alterar orçado" e a coluna de save
  > num job já enviado: quem clicava só descobria no erro. Os botões agora
  > nascem desabilitados, com o motivo na ponta.
  >
  > O Tiago confirmou a regra na mesma data — "a negociação já terá
  > terminado no momento de envio para faturamento, e novas erratas
  > realmente não deverão poder ser feitas" —, o que também fecha a
  > pergunta que a [034](034-encerramento-exige-a-nota-emitida.md) tinha
  > deixado em aberto sobre um caminho de volta. Não há, e não deve haver.

## Limitação conhecida

A linha nascida de errata **não tem caminho para lançar BV**. As ações de BV
(`app/(app)/_bv/actions.ts`) carregam o contexto a partir do item da versão,
que a linha de errata não tem. Na prática não estorva hoje: linha nova nasce
tipo `B`, e B não aceita BV. A coluna `itens_bv.job_item_orcado_id` já
existe, então a costura é só do lado da action quando alguém precisar.

## ⚠️ Nota de 2026-09-02 — decisões 039 e 040

Duas frases desta decisão deixaram de valer:

- **"O status do job não muda: ele segue aberto, e a produção segue
  emitindo PP e BV."** O status continua não mudando, mas enquanto a
  abertura está em revisão **nenhuma PP sai para o financeiro** — gerar,
  editar e cancelar seguem; enviar e reenviar, não. BV não mudou.
  ([040](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md) §2)
- **"O tipo de custo continua editável, com a trava de PP ativa"** e
  "corrigir valor unitário de item com PP ativa continua permitido": a
  linha que já tem PP no financeiro (em avaliação, rejeitada, aprovada ou
  paga) **não entra mais em errata** — nem valor, nem QT, nem D/M, nem
  tipo, nem remover. PP só gerada não trava. ([040](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md) §1)

E a linha vermelha deixou de ser "isenta do teto do orçado": o teto
saiu para todo item ([039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md) §3).
O que existe é a confirmação acima do planejado no envio — e, como ela
nasce com planejado zero, toda PP dela passa por essa confirmação.
