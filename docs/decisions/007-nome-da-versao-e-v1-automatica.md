# 007 — Nome da versão e V1 automática

## Status

Vigente. Decidida com o time em 13/08/2026, junto com a
[decisão 006](006-aliquota-fixa-e-gate-de-aprovacao.md) — as duas mudam o
começo da vida de um orçamento e só fazem sentido lidas juntas.

## As duas regras em uma frase

**Criar um orçamento já cria a V1 e abre a planilha dela; e o nome de
toda versão é o nome do job seguido do número, calculado, nunca
digitado.**

## Nome da versão

```
{orcamentos.nome} - V{numero_versao}
```

Exemplo: `Bebedouros SP - V2`.

A fonte é `nomeVersao()` em `lib/nome-versao.ts`. Toda tela que mostra
nome de versão passa por lá.

### Por que calculado, e não gravado

`versoes_orcamento.nome` era texto livre e opcional, editável no título
da tela e no drawer. O resultado eram três padrões convivendo na mesma
lista: nomes escolhidos à mão que não diziam de qual job eram
("V Teste", "Proposta inicial"), nomes automáticos de importação
("Importada de planilha X") e versões sem nome nenhum, que caíam em
"Versão 2".

Calcular na leitura resolve na origem: renomear o job renomeia todas as
versões dele junto, e **não existe caminho pelo qual o nome divirja da
sua origem**. Gravar exigiria backfill agora e um trigger para sempre.

A coluna continua no banco, com o conteúdo antigo intacto. Nenhuma tela
lê e nenhuma action escreve — `nome` saiu do `versaoSchema` e dos dois
extratores de `versoes/actions.ts`, então um formulário que mande o campo
é ignorado no servidor, não só na ausência do input. Preservar o dado
custa nada; apagar seria destrutivo à toa.

### Por que `orcamentos.nome`, e não `jobs.nome`

O campo é o que o formulário de novo orçamento chama de **"Nome do
Job"**. Três motivos para ser ele:

1. A versão existe desde muito antes de haver job.
2. As telas que listam versões não carregam job nenhum.
3. `jobs.nome` é editável por conta própria depois da abertura, então
   passaria a divergir.

Consequência aceita: renomear o job depois da abertura **não** renomeia
as versões. Quem manda no nome da versão é o orçamento.

### Onde não se aplica

O rótulo curto `v1`, `v2` — usado em frases como "Versão v2 aprovada" e
no nome do arquivo XLSX exportado — **não** mudou. Ele é referência de
número, não nome, e trocá-lo por "Versão Bebedouros SP - V2 aprovada"
deixaria as frases ilegíveis.

## V1 automática

Criar um orçamento agora:

1. grava o orçamento;
2. cria a **v1 em rascunho** — honorários do cadastro do cliente, BRL,
   câmbio 1, **sem alíquota**;
3. redireciona para a planilha dessa v1.

Antes, criar um orçamento levava para uma lista de versões vazia e exigia
um segundo passo — "Nova versão" — que nunca teve escolha real: a
primeira versão de um orçamento novo é sempre a v1 em rascunho.

**Sem alíquota de propósito**, e é aqui que esta decisão encosta na 006:
escolher imposto é decisão de fechamento, não de abertura. Quem cobra é a
aprovação, em `bloqueioAprovacaoVersao`, que trava o botão e a server
action com a mesma mensagem.

### Quando a V1 não nasce

Se os honorários do cliente não puderem ser lidos, a v1 **não é criada** e
o usuário cai na tela do orçamento, como antes. Uma versão com base de
honorários errada produziria fechamento errado em silêncio — é preferível
abrir sem versão, que é um estado que a tela já sabe mostrar. O erro vai
para o log do servidor.

Refazer o formulário criaria um orçamento duplicado, então esse é o
degrau seguro: nunca voltar para o formulário depois do orçamento gravado.

## Adendo — importar substituindo a versão (13/08/2026)

A tela da versão ganhou um **"Importar planilha"** ao lado do "Exportar".
Ele **substitui** o conteúdo da versão aberta, em vez de criar uma versão
nova. O caso que atende, nas palavras do time: *"importei a planilha
errada, quero importar a certa no mesmo lugar"*.

O botão da tela do **orçamento continua como estava**, criando uma v+1 —
decisão do time. Os dois dividem o mesmo componente e o mesmo preview; o
que muda é o destino e, no que sobrescreve, um passo a mais.

### O que apaga

Grupos, itens e — em cascata — os **BVs** lançados nesses itens. O BV
pertence ao item e não sobrevive à troca da planilha. A confirmação
mostra os três números antes de qualquer escrita, e o botão só grava no
segundo clique.

### O que preserva

Alíquota, honorários, moeda, câmbio e status. É a diferença de fundo para
`confirmarImportacao`, que redefine tudo isso ao criar a versão: quem já
escolheu a alíquota não perde a escolha ao reimportar.

### Ordem e travas

**Itens antes de grupos**: `versoes_orcamento_itens.grupo_id` é
`RESTRICT`, então apagar grupo com item dentro falha.

Duas travas, porque apagar item **cascateia para
`jobs_itens_realizado`** e é **barrado por `jobs_itens_orcado`**
(`NO ACTION`):

1. versão `aprovada` ou `cancelada` recusa a importação;
2. versão que já tem cópia em `jobs_itens_orcado` recusa, com mensagem
   pedindo para criar versão nova.

O status sozinho já impediria — job exige versão aprovada — mas a regra é
financeira e não pode depender de uma camada só.

**Planilha sem itens não apaga nada**: o usuário pediu para TROCAR, não
para destruir em troca de nada.

A ação é `sobrescreverVersaoComPlanilha` em `versoes/importar-actions.ts`,
e registra auditoria própria (`versao_orcamento.sobrescrita_por_importacao`),
separada de `versao_orcamento.importada` — uma só cria, a outra destrói
antes de criar, e a auditoria precisa distinguir as duas.
