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

## O que fica de fora

O botão "Importar planilha" da tela do orçamento continua criando uma
versão nova (v+1) — ele não passou a sobrescrever. Ver a nota da
importação no `HANDOFF_ORCAMENTO.md`.
