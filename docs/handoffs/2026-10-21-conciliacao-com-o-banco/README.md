# Conciliação com o banco — pacote de implementação (2026-10-21)

> Hoje a Conciliação só mostra o Extrato do sistema e a aba Títulos. Não existe extrato do banco, vínculo "conciliado" nem trava de período. Este pacote leva para o sistema o que foi desenhado e aprovado no protótipo:
> - as planilhas de títulos no formato do Extrato;
> - o popup de baixa com juros e multa, fatura do cartão e avisos;
> - o cartão no novo layout;
> - a importação do extrato OFX com conciliação automática;
> - o fechamento da conciliação.
>
> A referência é o protótipo, na versão **Alternativa**. A ordem é implementar exatamente igual.

## 0. Como usar este pacote

- **Protótipo pronto:** abra `prototipo/conciliacao-banco.html` no navegador. A barra escura do topo já vem nas escolhas aprovadas, listadas na seção 2. Ela também troca de tela ("Conciliação · Títulos", "Conciliação · Extrato", "Conciliação · Conciliação automática", "Contas a Pagar", "Contas a Pagar · Cartão", "Contas a Receber", "Impostos a Pagar").
  - Na Conciliação automática, use "Usar o extrato de exemplo".
  - As versões **Atual**, **Pedida** e **Recomendada** servem só para comparar. **Atual** é o que está no ar hoje.
- **Código do protótipo:** `prototipo/src/`. É React com dados em memória e não é código do app: nada dele se copia, ele mostra o comportamento. A seção 9 diz qual função do protótipo responde por cada comportamento.
- **Rodar o protótipo e os testes dele:**
  1. Em `prototipo/`: `npm install` e `npm run build`. O build gera `conciliacao-banco.html`.
  2. Testes de tela: `PLAYWRIGHT=<caminho do playwright> node test/shot41.cjs`. Cada `test/shotNN.cjs` imprime o que viu e os erros da página.
  3. Testes do motor de correspondência: `npx esbuild test/comb.js --bundle --platform=node --outfile=/tmp/comb.cjs && node /tmp/comb.cjs`.
- **Dados do exemplo:**
  - As linhas do banco usam os valores e os históricos de um extrato real do Santander (22/05/2026), com a data trazida para 19/10/2026 e a conta e o CNPJ trocados.
  - Duas linhas não estão no arquivo, e o código marca as duas.
  - Os nomes de fornecedores e clientes são fictícios.
  - O Tiago autorizou versionar assim.

## 1. Leia antes

1. `CLAUDE.md`, `docs/FLUXO-BANCO.md`, `docs/PERFORMANCE.md` e `docs/09-identidade-visual-ui.md`.
2. Decisões:
   - **069:** regional do job;
   - **091:** a conciliação começa pela lista de contas;
   - **093:** a forma da aprovação é intenção, e o item entra na fatura na baixa;
   - **120:** cancelar ≠ estornar. Cancelar não tem limite de data "até existir o processo de conciliação que marca um período como conferido", e esse processo é a Fase 4;
   - **125:** retenções e baixa parcial;
   - **140:** baixa em lote e aba Títulos;
   - **141:** a guia de imposto é uma linha que abre em sub-linhas.
3. Este documento inteiro, e o protótipo aberto ao lado.

## 2. Escolhas travadas (a configuração aprovada do protótipo)

| Tema | Escolha |
|---|---|
| Versão | **Alternativa**: as seções e a conciliação da versão recomendada, com o popup de baixa do sistema |
| Coluna regional | **TRI + REG abreviada** (forma 4): coluna "TRI" estreita e "REG" com no máximo 3 letras |
| Detalhes ⓘ | **A**: o mesmo botão redondo e o mesmo pop-up do ⓘ do Extrato, em todas as telas |
| Sinal do banco na aba Títulos | **Faixa + ícone**: faixa verde fina na borda esquerda da linha e ícone do banco ao lado da data |
| Na importação | **Baixa sozinho o que é certo** (seção 5.6) |
| Fechamento | **Trava até reabrir** (seção 6) |
| Remessa CNAB como critério de conciliação | **Não.** Cada pagamento da remessa vai para o banco sozinho; um pode falhar e sair no dia seguinte |

## 3. Restrições globais

- **Texto da tela:** em pt-BR completo, com acento, cedilha e til. Identificadores podem ficar sem acento.
- **Banco:**
  - Toda estrutura nasce de migration, no ciclo do `docs/FLUXO-BANCO.md`: ler pelo MCP, escrever, aplicar, conferir pelo MCP e commitar junto do código.
  - Prefixo das migrations: `20261021NN000N_...`. Antes de escolher o bloco `NN`, olhe a pasta para não colidir com outra frente.
  - Toda tabela nova leva:
    - `tenant_id`;
    - RLS com `(select auth.uid())` / `is_tenant_member(tenant_id)`;
    - GRANT explícito para `authenticated` e nada para `anon`;
    - índice nas FKs filtradas;
    - nenhuma policy de DELETE, a não ser em tabela efêmera.
  - A checagem de financeiro vai também no banco (`_exige_financeiro_para_baixar` ou equivalente), não só na action.
- **Mudança destrutiva ou de comportamento compartilhado:** pare e pergunte ao Tiago antes de aplicar. Cada uma está marcada **[CONFIRMAR]** abaixo.
- **`lib/types.ts`** é escrito à mão. Toda migration que mexe em coluna usada pelo front atualiza o tipo no mesmo commit. Corrija junto a divergência que já existe em `LancamentoFinanceiro` (`lib/types.ts:3524`):
  - faltam `titulo_receber_id`, `fatura_cartao_id` e `papel_na_fatura`;
  - `regional_id` é nullable no banco.
- **Fronteira de props:** passe o tipo completo ao componente, como diz a regra do CLAUDE.md. Campo novo calculado no servidor não pode morrer num `.map` com tipo estreito.
- **Performance:**
  - queries independentes em `Promise.all`;
  - `prefetch={false}` em listas;
  - agregação separada para contar e somar;
  - mantenha `force-dynamic` na rota da conciliação;
  - rode `get_advisors` depois de cada RPC nova.
- **Auditoria** (`logAuditEvent`, acrescentando as ações novas em `AuditAction`) para:
  - importar extrato;
  - conciliar e desfazer, inclusive o que se resolve sozinho;
  - ignorar linha;
  - corrigir baixa;
  - criar regra;
  - fechar e reabrir o período.
- **Dados pessoais:** nenhum dado pessoal em arquivo versionado. Ligue o hook uma vez por clone: `git config core.hooksPath .githooks`.
- **Fases e commits:**
  - Commits pequenos, no padrão `feat(conciliacao): … (decisão NNN)`.
  - Cada fase termina com `npm run typecheck`, `npm run lint`, `npm run build` e os testes `node --import tsx --test`, mais a conferência no navegador contra o protótipo.
  - Só então vem o push para `main`.
- **Decisões:**
  - Registre as regras da seção 4 como decisões numeradas em `docs/decisions/`. Hoje o próximo número livre é 195; reserve antes, porque outras frentes também numeram.
  - Atualize `docs/decisions/README.md` no mesmo commit.
  - Ao final, escreva o handoff retrospectivo em `docs/handoffs/` e acrescente a linha no índice `docs/HANDOFF.md`.

## 4. Decisões travadas

### 4.1 Planilhas de títulos e Extrato (mesmas colunas)

1. **Telas e ordem das colunas.**
   - **Telas:** Conciliação › Títulos, Contas a Pagar, Contas a Receber e Impostos a Pagar.
   - **Ordem:** caixa de seleção · Data · Crédito · Débito · (Saldo previsto, só na Conciliação › Títulos) · Descrição · Fornecedor/Cliente · Job · Centro de Custo · TRI · Empresa · REG · Ação.
   - A grade tem `table-fixed` e `colgroup` (protótipo: `PlanilhaDeTitulos`, `titulos.jsx`).
2. **Coluna do valor.**
   - **Na conciliação:** o valor vai na coluna do sentido do dinheiro no banco (regra "banco"; protótipo: `celulaDoModulo` em `logica.js`).
   - **Transferência:** aparece nas duas colunas, em cinza, fora dos totais. A dica fica no próprio valor.
   - **Nos módulos:**
     - Contas a Pagar e Contas a Receber têm Crédito e Débito com a largura normal. O estorno de verba entra como crédito em Contas a Pagar.
     - Impostos a Pagar tem a coluna Crédito fina, só com "—".
3. **Centro de Custo:** mostra só o tipo ("02 · Custo Operacional"). Passar o mouse ou clicar mostra o centro inteiro. Se não couber, termina em reticências.
4. **REG (regional), coluna à direita de Empresa:**
   - **Com job:** vale a regional do job, 100% (decisão 069).
   - **Sem job:** vale o rateio do lançamento.
   - **Rateio entre regionais:** aparece "TD", e passar o mouse ou clicar mostra a regra ("Rateio: NE 60% · SP 40%").
   - **Abreviações** do cadastro: NE, SP, NO, RJ e SS continuam iguais; Doca vira DOC, Agency vira AGE, Hitlab vira HIT, e Teste, Teste 2 e Teste 3 viram TES, TE2 e TE3 (protótipo: `SIGLA` e `colunasDaRegional` em `logica.js`).
5. **Dicas** de Regional, Centro e valores: aparecem ao passar o mouse e ficam abertas no clique. Clicar fora, Esc ou rolar fecha.
6. **Seleção de linhas:** só pela caixa da primeira coluna. Clicar no resto da linha não seleciona.
7. **Célula Ação:**
   - "Baixar" encostado à esquerda, a 6 px da borda, e o ⓘ a 8 px dele.
   - O antigo ⋯ virou ⓘ (variante A, seção 4.1.10).
   - "Editar data de pagamento" e "Editar previsão de recebimento" saíram do menu: a data se edita pelo lápis da coluna Data.
8. **Valor com retenção ou baixa parcial:** fica uma linha só, com um ícone pequeno à esquerda do valor.
   - **Retenção:** o ícone mostra o bruto, cada retenção e o "Sai da conta".
   - **Baixa parcial:** o ícone é azul e mostra o bruto, o que já foi baixado e o que falta.
9. **Etiquetas:**
   - "BV";
   - "No cartão" (título pago no cartão);
   - "A devolver" e "Devolvido" (estorno de verba);
   - na fatura do cartão, "N itens" abre os itens embaixo; o centro mostra "Itens da fatura", e passar o mouse lista os centros.
10. **ⓘ variante A (pop-up "Detalhes do título" ou "Detalhes do lançamento"):**
    - **Mostra só o que a linha não tem:**
      - Origem (a trilha: pedida, aprovada, emitida; o job; a parcela; o vencimento quando difere da data prevista);
      - Pagamento (chave PIX, linha do boleto, guia, cartão e fatura);
      - Retido na fonte;
      - De onde vem este dinheiro (quando há save ou mais de uma origem);
      - Regional;
      - Documentos;
      - Histórico da baixa (seção 4.5);
      - as ações da tela de origem.
    - **Visualizar documentos:** à esquerda sempre o documento interno (PP, pedido de desembolso, NF emitida); à direita sempre o de pagamento (NF do fornecedor, orçamento, boleto, guia, fatura). Com mais de um documento de um lado, ele troca pelos números.
    - **Imposto:** a ação é "Abrir na Apuração". O valor do imposto não se corrige na tela de pagamento; a correção é na guia aprovada da Apuração.
11. **Menu "Novo lançamento":** as seções se chamam "A pagar", "A receber" e "Entre contas".
12. **Extrato da conta** (mesmas colunas e o mesmo ⓘ A):
    - coluna "Banco" com ✓ quando conciliado;
    - ⚠ quando não bate com o banco;
    - cadeado nas linhas de período fechado;
    - faixa de aviso "N lançamentos não batem… Corrigir na Conciliação automática";
    - contador "N conciliadas com o banco · N aguardando o extrato do banco";
    - folha agrupada ("17 títulos");
    - guia de imposto em uma linha (decisão 141);
    - pagamento de fatura com "N itens".

### 4.2 Popup de baixa

1. **É o popup do sistema** (`BaixaTituloDialog`, `BaixaRecebimentoDialog`, `BaixaImpostoDialog`, `BaixaEmLoteDialog`), com só estes acréscimos. Protótipo: `BaixaDialog` em `dialogos.jsx`, com `popupDoSistema = true` na Alternativa.
2. **Três datas, sempre com estes nomes:** **Vencimento** (do documento, nunca muda), **Data prevista** (editável) e **Data do pagamento** (escolhida na baixa). O resumo do topo mostra Título, Origem, Vencimento e Data prevista.
3. **Forma de pagamento:**
   - Abre **sempre em PIX**. Nem a forma do título nem a da aprovação pré-preenchem (protótipo: `formaInicial`).
   - **Exceção:** a baixa aberta por uma linha do banco usa a forma que o histórico diz: "PAGFOR PIX" vira PIX, "PAGAMENTO DE TITULO" vira Boleto, "TED" vira Transferência, e concessionária vira Boleto.
4. **Caixas de marcar no lugar das chaves** (protótipo: `LinhaChave`):
   - "Baixa parcial", e embaixo o valor a dar baixa;
   - "Reter impostos na fonte", ou, no recebimento, "O cliente reteve impostos na fonte".
5. **Retenção:**
   - Tabela por imposto (ISS, PIS, COFINS, CSLL, IRRF), cada um por alíquota ou valor, com o líquido.
   - "Repetir as alíquotas da …" usa a última retenção do fornecedor.
   - Um bloco "No fiscal" mostra as guias que a retenção gera.
   - Na PP com retenção informada na aprovação, a baixa já abre com ela: "Retenções informadas na aprovação da PP (dd/mm/aaaa) · editáveis".
   - A baixa que não é parcial quita o título mesmo com retenção.
   - Isso já existe (`valor-da-baixa.tsx`, `no-fiscal.tsx`). Só a chave vira caixa.
6. **Juros e multa no título a pagar:**
   - **Onde aparece:** só em **boleto**, ou quando a baixa vem da conciliação e o banco pagou mais que o título. No PIX e na TED o valor é o que a agência mandou, e fatura de cartão e conta de consumo cobram o atraso na fatura ou na conta seguinte.
   - **Como aparece:** um link "+ Juros e multa" embaixo das duas caixas, com um pouco de espaço acima. Clicar abre "Valor dos juros e da multa", com "Remover" ao lado. Vindo da conciliação com diferença, o campo já abre preenchido.
   - **Dica do atraso:** ao lado do link, discreta e em cinza: "Pago X dias depois do vencimento". Os dias são contados **a partir do primeiro dia útil**: vencimento no sábado conta a partir de segunda (+2), no domingo também (+1). Feriados ficam de fora (protótipo: `atrasoDoPagamento`).
   - **Imposto:** continua com "Multa e juros" sempre à vista, como hoje.
   - **No DRE:** os juros entram em **11 · Despesa com Juros**, como a multa e os juros do imposto.
7. **Cartão de Crédito como forma:**
   - **Vale para:** PP, avulso, recorrência e desembolso sem baixa parcial antes.
   - **Não vale para:** folha, fatura, imposto e devolução de verba.
   - **No lote:** o cartão também vale, e todos entram na mesma fatura.
   - **Campo Fatura:** escolhe a fatura. Vem a da data do pagamento, e dá para trocar por outra aberta. Fatura fechada não recebe item: reabra na aba Cartão (protótipo: `opcoesDeFatura`, `faturaDestino`).
   - **Valor:** no cartão, a baixa é sempre do valor inteiro, sem retenção.
8. **Avisos:**
   - "Aberto pela conciliação com o banco: a data, a conta e o valor vêm do extrato do Santander (…)";
   - "A data é diferente da do banco";
   - período fechado (seção 6);
   - "O banco pagou R$ X e o título é de R$ Y: a baixa abre parcial…";
   - "A baixa soma R$ X e a linha do banco é de R$ Y. Ela só concilia quando os dois baterem". Esse aviso bloqueia a confirmação.
   - **Rodapé:** sem linha do banco, "Ao confirmar, o pagamento é registrado e enviado para a Conciliação…"; aberta pelo banco, "Ao confirmar, a baixa entra no Extrato já conciliada com a linha do banco, com a data dela".

### 4.3 Cartão de crédito

1. **A forma escolhida na aprovação é só intenção** (decisão 093). Ela não cria previsão nem item na fatura e não pré-preenche a baixa. A baixa no cartão é que põe o item na fatura escolhida.
2. **Capa da aba Cartão:** igual à do sistema (`cartao-capa.tsx`).
3. **Fatura** (protótipo: `FaturaDoCartao` e `ExtratoNovo` em `cartao.jsx`):
   - cabeçalho e KPIs como no sistema;
   - o extrato da fatura vem no novo layout de colunas, sem a coluna Situação;
   - a linha do pagamento fica na própria fatura;
   - "Fechar fatura" como no sistema.
4. **Pagamento da fatura:**
   - O título da fatura vai para Contas a Pagar.
   - A baixa dele é PIX, Transferência ou Boleto, sempre do valor inteiro.
   - No Extrato, ele abre nos itens, com os centros de cada um.
   - Em Contas a Pagar, o centro mostra "Itens da fatura".

### 4.4 Importação do extrato (OFX)

1. **Arquivos aceitos:** OFX SGML 1.0x e XML 2.x. O Santander manda o valor com vírgula ("-1920,00"), e os dois formatos valem (protótipo: `lerOfx` em `ofx.js`).
2. **Conta:** vem do arquivo (BANKID + ACCTID) e não se troca. Só entra o extrato da conta aberta no topo. Arquivo de outra conta é recusado com explicação (protótipo: `contaDoArquivo`, `ArquivoRecusado`).
3. **Repetidos:** o FITID do Santander muda a cada download, porque carrega a hora da exportação. Por isso a linha se reconhece por uma **impressão digital**: conta, data, valor em centavos, histórico normalizado e posição entre os iguais (protótipo: `digitais`). Reimportar o mesmo dia não duplica nada.
4. **Cabeçalho do arquivo:** nome, banco, conta, período, "N movimentos · N novos" e o saldo informado pelo banco (LEDGERBAL).
5. **Quadros:**
   - Saldo no banco (data);
   - Saldo do sistema (fim do último dia do extrato);
   - Diferença ("Bate ✓" ou o valor);
   - Conciliados (N de M, com barra).
6. **Dia em andamento:** quando o arquivo foi gerado (DTSERVER) no mesmo dia do último movimento (DTEND), esse dia ainda não acabou. Aparece a nota: "dd/mm ainda está em andamento… o dia só entra no fechamento com um extrato gerado depois dele". A baixa feita à mão hoje que ainda não está no banco não conta como divergência.

### 4.5 Motor de correspondência

Ele roda nas linhas do banco ainda sem solução, nesta ordem, da mais certa para a menos certa. É uma função pura, testada com `node --test`. Protótipo: `casar` em `ofx.js`, cuja ordem e cujos limites valem como especificação.

| Passo | O quê | Regra | Confiança |
|---|---|---|---|
| 1 | **Baixa feita à mão que bate** | Lançamento da conta, ainda não conciliado, com o mesmo valor e sinal, até 3 dias | alta |
| 1b | **Baixa feita à mão que diverge** | Mesmo sinal, até 3 dias, diferença de até R$ 1 ou 1% | média |
| 2 | **Saiu e voltou** | "DEVOLUCAO" e uma saída do mesmo valor no mesmo dia. O título continua a pagar | alta |
| 3 | **Título pelo valor exato** | Pontos: base 60; data igual +20, até 3 dias +15, até 7 dias +5, mais de 20 dias −25; forma igual +10 (boleto aceita guia); CNPJ do histórico igual ao do título +30 | **alta** com ≥ 90 pontos e sem empate (empate é outro título com até 5 pontos a menos) |
| 3a | **Linhas iguais em número igual** | Mesmo dia e valor, com N linhas e N títulos empatados: cada linha paga um, e trocar não muda o Extrato | alta |
| 3b | **Retenção na fonte** | O banco tem menos que o título, e a diferença bate com uma alíquota comum (6,15%, 4,65%, 1,5%, ISS 5%, ISS 2%, 11,15%). Só vale para título sem retenção da aprovação, até 10 dias | média (abre com a retenção destrinchada) |
| 4 | **Remessa da folha** | Uma linha igual à soma centavo a centavo de um lote | alta |
| 4b | **Vários títulos da mesma contraparte** | De 2 a 4 títulos de um mesmo fornecedor ou cliente (no recebimento, o do CNPJ do histórico), vencendo até 10 dias da data, com soma exata | **alta** com uma combinação só; **média** com mais de uma |
| 5 | **Juros e multa** | Só em linha de boleto. Título boleto até 3% a mais e até 10 dias; guia até 25% a mais e até 60 dias depois do vencimento legal | média |
| 6 | **Regra de histórico** | "TAR …" vira tarifa bancária e "IOF …" vira juros. As regras são cadastráveis ("Lembrar como regra") | alta |
| — | Sem correspondência | — | — |

**O que conta como certo:** "alta" com centro de custo definido. O que precisa de decisão fica para alguém.

### 4.6 Seções da Conciliação automática e ações

As seções seguem esta ordem, cada uma com contador e recolhível. Protótipo: `AbaBancoRecomendada`, `TabelaDoBanco` e `AcoesDaLinha` em `banco.jsx`.

**Colunas das tabelas do banco:** Data · Histórico do banco · Crédito · Débito · Situação · No sistema (com uma segunda linha cinza para o motivo) · Ação. A Ação tem três vagas fixas: a ação principal (136 px), a lupa e o ignorar.

1. **A baixa feita à mão não bate com o banco** (vermelho).
   - "Corrigir a baixa" abre a confirmação (protótipo: `CorrigirBaixaDialog`):
     - uma tabela "Baixa registrada | Fica (como no banco)" com Data do pagamento, Valor do título, Juros e multa e Total. O que muda fica em destaque; o resto diz "sem mudança";
     - para onde vai a diferença ("Saem R$ 0,36 de 11 · Despesa com Juros");
     - **Motivo da correção**, obrigatório, com pelo menos 10 caracteres, e sugestões de um clique;
     - o botão "Corrigir e conciliar".
   - **Regra da diferença:** ela vira juros só em boleto ou guia; no resto, muda o valor pago (protótipo: `correcaoDaBaixa` em `logica.js`).
   - **Histórico:** a correção (de → para, motivo, quem, quando) fica no ⓘ do lançamento, em "Histórico da baixa", e na auditoria. O desfazer também fica registrado.
   - A lupa serve para "Era outro pagamento: procurar o título".
2. **Baixas feitas à mão que bateram com o banco** (azul, **aberta**).
   - Elas se conciliam **sozinhas nos dois modos de importação** e ficam aqui, à vista.
   - Situação: "Conciliado sozinho"; No sistema: "Baixa feita à mão: “…”"; Ação: "✓ Conciliado" com o ícone de desfazer.
3. **Prontos: baixar e conciliar.**
   - Títulos com confiança alta e centro, e a soma única do passo 4b.
   - "Baixar e conciliar" em cada linha, e "Baixar e conciliar os N" no cabeçalho.
   - A baixa usa os dados do banco: data, conta, valor e forma pelo histórico.
4. **Conferir antes** (âmbar).
   - **Grupos de linhas iguais com mais títulos que linhas** (protótipo: `gruposDeIguais`, `GrupoNaTabela`):
     - Uma faixa: "3 linhas de R$ 3.000,00 no banco, no mesmo dia · 4 títulos de R$ 3.000,00 a pagar · Fica em aberto: PP-00157 · …", com o botão "Baixar e conciliar as 3".
     - Cada linha do banco tem as mesmas colunas das outras: Situação "Linha 1 de 3" e, em No sistema, o título escolhido para ela.
     - "Trocar…" troca o título. Se o escolhido estava em outra linha, os dois trocam de lugar.
     - Cada linha também tem "Baixar e conciliar" e a lupa.
     - Vale nos dois lados, pagar e receber.
   - **Diferença (juros ou retenção) e sugestão de média confiança:** "Conferir" abre a baixa já com a diferença destrinchada.
   - O cabeçalho tem "Aceitar as N sugestões como estão".
5. **Uma linha do banco, vários títulos:** a remessa da folha, que se concilia sozinha, e as somas do passo 4b com mais de uma combinação ("Conferir os N", que abre a baixa em lote).
6. **Saiu e voltou:** "Registrar as duas". As duas linhas entram no extrato e o título continua a pagar.
7. **Pelas regras do histórico:** "Lançar" e "Lançar as N".
8. **Sem correspondência:**
   - "Lançar avulso" abre o novo pagamento ou recebimento já preenchido com a linha, e tem "Lembrar como regra";
   - a lupa;
   - "Ignorar esta linha", com o ícone vermelho.
9. **Conciliados:** recolhida. Ação "✓ Conciliado" ou "Ignorado", com o ícone de desfazer. A linha **não tem fundo verde**.
10. **Baixa no sistema, sem linha no banco** (vermelho, embaixo das seções):
    - São as baixas feitas à mão, de dias completos já importados, que o banco não mostra.
    - Ações: "Cancelar a baixa" (o cancelar de hoje) e "Corrigir o lançamento".
    - Enquanto houver alguma, a conciliação não fecha.

**Lupa "Escolher o título desta linha"** (protótipo: `ProcurarTitulo`):
- **Lista:**
  - títulos em aberto no sentido da linha, **pela proximidade do valor**, com busca por título, fornecedor ou PP;
  - a diferença ao lado, em destaque ("+ R$ 200,00", "− R$ 154,60", "= linha");
  - embaixo, o que a diferença vira:
    - **título maior:** "retenção na fonte: …" quando a diferença bate com as alíquotas comuns e o título não tem retenção da aprovação; senão "baixa parcial · ficam R$ X a pagar";
    - **título menor:** "juros e multa" só em linha de boleto (título boleto até 3%, guia até 25%); senão "sozinho não fecha: some com outro".
- **Mais de um título:** dá para marcar vários. O botão só liga quando a soma bate.
- **O valor da baixa vem sempre do banco:**
  - título maior abre parcial com o valor do banco, a não ser que a retenção explique a diferença;
  - a baixa só concilia quando o total bate com a linha.
- **Retenção da aprovação:** já está descontada. O título fica pelo líquido; na PP-00144, nota de R$ 3.945,13 e título de R$ 3.702,50.

**Desfazer:**
- Cancela o vínculo e, se a baixa nasceu na conciliação, cancela também a baixa.
- O título volta a aberto.
- O grupo de linhas iguais se desfaz inteiro.
- Linha que alguém desfez não se resolve mais sozinha.

### 4.7 Automação na importação

Modo aprovado: **"Baixa sozinho o que é certo"**. Protótipo: o `React.useEffect` "Na importação, o que é certo…" em `main.jsx`.

- **Sempre, nos dois modos:** a baixa feita à mão que bate se liga sozinha à linha (passo 1), com a data do banco.
- **Também se resolvem sozinhos:**
  - título com confiança alta e centro definido (passos 3 e 3a), que leva baixa com os dados do banco e é conciliado;
  - remessa da folha (passo 4);
  - regra de histórico (passo 6).
- **A soma do passo 4b não se resolve sozinha:** ela vai para Prontos, um clique.
- **Cada linha é avaliada uma vez.** O que alguém desfez não volta a se resolver sozinho.
- **Faixa verde do resultado:** "N linhas do banco se resolveram sozinhas: 1 baixa feita à mão…; N títulos baixados e conciliados (…); a remessa da folha…; N tarifas pela regra do histórico." Tudo com Desfazer.

### 4.8 Aba Títulos com o extrato importado

Título que o motor encontrou numa linha do banco ainda não conciliada ganha o sinal **faixa + ícone**: uma faixa verde fina na borda esquerda e o ícone do banco ao lado da data. Passar o mouse ou clicar mostra "No extrato do banco de dd/mm" e o motivo. A ação da linha leva à conciliação daquela linha.

## 5. Banco de dados: proposta

**Confirme pelo MCP antes de escrever.** Nomes de colunas, enums e assinaturas abaixo vêm de leitura do código em 21/10. Confira tudo no banco. Os pontos de partida estão na seção 7.

### Fase 2: juros na baixa e fatura escolhida no cartão

- **M2.1 [CONFIRMAR]:** juros e multa na baixa de PP e de avulsa.
  - Proposta: um parâmetro `p_juros numeric default 0` em `baixar_parcela_pp` e `baixar_conta_avulsa`. Quando for maior que 0, grava **um lançamento a mais**, de saída, em 11 · Despesa com Juros (o mesmo plano dos juros do imposto em `baixar_imposto`), com a mesma conta, data, forma, origem e FKs do documento.
  - O documento é quitado pelo principal.
  - Mudar a assinatura troca a função (drop e create), por isso pede confirmação. Prefira acrescentar o parâmetro no fim, com default.
- **M2.2 [CONFIRMAR]:** escolher a fatura na baixa no cartão.
  - Proposta: `cartao_lancar_item` recebe `p_fatura_id uuid default null`. Com ele, usa essa fatura se for do cartão e estiver `aberta`; recusa se estiver `fechada`. Sem ele, mantém o comportamento de hoje (a fatura da data).
  - As baixas que chamam `cartao_lancar_item` passam o parâmetro adiante.
- **M2.3:** baixa em lote com cartão.
  - `darBaixaEmLote` já chama as actions uma a uma. A mudança é no código: tirar o cartão da lista de exclusões do lote (decisão 140, revista) e mandar a mesma fatura para todos.
- **M2.4:** checagem de financeiro no banco em `dar_baixa_fatura_cartao`, `dar_baixa_desembolso_parcela`, `dar_baixa_devolucao_verba` e `fechar_fatura_cartao`. Hoje elas só checam `is_tenant_member`. **[CONFIRMAR]**: muda o comportamento para quem chama essas RPCs sem ser financeiro.

### Fase 3: extrato importado e conciliação

- **M3.1 `extrato_importacoes`** (um registro por arquivo).
  - Colunas: `id`, `tenant_id`, `conta_bancaria_id`, `arquivo_nome`, `banco_id`, `conta_no_arquivo`, `periodo_inicio`, `periodo_fim`, `gerado_em` (timestamptz do DTSERVER), `saldo_banco`, `saldo_em`, `qtd_movimentos`, `qtd_novos`, `importado_por`, `created_at`.
  - Índice em `(tenant_id, conta_bancaria_id, periodo_fim)`.
- **M3.2 `extrato_linhas`** (uma por movimento, sem repetir).
  - Colunas: `id`, `tenant_id`, `conta_bancaria_id`, `importacao_id` (a primeira que trouxe a linha), `digital` (text), `data`, `valor` (numeric com sinal), `tipo` (DEBIT/CREDIT), `historico`, `documento` (CHECKNUM), `fitid`, `ordem`.
  - Colunas da solução: `ignorada_em`, `ignorada_por`, `motivo_ignorada`, `resolvida_sozinha` (text: manual, título, remessa, regra), `avaliada_em` (a avaliação única da importação), `sem_auto` (boolean: alguém desfez), `created_at`.
  - `unique (tenant_id, conta_bancaria_id, digital)` e índice em `(tenant_id, conta_bancaria_id, data)`.
- **M3.3 [CONFIRMAR, é aditiva mas em tabela compartilhada]:** `lancamentos_financeiros.extrato_linha_id uuid null references extrato_linhas(id) on delete restrict`, com índice.
  - O vínculo é N:1: várias baixas numa linha (lote, soma de títulos, guia de imposto com rateio).
  - "Conciliado" passa a ser `extrato_linha_id is not null`. Não precisa de coluna de status.
  - **Saiu e voltou:** cada lançamento na sua linha.
  - **Pagamento de fatura:** só o lançamento do banco se liga; o da conta-espelho, não.
  - Antes de criar a FK, procure embeds de `lancamentos_financeiros` (`grep -rn "lancamentos_financeiros("`) por causa da armadilha de FK dupla do FLUXO-BANCO. Como é a primeira FK entre essas duas tabelas, não deve haver problema.
  - Alternativa, se o Tiago preferir não tocar em `lancamentos_financeiros`: uma tabela de vínculo `extrato_vinculos (linha_id, lancamento_id)`.
- **M3.4 `extrato_regras`.**
  - Colunas: `id`, `tenant_id`, `conta_bancaria_id` (null = todas), `padrao` (o começo do histórico normalizado), `plano_conta_tipo_id`, `plano_conta_subtipo_id`, `empresa_id`, `criada_por`, `created_at`, `ativa`.
  - Semente: "TAR " vira tarifa bancária e "IOF " vira juros. Confira os ids do plano pelo MCP.
- **M3.5:** o que a regra lança e o que "Lançar avulso" cria.
  - **Tarifa pela regra:** lançamento `origem='manual'`. O valor já existe no enum e nenhuma tela o usa. Ele leva o plano e a empresa da regra e o `extrato_linha_id`.
  - **"Lançar avulso":** cria a conta avulsa e dá baixa pelos fluxos que já existem, e depois liga.
- **M3.6 [CONFIRMAR]:** o lançamento do "Saiu e voltou".
  - O protótipo registra a saída e a volta como dois lançamentos fora do DRE.
  - Hoje o plano de contas só pode ser nulo na transferência. Afrouxar a CHECK é destrutivo.
  - Alternativas: um subtipo próprio, "Devolução de PIX" num grupo que o DRE ignora; ou não criar lançamento e só resolver as duas linhas, que se anulam.
  - Pergunte ao Tiago.
- **M3.7 RPCs:**
  - `conciliar_linha(p_linha_id, p_lancamento_ids uuid[])` confere tenant, conta, financeiro e que a soma dos lançamentos bate com a linha, e grava `extrato_linha_id`.
  - `desfazer_conciliacao(p_linha_id, p_cancelar_baixas boolean)`.
  - `ignorar_linha(p_linha_id, p_motivo)`.
  - `corrigir_baixa_pela_conciliacao(p_lancamento_id, p_linha_id, p_motivo)` ajusta valor e data, e os juros (seção 4.6, item 1), grava a auditoria com de, para e motivo, e liga.
  - "Baixar e conciliar" é a action da baixa de hoje seguida de `conciliar_linha`. Se a ligação falhar, a baixa fica válida e aparece no passo 1 da próxima leitura; não precisa compensar.
- **M3.8 Cancelar a baixa de lançamento conciliado:** hoje o cancelamento apaga o lançamento de verdade. Com `on delete restrict`, isso falha.
  - Ajuste `_apagar_lancamento_de_baixa`, ou as `cancelar_baixa_*`, para desligar antes, ou recusar com mensagem.
  - **[CONFIRMAR]** qual dos dois.

### Fase 4: fechamento

- **M4.1 `conciliacao_fechamentos`.**
  - Colunas: `id`, `tenant_id`, `conta_bancaria_id`, `ate` (date), `fechado_em`, `fechado_por`, `reaberto_em`, `reaberto_por`, `motivo_reabertura`, `ativo` (boolean).
  - Índice único parcial: um ativo por conta. O histórico são as linhas.
- **M4.2 [CONFIRMAR, muda o comportamento de todos os módulos]:** trigger `BEFORE INSERT OR UPDATE OR DELETE` em `lancamentos_financeiros`.
  - Recusa quando a data, antiga ou nova, cai até o `ate` do fechamento ativo da conta.
  - Isso cobre baixa, cancelamento, estorno com data, correção e desfazer, de qualquer RPC. A mensagem é a da seção 6.
  - Faça o mesmo em `extrato_linhas` para ignorar e desfazer.
- **M4.3 RPCs:**
  - `fechar_conciliacao(p_conta_id, p_ate)` confere as condições da seção 6 no banco.
  - `reabrir_conciliacao(p_conta_id, p_motivo)` exige motivo com pelo menos 10 caracteres.

## 6. Fechamento da conciliação (regras)

Protótipo: `fecharPeriodo`, `reabrirPeriodo`, `bloqueado` e `diaCompleto` em `main.jsx`; `BannerDoFechamento` e `ReabrirDialog` em `banco.jsx`.

1. **Até onde dá para fechar:** só até o **último dia completo** dos extratos importados. Para cada importação, o dia completo é o fim do período, se o arquivo foi gerado depois dele, ou a véspera, se foi gerado no mesmo dia. Vale o maior entre as importações.
2. **"Fechar a conciliação até dd/mm" só liga quando:**
   - nenhuma linha do banco até essa data está pendente;
   - nenhuma baixa até lá está sem linha no banco;
   - a diferença de saldo nesse dia é zero. O saldo do banco no dia é o LEDGERBAL menos as linhas depois do dia; o saldo do sistema é o saldo inicial mais os lançamentos até o dia.
3. **Trava até reabrir:**
   - **O que fica bloqueado:** baixa, cancelamento, estorno, correção e desfazer **com data até o fechamento**. Mensagem: "Período fechado até dd/mm: reabra a conciliação para mudar esse lançamento."
   - **No popup de baixa:** com uma data dessas, aparece um aviso vermelho e ele recusa.
   - **No Extrato:** cadeado nas linhas.
   - **O que o fechamento protege:** o **caixa** da conta, isto é, o Extrato e o DFC. O DRE, que é por competência, não fica travado, e isso fica para outro fechamento (pendência).
4. **Reabrir o período:** pede um motivo com pelo menos 10 caracteres. A faixa mostra o histórico ("fechada até 19/10 em … · reaberta em … por …: “motivo”").
5. **Faixa do fechamento** no topo da Conciliação e do Extrato:
   - **Fechado:** "Conciliação da California Santander fechada até dd/mm · por … em …", explicando que o caixa (Extrato e DFC) está travado.
   - **Reaberto:** "Período reaberto…" com o motivo.

## 7. O que já existe (reusar) e o que falta

Levantamento feito no código em 21/10/2026. Confira pelo MCP.

- **Conciliação** (`app/(app)/financeiro/conciliacao/`):
  - **Hub:** `conciliacao_resumo_contas`.
  - **Abas:** Extrato (somente leitura: `conciliacao-list.tsx`, `lib/data/lancamento-linha.ts`, `lib/calculos/saldo-conta.ts`, agrupamentos `lib/data/imposto-extrato` e `lib/data/fatura-cartao-extrato`) e Títulos (`aba-titulos.tsx`, `titulos-dados.ts`, `alvos-da-baixa.ts`).
  - Já usa os diálogos reais de baixa com a conta aberta (`contaInicial`).
  - Hub e Títulos já usam `table-fixed` e `colgroup`. O Extrato ainda tem layout automático (`conciliacao-list.tsx:217`) e precisa passar ao `colgroup` da planilha.
- **Baixa:**
  - Diálogos: `components/financeiro/baixa-titulo-dialog.tsx`, `app/(app)/financeiro/contas-a-receber/baixa-recebimento-dialog.tsx`, `valor-da-baixa.tsx`, `forma-pagamento-field.tsx`, `no-fiscal.tsx`, `baixa-em-lote.tsx`.
  - Actions: `darBaixaTitulo` (`contas-a-pagar/actions-titulos.ts:713`), `contas-a-receber/actions.ts:451` e `darBaixaEmLote` (`actions-baixa-em-lote.ts:214`).
  - RPCs: `baixar_parcela_pp`, `baixar_conta_avulsa`, `dar_baixa_desembolso_parcela`, `baixar_titulo_receber`, `dar_baixa_fatura_cartao`, `dar_baixa_devolucao_verba` e `baixar_imposto` (este com `p_multa_juros`).
  - A baixa grava em `lancamentos_financeiros` pelo líquido; os retidos ficam em `baixas_retencoes`.
- **Cancelar e estornar:** `actions-baixa-registrada.ts`, com as RPCs `cancelar_baixa_*` (apagam o lançamento) e `estornar_valor_da_baixa`.
- **Cartão:**
  - Tabelas `cartoes_credito` e `faturas_cartao`. Não há tabela de itens: o item é um lançamento na conta-espelho com `fatura_cartao_id` e `papel_na_fatura`.
  - RPCs `cartao_lancar_item`, `fatura_aberta_do_cartao`, `fechar_fatura_cartao` e `reabrir_fatura_cartao`.
  - Telas `contas-a-pagar/cartao-*.tsx`.
- **Auditoria:** `logAuditEvent` (`lib/auth/audit.ts:483`) e a tabela `audit_events`.
- **Permissão:** `requireSession`, o gate financeiro de cada action e `_exige_financeiro_para_baixar` no banco.
- **Não existe:**
  - linhas de extrato importadas, parser OFX e motor de correspondência;
  - vínculo "conciliado";
  - trava de período;
  - juros na baixa comum (hoje só no imposto);
  - escolha de fatura na baixa no cartão;
  - lote com cartão.

## 8. Fases

Cada fase fecha com typecheck, lint, build e testes, a conferência no navegador contra o protótipo, o commit da migration junto do código e o push para `main`. **Não comece uma fase com a anterior vermelha.**

### Fase 1: planilhas de títulos e Extrato (só tela)

- **Objetivo:** seção 4.1 inteira, nas quatro telas e no Extrato.
- **Passos:**
  - [ ] Extrair um componente de planilha compartilhado: colgroup, cabeçalho, linha, rodapé de totais e regra da coluna do valor por módulo.
  - [ ] Coluna REG com abreviações e "TD" com rateio; coluna TRI estreita; Centro só com o tipo; dicas no hover e no clique.
  - [ ] Seleção só pela caixa; célula Ação com "Baixar" + ⓘ A, e as ações do antigo ⋯ dentro do ⓘ.
  - [ ] ⓘ A com Origem, Pagamento, Retido, De onde vem, Regional e Documentos, e o visualizador lado a lado (interno à esquerda, pagamento à direita).
  - [ ] Ícones de retenção e de baixa parcial no valor; etiquetas BV, No cartão, A devolver e Devolvido; "N itens" da fatura.
  - [ ] Extrato no mesmo colgroup (`table-fixed`), com o ⓘ A. As marcas do banco entram na Fase 3.
  - [ ] Imposto: "Abrir na Apuração" no lugar de "Corrigir o valor".
  - [ ] Menu "Novo lançamento": "A pagar", "A receber" e "Entre contas".
  - [ ] Corrigir `LancamentoFinanceiro` em `lib/types.ts`.
- **Testes:**
  - unitário da regra da coluna do valor (o equivalente a `celulaDoModulo`);
  - unitário das abreviações e do "TD";
  - no navegador, as quatro telas lado a lado com o protótipo (Alternativa).

### Fase 2: popup de baixa e cartão

- **Objetivo:** seções 4.2 e 4.3, e as migrations M2.1 a M2.4.
- **Passos:**
  - [ ] Forma padrão PIX (e a do banco quando vier da conciliação, já preparada para a Fase 3).
  - [ ] Caixas no lugar das chaves.
  - [ ] "+ Juros e multa" só em boleto: link, campo, Remover e dica do atraso em dias úteis. Grava pela M2.1.
  - [ ] Cartão: campo Fatura (M2.2), lote no cartão (M2.3), nota da fatura fechada.
  - [ ] Avisos de data diferente da do banco e de "não bate" (a infraestrutura; a origem é a Fase 3).
  - [ ] Aba Cartão: extrato da fatura no novo layout, sem Situação, com a linha do pagamento.
  - [ ] Pagamento da fatura: "Itens da fatura" no centro e abertura por itens no Extrato.
- **Testes:**
  - unitário do atraso em dias úteis (vencimento no sábado, pago na segunda, dá 0; pago na terça, dá 1);
  - RPC com juros: o lançamento extra em 11 e o documento quitado;
  - lote no cartão: todos na mesma fatura;
  - no navegador: boleto vencido, PIX sem juros, cartão com troca de fatura, lote no cartão.

### Fase 3: importação e conciliação automática

- **Objetivo:** seções 4.4 a 4.8 e as migrations M3.1 a M3.8.
- **Arquivos sugeridos:**
  - `lib/conciliacao/ofx.ts` (parser e impressão digital);
  - `lib/conciliacao/motor.ts` (função pura `casar`, portada de `prototipo/src/ofx.js`);
  - `lib/conciliacao/motor.test.ts` e `ofx.test.ts`;
  - `app/(app)/financeiro/conciliacao/aba-banco.tsx` (as seções);
  - `actions-conciliacao.ts`.
- **Passos:**
  - [ ] Importar: ler o arquivo, recusar outra conta, gravar a importação e as linhas novas (sem repetir) e auditar.
  - [ ] Motor sobre as linhas pendentes, com títulos em aberto, lançamentos não conciliados da conta, lotes e regras, todos lidos em `Promise.all`.
  - [ ] Automação da importação (4.7), com `avaliada_em` e `sem_auto`.
  - [ ] Seções e ações (4.6): grupos com Trocar, lupa, Corrigir a baixa com motivo e histórico, Saiu e voltou, regras e "Lembrar como regra", ignorar, desfazer, "sem linha no banco".
  - [ ] Popup aberto pela linha: valor, data, conta e forma do banco; parcial quando o título é maior; retenção sugerida; juros quando cabe; bloqueio quando não bate.
  - [ ] Extrato: coluna Banco ✓, ⚠, faixa de aviso, contador e "Histórico da baixa" no ⓘ.
  - [ ] Aba Títulos: faixa + ícone.
- **Testes** (portar a lógica do protótipo):
  - parser com o arquivo de exemplo (`ofxDeExemplo` em `prototipo/src/data.js`): SGML, vírgula decimal, LEDGERBAL e DTSERVER;
  - impressão digital: a segunda importação do mesmo dia não acrescenta linhas;
  - motor com os dados do protótipo. Contagem esperada na versão das seções: `regra:alta 5, sugestao:alta 40, diferenca:media 2, combinacao:alta 2, par:alta 2, divergencia:media 1, sem_par 1, sugestao:media 3, ja_lancado:alta 1, soma:alta 1`, de `test/comb.js`;
  - os casos do grupo: N=N vira alta, N<M fica média, e trocar troca;
  - a soma 4b com uma e com duas combinações;
  - a correção da baixa: os juros saem e o valor fica o do banco.
- **No navegador:** importe o mesmo arquivo de exemplo no app, numa base de teste com os mesmos títulos, ou num cenário montado. Confira as seções e os números com o protótipo.

### Fase 4: fechamento

- **Objetivo:** seção 6 e as migrations M4.1 a M4.3.
- **Passos:**
  - [ ] Trigger e RPCs.
  - [ ] Botão, faixa, reabrir com motivo e histórico.
  - [ ] Bloqueios no popup e nas ações, com as mensagens.
  - [ ] Cadeado no Extrato.
  - [ ] Revisar a decisão 120: o cancelar passa a ter o limite do fechamento.
- **Testes:**
  - dia completo, com o arquivo gerado no mesmo dia e depois;
  - as três condições de fechar;
  - o trigger recusa insert, update e delete com data até o fechamento, e aceita depois de reaberto;
  - reabrir sem motivo é recusado.

## 9. Mapa do protótipo

| Comportamento | Onde está em `prototipo/src/` |
|---|---|
| Planilha de títulos (colunas, totais, sinal do banco, ação) | `titulos.jsx`: `PlanilhaDeTitulos`, `CelulaRegional`, `LinhasDosItens` |
| Extrato da conta | `titulos.jsx`: `AbaExtrato` |
| Contas a Pagar, Contas a Receber e Impostos (regra da coluna por versão) | `modulos.jsx`: `ContasAPagar`, `ContasAReceber`, `ImpostosAPagar` |
| Coluna do valor por módulo | `logica.js`: `celulaDoModulo` |
| Regional, siglas e "TD" | `logica.js`: `SIGLA`, `colunasDaRegional`, `regionalDe`, `textoDaRegional` |
| ⓘ A e histórico da baixa | `detalhes.jsx`: `BotaoDetalhes`, `ConteudoA`, `HistoricoDaBaixa`, `extrasDe`, `tituloDoLancamento` |
| Documentos lado a lado e ações do ⓘ | `documentos.jsx`: `VisualizadorDeDocumentos`, `acoesDoPainel` |
| Popup de baixa | `dialogos.jsx`: `BaixaDialog`, `LinhaChave`, `TabelaDeRetencoes`, `NoFiscalDaBaixa`, `atrasoDoPagamento`, `formaInicial` |
| Novo pagamento avulso com "Lembrar como regra" | `dialogos.jsx`: `PagamentoAvulsoDialog` |
| Cartão (capa, fatura, extrato, fechar) | `cartao.jsx` |
| Fatura destino e opções | `logica.js`: `faturaDestino`, `opcoesDeFatura` |
| Parser, impressão digital e motor | `ofx.js`: `lerOfx`, `digitais`, `casar`, `formaDoHistorico`, `cnpjDoHistorico`, `retencaoQueExplica` |
| Seções, tabela do banco, grupos, lupa, correção, reabrir | `banco.jsx` |
| Correção da baixa (cálculo) | `logica.js`: `correcaoDaBaixa` |
| Estado e ações (conciliar, grupo, soma, desfazer, corrigir, automação, fechamento) | `main.jsx`: `acoesBanco`, o efeito da importação, `fecharPeriodo`, `reabrirPeriodo`, `bloqueado`, `diaCompleto`, `naoApareceu` |
| Dados do exemplo | `data.js` |

## 10. Riscos e pontos de atenção

- **Cancelar apaga o lançamento de verdade** (M3.8): sem tratar, cancelar uma baixa conciliada quebra a FK ou deixa a linha órfã.
- **Guia de imposto com rateio:** a guia vira N lançamentos, e a linha do banco liga a todos. A soma é que tem de bater.
- **Pagamento de fatura:** gera dois lançamentos (banco e conta-espelho). Só o do banco se liga.
- **Transferência:** um lançamento em cada conta, cada um com a linha do seu extrato.
- **Datas no dia de Brasília:** a `main` acabou de corrigir isso no fluxo de caixa (commit `122c91e`). Use as mesmas funções para hoje, vencido e dia completo.
- **Desempenho:**
  - o motor roda em memória sobre os títulos em aberto e as linhas pendentes de uma conta;
  - leia só o necessário, com índices nas colunas do filtro;
  - nada de embed pesado para contar.
- **Forma "concessionária":** não existe no enum, e conta de consumo entra como Boleto. Fica como pendência.
- **Segurança:** o arquivo OFX é dado do usuário. Leia como texto, limite o tamanho e não guarde o conteúdo cru no banco, só as linhas.

## 11. Fora deste pacote (pendências registradas)

1. **Regras do DRE** (para a especificação da tela do DRE):
   - soma com sinal pela natureza;
   - o estorno vai no mesmo centro do custo que ele abate: verba, estorno de compra no cartão, estorno de baixa (decisão 120);
   - detalhar pela origem, não pelo plano;
   - **BV:** o plano de contas fica para decidir com a contabilidade (decisão 184);
   - **fechamento do DRE por competência:** o fechamento desta conciliação trava só o caixa.
2. **Achados no sistema atual** (lidos no código, não testados):
   - o parcelamento de compra no cartão parece quebrado desde a decisão 093: `parcelar_compra_cartao` exige `fatura_cartao_id` na compra;
   - a data da compra da avulsa é ignorada na baixa no cartão;
   - o crédito de uma fatura credora não passa para a seguinte;
   - a forma da baixa da fatura não é gravada;
   - a conta de consumo entra como Boleto, porque falta o valor no enum `forma_pagamento`.
3. **Desembolso:** o centro de custo passa a ser definido na aprovação, para o título nascer completo. Isso revisa a decisão 069 (desembolso sem plano próprio); hoje ele é escolhido na baixa, em `aprovar-desembolso-dialog.tsx`. No protótipo, o desembolso já vem com o centro.
4. **Arquivo de retorno do banco** (.RET do CNAB): ler o retorno para saber qual item da remessa falhou. A conciliação não depende disso.

## 12. Pontos para confirmar com o Tiago durante a implementação

Pergunte quando chegar neles, não antes.
- M2.1: assinatura das RPCs de baixa com juros.
- M2.2: assinatura de `cartao_lancar_item`.
- M2.4: checagem de financeiro nas RPCs que hoje não têm.
- M3.3: coluna em `lancamentos_financeiros` ou tabela de vínculo.
- M3.6: como registrar o "Saiu e voltou".
- M3.8: cancelar baixa conciliada desliga ou recusa?
- M4.2: o trigger de fechamento em `lancamentos_financeiros`.
