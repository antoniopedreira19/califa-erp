# 066 — O cliente nasce com marcas e portais

**Data:** 2026-09-09
**Status:** aceita
**Migration:** `20260909190001_clientes_contatos_extras.sql` — duas colunas
novas, aditivas
**Design:** `Clientes - Novo Cadastro.dc.html`, projeto Claude Design
`69342d83`
**Contexto:** `/clientes/novo` e `/clientes/[id]`. Irmã da
[065](065-o-cadastro-de-fornecedor-exige-contato-e-solta-o-endereco.md),
que fez o mesmo no cadastro de fornecedor no mesmo dia.

## O problema que abriu a conversa

> "Atualmente só é possível cadastrar marcas depois do cadastro do cliente
> já ter sido realizado, e a mesma coisa com o portal do fornecedor, e
> esse não deve ser o caso."

Marcas e portais viviam em dois cartões (`ProdutosCard`, `PortaisCard`)
que só existiam em `/clientes/[id]`. Quem cadastrava um cliente tinha de
salvar, entrar no cliente recém-criado e voltar para cadastrar as marcas —
sendo que **Produto é obrigatório no formulário de projeto** desde
06/08/2026. O cliente nascia sem estar pronto para o que ele serve.

## As decisões do Tiago

Perguntadas antes de codar, com os números da base na mesa:

| Pergunta | Resposta |
|---|---|
| O desenho marca CNPJ, e-mail e telefone como obrigatórios. Vale, sabendo que 155 dos 157 clientes não têm e-mail e 156 não têm telefone? | **CNPJ obrigatório; e-mail e telefone continuam opcionais.** |
| Vários e-mails e telefones: tabela nova, `text[]`, ou fica para depois? | **Como eu recomendasse** — sem necessidade de rótulo nem de ordem explícita, mas tem de funcionar e ser consistente. |
| O layout novo vale só na criação ou nas duas telas? | **Nas duas.** "Devem se tratar do mesmo formulário com os mesmos campos, apenas um cria inicialmente e o outro realiza qualquer edição." |

## 1. Por que o CNPJ subiu de régua e o contato não

O CNPJ é **a chave que impede cadastro repetido da mesma empresa** — sem
ele a verificação não tem o que comparar. Foi o mesmo raciocínio da 065
para o documento do fornecedor.

E-mail e telefone ficaram de fora por um motivo medido, não por gosto:

| | clientes | sem o dado |
|---|---|---|
| Total | 157 | — |
| CNPJ | | 3 |
| E-mail | | **155** |
| Telefone | | **156** |

Como o formulário é o mesmo da edição, obrigá-los travaria a edição de
praticamente toda a base — alguém que só quisesse corrigir o percentual de
honorários teria de inventar um e-mail primeiro. O desenho marca os três
com `*`; aqui só o CNPJ ficou com o asterisco.

**Efeito colateral aceito:** dos 3 clientes sem CNPJ, dois são teste
(`teste`, `Novo`) e **um é real — SEBRAE**. Editar o SEBRAE passa a pedir o
CNPJ antes de salvar. Sem backfill: o campo só é cobrado quando alguém
mexer no registro.

## 2. Por que os contatos extras viraram coluna, e não tabela

Recomendação minha, aceita: `emails_extras text[]` e `telefones_extras
text[]` em `clientes`. O principal continua em `email`/`telefone`.

O critério foi o "consistente" do pedido. **O PostgREST não dá
transação.** Uma tabela filha faria o cliente e os contatos gravarem em
round-trips separados, com risco de salvar pela metade — que é exatamente
o beco já documentado em `criarCliente` para o produto padrão ("o cliente
já está gravado, PostgREST não dá transação para desfazer"). Em coluna, o
contato vai no mesmo `INSERT`/`UPDATE` do cliente: ou grava tudo, ou não
grava nada.

O que se abre mão: rótulo (`financeiro`, `comercial`) e ordem explícita —
os dois dispensados no pedido. A ordem do array já é a da tela.

O banco tem a última barreira: `CHECK` que recusa elemento vazio ou nulo
nos dois arrays.

## 3. Marcas e portais no mesmo envio

O formulário manda as duas listas como JSON num campo oculto — `FormData`
plano não dá conta de lista de tamanho livre sem inventar convenção de
nome. JSON quebrado é lido como lista vazia: um payload corrompido não
pode derrubar a action.

**Na criação**, a ordem é: cliente → marca padrão `PRD-01` → marcas extras
`PRD-02`, `PRD-03`… → portais. Cada etapa que falha devolve mensagem
dizendo **o que já foi gravado e o que faltou** — de novo, não há
transação para desfazer, então o pior caminho é redirecionar em silêncio.

**Na edição**, as duas listas são reconciliadas por `id`: linha que volta é
atualizada, linha sem `id` é criada, linha que não voltou é **inativada**.

### Nada é apagado, e por quê

Já era a regra dos dois cartões antigos, e continua: jobs apontam para a
marca, e envios de faturamento apontam para o portal. Apagar deixaria
histórico órfão.

Na prática, o "X" tem dois comportamentos:

- **Linha nova**, ainda não gravada → some do formulário.
- **Linha que já existe no banco** → fica no formulário, apagada, com o
  botão virando **Reativar**.

Isso resolve o que o desenho não previu: ele só desenhou a criação, onde
nada existe ainda, e não tinha como mostrar marca inativa. A alternativa
— sumir com a linha — esconderia do usuário que a marca continua lá.

### A marca principal não mudou

Continua nascendo junto com o cliente, continua com o nome do nome
fantasia e continua protegida pelo trigger `trg_cliente_produtos_padrao`.
No formulário ela é a primeira linha, travada, com o cadeado e o texto
"acompanha o nome fantasia". Ela **nunca** entra na lista enviada.

## 4. O que o desenho mudou de forma

- **Um cartão com cinco seções** (Identificação, Marcas, Portais de
  fornecedor, Honorários, Observações), cada uma com a explicação numa
  coluna à esquerda e o selo. O cartão externo saiu das duas páginas — o
  formulário traz o próprio, como no de fornecedor.
- **O código se sugere sozinho** a partir do nome fantasia: sem acento, só
  letras, as seis primeiras, maiúsculas. Para de sugerir assim que alguém
  digita por cima. **Só na criação** — na edição o código já é prefixo de
  projeto e de job, e não pode se mexer sozinho.
- **CNPJ e código conferidos ao vivo** contra quem já existe
  (`buscarClientePorCnpj`, `buscarClientePorCodigo`), com aviso âmbar e
  "Abrir cadastro existente". Inativo conta: o caminho é reativar.
- **Honorários com o `%` dentro da borda**, e a nota de que mexer aqui não
  muda orçamento que já existe.
- **O rodapé conta o que falta** e o botão só acende quando não falta
  nada, com o rótulo dizendo o que vai acontecer — *"Criar cliente e 2
  marcas"*.

## Onde a regra mora

| | Arquivo |
|---|---|
| As regras | `lib/validations/clientes.ts` |
| O formulário (as duas telas) | `app/(app)/clientes/cliente-form.tsx` |
| As actions e a reconciliação | `app/(app)/clientes/actions.ts` |
| As páginas, sem o cartão externo | `clientes/novo/page.tsx`, `clientes/[id]/page.tsx` |
| As colunas novas | `supabase/migrations/20260909190001_clientes_contatos_extras.sql` |

`Secao` e `Campo` são cópias locais das do formulário de fornecedor.
Extrair para um componente comum obrigaria a editar `fornecedor-form.tsx`,
que é de outra frente — a duplicação foi o preço de não colidir.

## Ficou sem uso, e foi apagado (09/09/2026)

`produtos-card.tsx`, `produto-drawer.tsx`, `produtos-actions.ts`,
`portais-card.tsx` e `portais-actions.ts`. Formavam um bloco fechado: só
`clientes/[id]/page.tsx` os importava, e ele parou de importar nesta
decisão. **O Tiago mandou apagar** — removidos em 09/09/2026, no mesmo
commit desta nota.

⚠️ **A remoção fecha a ponta solta da decisão 050.** `criarPortal`,
`editarPortal` e `alternarPortal` não tinham gate de papel — só
`requireSession`, com RLS de membro do tenant — e o §3 da 050 deixou
registrado que precisariam de `cadastros.clientes.editar` quando os outros
papéis entrassem. Elas deixaram de existir: os portais agora entram por
`criarCliente` / `atualizarCliente`, que **já checam
`cadastros.clientes.editar`**. Não sobrou caminho sem gate.

## Conferido no navegador (09/09/2026)

`tsc --noEmit` limpo, `next lint` limpo (os dois avisos que sobram são
pré-existentes, em `combobox.tsx` e `multi-select.tsx`) e `next build`
completo — rodado numa **cópia isolada** com `node_modules` symlinkado,
porque havia dev server de outra sessão no tree principal.

Depois, logado, nas duas telas:

- **Criação de ponta a ponta.** "ZZ Teste Cadastro 0909" com 2 marcas, 1
  portal e 1 e-mail adicional, num único envio. No banco: `PRD-01` com o
  nome fantasia e `padrao=true`, `PRD-02` Brahma, `PRD-03` Guaraná
  Antarctica, o portal Coupa e `emails_extras` com o segundo e-mail. **É a
  prova do que esta decisão resolve.**
- **Código sugerido:** "Ambev Teste Cadastro" → `AMBEVT`; "ZZ Teste
  Cadastro 0909" → `ZZTEST`.
- **CNPJ repetido:** com o CNPJ da ARENA SERRA DOURADA, o aviso âmbar
  abriu com "Abrir cadastro existente", o rodapé disse "Este CNPJ já tem
  cadastro" e o botão apagou.
- **Código repetido:** com `ZZTEST` já existente, a dica sob o campo e o
  rodapé avisaram e o botão apagou.
- **Inativar e reativar marca**, que era o ponto de maior risco: o "X" na
  Guaraná Antarctica deixou a linha na tela, apagada, com "Reativar";
  depois de salvar **e recarregar do servidor** ela continuou na lista
  como inativa — `ativo=false`, não apagada. Reativar devolveu
  `ativo=true`.
- **Edição carrega o mesmo formulário** com tudo preenchido, incluindo o
  e-mail adicional e o portal.
- **SEBRAE**, o cliente real sem CNPJ: rodapé "Falta CNPJ." e botão
  travado, exatamente o efeito colateral aceito acima.

O cliente de teste ficou **inativado** (não apagado — remover linha pede
confirmação, ver `CLAUDE.local.md`).

### Segunda rodada (09/09/2026, depois da remoção dos órfãos)

A primeira rodada deixou pontas: os dois ajustes abaixo tinham sido
validados só por `tsc`/lint/build, e a tela não havia sido aberta depois
do commit que apagou os cinco arquivos. Fechadas agora, logado:

- **A tela abre igual depois da remoção** — marcas, portal e contatos no
  lugar.
- **Telefone adicional**, que usa `MaskedInput` dentro de lista: máscara
  correta na tela ((11) 3333-4444) e **só dígitos no banco**
  (`telefones_extras: ["1133334444"]`).
- **Inativar portal**, o irmão do caso da marca: o "X" no Coupa deixou a
  linha na tela com "Reativar", e depois de salvar ele está `ativo=false`
  no banco — não apagado.
- **"X" em linha nova** (ainda não gravada) **some de vez**, em vez de
  inativar. É a distinção que separa o que nunca existiu do que tem
  histórico.
- **Portal pela metade trava o rodapé:** "Falta o link do portal Ariba." e,
  com link sem protocolo, "O link do portal Ariba precisa começar com
  http:// ou https://.".
- **Os dois ajustes abaixo, exercitados de verdade:** com CNPJ repetido o
  botão apaga, e **colar outro CNPJ por cima limpa o aviso na hora**, sem
  esperar o blur. Idem para o código.

### Dois ajustes que a conferência gerou

O aviso de CNPJ repetido só era limpo quando o campo caía abaixo de 14
dígitos, e o de código só no `blur`. Quem colasse outro valor por cima
ficaria com o aviso velho e o botão travado, sem saída aparente. Agora
**digitar limpa o aviso na hora**, nos dois campos — a mesma escolha que a
065 já tinha feito no fornecedor.

E um acabamento que só apareceu na tela: o aviso montava *"ARENA SERRA
DOURADA S.A.."* — ponto duplo, porque a razão social já termina em
abreviação. Agora o ponto final só entra quando o nome não tem o dele
(`comPontoFinal`), nos dois avisos.

### Nota de método, para a próxima vez

Dois "bugs" investigados nesta rodada eram do harness, não do produto:
`document.querySelector('form')` pega o form da **sidebar**, não o do
cadastro (a página tem dois) — filtrar por `form:has(#cnpj)`; e clique por
coordenada, e às vezes por `ref` envelhecido, não foca o campo, então o
`blur` nunca dispara — o que funciona é `new FocusEvent('focusout',
{bubbles:true})`, e conferir `document.activeElement` logo após o clique
para separar harness de produto.

## Fora desta decisão

- **Backfill de e-mail e telefone** nos 155/156 cadastros sem. Só serão
  pedidos se alguém quiser preenchê-los.
- **Apagar os cinco arquivos órfãos** (acima).
- **O cadastro de cliente de dentro de outra tela**, como o "+" de
  fornecedor dentro da PP (decisão 048). Não foi pedido.
