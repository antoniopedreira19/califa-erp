# 067 — O campo de fornecedor busca, limpa e edita

**Data:** 2026-09-09
**Status:** aceita
**Migration:** `20260909210001_pp_congela_dados_de_pagamento.sql` — dez
colunas de foto em `pedidos_compra` (parte 4). O campo em si só passou a
LER `fornecedores.cpf_cnpj`, coluna que já existia.
**Design:** `PP - Campo Fornecedor.dc.html` e `Fornecedores - Novo Cadastro
na PP.dc.html`, projeto Claude Design `69342d83`
**Contexto:** o campo de fornecedor do formulário de PP (nova e rejeitada)
e do BV. Continua a [048](048-fornecedor-nasce-de-dentro-da-pp.md), que
criou o "+", e a [065](065-o-cadastro-de-fornecedor-exige-contato-e-solta-o-endereco.md),
que refez o formulário que o "+" abre.

## O problema

O campo era um combo de escolher: 23 fornecedores hoje, uma lista que só
cresce, e nenhuma forma de chegar num deles a não ser rolando. Escolhido
o errado, não havia como desfazer — o campo não zerava. E o "+" ao lado,
que cadastra, ficava inútil depois da primeira escolha, ocupando espaço
para uma ação que ninguém mais ia usar naquele formulário.

## As decisões do Tiago

Perguntadas antes de codar:

| Pergunta | Resposta |
|---|---|
| Onde entra o campo novo agora? | **PP e BV.** As outras seis telas com campo de fornecedor ficam para depois — pendência registrada abaixo. |
| Quem vê o lápis? | **Quem gera a PP.** Sem gate novo no cliente; o servidor continua exigindo `cadastros.fornecedores.editar`. |
| E se alguém editar os dados bancários de um fornecedor que já tem PP no financeiro? | **Congelar na PP + asterisco.** Ver a seção 4. |

## 1. Escrever para buscar

O `Combobox` ganhou uma caixa de busca no topo da lista. Ela filtra sem
acento e sem caixa, e olha **duas** coisas: o nome e o documento. Cada
opção passou a ter duas linhas — nome em cima, CPF/CNPJ em monoespaçada
embaixo — porque a base tem homônimos e o documento é o que desempata.

Para o campo ter o documento, quatro consultas passaram a trazer
`cpf_cnpj` junto do nome. Nenhuma delas ganhou linha ou embed novo: é uma
coluna a mais no `select` que já existia.

**Busca sem resultado não é beco.** Digitou um nome que não está na base,
o rodapé da lista oferece *"Cadastrar «…» como novo fornecedor"* e abre o
cadastro **com o nome já preenchido**.

## 2. O ✕ que zera e o botão que troca de cara

Dentro do campo, à esquerda da seta, um ✕ aparece assim que há alguém
escolhido. Ele limpa a escolha sem abrir a lista — vai como `<span
role="button">` porque o gatilho do combo já é um `<button>`, e botão
dentro de botão é HTML inválido.

Ao lado do campo, o botão único:

- campo **vazio** → **"+"**, que cadastra um fornecedor novo;
- campo **preenchido** → **lápis**, que abre o cadastro do escolhido.

É o mesmo botão trocando de ícone, não dois botões. O ✕ é o que devolve o
"+" — daí ele ser obrigatório para o desenho fechar.

## 3. O dialog de cadastro agora também edita

O `NovoFornecedorDialog` da decisão 048 passou a aceitar um fornecedor
existente e virar edição. É o **mesmo** `FornecedorForm` da página, no
modo `dialog` — não há um segundo formulário de fornecedor com regras
próprias, e as réguas da 065 valem aqui inteiras.

Só o cabeçalho muda: título, nota e o toggle **PJ/PF**, que no desenho
mora ao lado do título em vez de uma linha própria, porque ali o espaço é
do dialog.

A edição **não mexe na escolha**: salvou, o dialog fecha, o fornecedor
continua selecionado e o que já tinha sido digitado na PP ou no BV
continua lá.

Como o dialog abre de mais de uma tela, o texto do cabeçalho é
parametrizado por `contexto` (`"pp"` | `"bv"`) — *"Ao criar, ele já fica
selecionado na PP"* virou *"…no BV"* quando é o BV que está atrás. As
telas da pendência abaixo acrescentam suas chaves.

## 4. Dado de pagamento de PP já enviada: congela e marca

O risco que o lápis cria: se alguém editar banco, agência, conta ou PIX de
um fornecedor **depois** que uma PP dele já foi para o financeiro, a PP
passaria a apontar para uma conta que não era a combinada.

A saída escolhida pelo Tiago: **congelar na PP + asterisco**.

### O que o financeiro realmente lê (a descoberta que desenhou a solução)

Nenhuma tela do financeiro lê os dados bancários do fornecedor do banco —
todas as consultas de lá pedem só `id, nome, razao_social`. **Quem paga
lê o PDF da PP**, montado por `lib/pdf/pedido-compra.ts` e guardado no
storage.

Isso muda onde a foto tem de ser tirada. Se ela saísse no envio ao
financeiro, sairia de um cadastro que pode não ser o mesmo que gerou o
PDF, e documento e foto discordariam. Então **a foto sai junto do PDF**,
do MESMO `select` do fornecedor, nas três rotas que montam o documento:
emitir a PP, editar a PP gerada e reenviar a rejeitada. O congelamento
acontece no envio porque a partir dali nada mais re-monta o PDF.

### O que entrou

* **Dez colunas em `pedidos_compra`** — os nove campos de pagamento com o
  prefixo `fornecedor_`, mais `dados_pagamento_congelados_em`. Migration
  `20260909210001`, aditiva, com backfill das 16 PPs que já estavam no
  financeiro (o cadastro de hoje é a única foto possível para elas, e é
  também o que já valia).
* **`lib/data/foto-pagamento-da-pp.ts`** — tirar, ler e comparar a foto,
  num módulo só, para as três rotas não divergirem.
* **O asterisco.** Calculado no servidor comparando a foto com o cadastro
  atual **campo a campo** — não por `updated_at`, que sobe quando alguém
  troca o telefone e não desce quando a pessoa muda e volta atrás. Ele só
  marca PP com a foto de fato congelada (`em_avaliacao`, `aprovada`,
  `pago`): em `gerada` e `rejeitada` o próximo salvar re-tira a foto, e
  avisar de um descompasso que se desfaz sozinho seria ruído.
  Aparece na aba de PPs do job, com tooltip, e na ficha da PP em leitura,
  explicado por extenso — é lá que alguém abre para conferir uma PP que já
  saiu do job.
  Os dados bancários **não atravessam** para o cliente: o que sai do
  servidor é um booleano por PP.
* **O "tem certeza?" ao salvar o cadastro.** `atualizarFornecedor` compara
  os nove campos e, se mudaram E o fornecedor tem PP em `em_avaliacao`,
  `aprovada` ou `pago`, devolve `pedeConfirmacaoPagamento` em vez de
  gravar. O aviso cita as PPs, diz que a alteração não chega até elas e
  aponta o caminho certo quando o errado é o pagamento de uma PP que já
  está lá: cancelar e emitir outra. A auditoria registra a confirmação.

### O que ficou de fora

O financeiro continua pagando pelo PDF, que é a foto na prática. Fazer as
telas de `app/(app)/financeiro/**` lerem as colunas da foto e mostrarem o
asterisco ao lado do título a pagar **não entrou** — aquele módulo é de
outra frente, que está mexendo nele agora, e escrever por cima quebraria a
regra combinada em `CLAUDE.local.md`. `lerFoto` já está exportada para
quando essa ponta for fechada.

## 5. As outras telas — feito em 10/09/2026

A pendência que esta decisão tinha registrado foi fechada. **Eram 6 telas,
mas só 3 componentes**, porque cada drawer é montado de dois lugares:

| Componente | Telas que o montam |
|---|---|
| `conta-avulsa-drawer` | Contas a Pagar (Títulos e Cartão) e `avulsa/[id]` |
| `conta-recorrente-drawer` | Contas a Pagar (Recorrências) e `recorrente/[id]` |
| `desembolso-drawer` | Desembolsos (lista) e o drawer de novo desembolso |

**Contas a Receber ficou de fora, e está certo:** o campo de fornecedor de
`faturar-drawer` é `disabled` com `onValueChange={() => undefined}` — ele
só EXIBE o fornecedor do BV, que vem do próprio BV. Não é um seletor, e
convertê-lo daria a impressão de que dá para trocar.

### O bloco virou componente

Três cópias novas do mesmo comportamento divergiriam na primeira correção,
então o conjunto (busca + ✕ + botão + dialog + a lista mesclada com o
recém-criado) saiu para `app/(app)/fornecedores/campo-fornecedor.tsx`. A
PP e o BV continuam com a versão que montaram à mão — cada um tem a sua
altura e o seu texto de apoio; unificar aqueles dois é trabalho para quando
alguém mexer neles de novo.

### O ✕ substituiu a opção "Nenhum"

Nas três telas o fornecedor é opcional, e a lista trazia uma linha
"Nenhum". Com o ✕ dentro do campo haveria dois jeitos de dizer a mesma
coisa — e, pior, o ✕ apareceria ao lado da palavra "Nenhum". A linha saiu;
quem quer voltar ao vazio usa o ✕.

### Dois defeitos que a verificação expôs

1. **A fronteira de tipo comia o documento.** Seis componentes
   intermediários declaravam `fornecedores: Array<{ id, nome }>`. O dado
   sobrevive em tempo de execução, mas o TIPO some — e o próximo `.map` no
   caminho o descartaria de vez, com `tsc` limpo. É a mesma armadilha que
   o financeiro achou no asterisco no mesmo dia. As seis fronteiras
   passaram a declarar `cpf_cnpj`.
2. **`id="fornecedor_id"` estava duplicado.** Os drawers de avulsa e de
   recorrência ficam montados ao MESMO tempo na tela de Contas a Pagar, e
   os dois usavam esse id — o `<Label htmlFor>` de um apontava para o
   campo do outro. Viraram `avulsa-fornecedor` e `recorrente-fornecedor`.
   (Os campos de cliente e job da mesma tela têm o mesmo problema e
   continuam como estavam — fora do que esta decisão tocou.)

## Verificação

Conferido no navegador logado, nas sete superfícies que usam o campo:

- **PP nova** (`gerar-pp-drawer`): busca por `62.074` achou GABRIELA pelo
  documento; "Cadastrar «Grafica Teste Califa»" abriu o dialog com o nome
  preenchido; o lápis carregou o cadastro completo; salvar fechou o dialog,
  manteve o fornecedor escolhido e a descrição digitada sobreviveu ao
  `router.refresh()`.
- **PP rejeitada** (`editar-pp-drawer`): o ✕ zerou o campo, o lápis virou
  "+" e a dica abaixo trocou junto.
- **BV pelo realizado do job** e **BV pelo orçamento**: as duas listas
  vieram com o documento na segunda linha; o cabeçalho do dialog leu "no
  BV".

E a parte 4:

- **o "tem certeza?"**: trocar a agência de um fornecedor com PP aprovada
  no financeiro parou o salvamento e mostrou o aviso citando a PP;
  confirmando, gravou;
- **o asterisco** apareceu na aba de PPs e na ficha da PP aprovada, e
  **não** apareceu na rejeitada do mesmo fornecedor — que é a regra;
- **a foto** ficou onde estava (agência antiga) enquanto o cadastro já
  tinha a nova, e o asterisco sumiu ao desfazer a alteração;
- **PP nova** (gerada no projeto de teste) nasceu com as dez colunas
  preenchidas.

**As três rotas que montam o PDF foram exercitadas uma a uma** (10/09/2026),
cada uma com o cadastro do fornecedor mudando entre elas, para provar que a
foto REALMENTE se re-tira e não fica presa na primeira:

| Rota | Agência no cadastro | Agência na foto, depois |
|---|---|---|
| Emitir (PP-00051 gerada) | 0001 | 0001 |
| Editar a gerada (mesmo PP, depois de trocar o cadastro) | 0002 | **0002** |
| Reenviar a rejeitada (enviada, rejeitada pelo financeiro, cadastro trocado de novo, reenviada) | 0003 | **0003** |

O `dados_pagamento_congelados_em` avançou nas três. O caminho completo
passou pelas travas reais que já existiam — anexo de NF obrigatório para
enviar, a trava do `A · Repasse` exigindo que as PPs cubram o orçado
(decisão 062) e o "tem certeza?" de PP acima do planejado.

**O filtro de status do aviso também se provou no caminho:** com PP-00051
ainda `gerada` e depois `rejeitada`, o "tem certeza?" do cadastro citou
**só a PP-00011** (aprovada) — nunca a de teste. É a regra pretendida: PP
que o produtor ainda controla re-tira a foto sozinha no próximo salvar.

**Limpeza:** as duas PPs de teste (PP-00050 e PP-00051) foram canceladas
pela UI e o cadastro do fornecedor usado foi restaurado campo a campo.
Consulta final confirmou **zero** PPs com foto divergente do cadastro —
nenhum asterisco residual ficou na base.

**As três telas do financeiro** (10/09/2026), cada uma aberta e operada:

- **desembolso**: busca por `62.074` achou pelo documento; o lápis trouxe
  o cadastro completo; salvar fechou o dialog e o drawer **manteve** o
  fornecedor escolhido e a descrição digitada, apesar do `router.refresh()`;
  o ✕ zerou e o lápis virou "+";
- **conta avulsa**: busca por `34.631` achou pelo documento; "Cadastrar
  «Fornecedor Inexistente Teste»" abriu o cadastro com o nome preenchido e
  o cabeçalho lendo *"na conta"*;
- **recorrência**: busca por `48.200` achou pelo documento; o cabeçalho leu
  *"para a recorrência"*; o ✕ zerou e devolveu o "+".

Nada foi gravado nessas três: todos os drawers foram fechados por
"Cancelar". **Uma armadilha de teste vale registro:** o primeiro teste da
recorrência leu *"na conta"* e parecia defeito de código — era o `id`
duplicado, que fez o `getElementById` pegar o campo do drawer da avulsa,
ainda montado atrás. O defeito existia, mas não era o que parecia.

`npx tsc --noEmit`, `next lint` e `npm run build` limpos. Console sem erro
de aplicação.
