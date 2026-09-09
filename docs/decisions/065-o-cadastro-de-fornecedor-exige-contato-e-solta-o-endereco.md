# 065 — O cadastro de fornecedor exige contato e solta o endereço

**Data:** 2026-09-09
**Status:** aceita
**Migration:** nenhuma — as seis colunas de endereço já eram `null`-áveis
**Design:** `Fornecedores - Novo Cadastro.dc.html`, projeto Claude Design
`69342d83`
**Contexto:** `/fornecedores/novo`, `/fornecedores/[id]` e o dialog do "+"
de dentro da PP. Completa a [048](048-fornecedor-nasce-de-dentro-da-pp.md),
que criou o cadastro rápido.

## As três decisões do Tiago

Perguntadas antes de codar, olhando o desenho ao lado do formulário de
hoje:

| Pergunta | Resposta |
|---|---|
| O endereço, que o desenho marca como opcional, para de travar o cadastro? | **Sim.** Nasce recolhido atrás de "Informar endereço" e não bloqueia nada. |
| CPF/CNPJ, e-mail e telefone passam a ser obrigatórios também pela página? | **Sim**, nos dois caminhos. Eram exigidos só no cadastro rápido da PP. |
| O botão fica apagado até o cadastro estar completo? | **Sim**, com o rodapé dizendo o que falta, ao vivo. |

## 1. Por que o endereço saiu do caminho crítico

Ele era obrigatório em seis campos (CEP, logradouro, número, bairro,
cidade e UF) e travava quem tinha em mãos só o que interessa para pagar:
documento, contato e uma forma de recebimento. O endereço serve à nota
fiscal, e a nota vem depois — não no minuto em que alguém está gerando
uma PP.

**O aviso não sumiu:** a lista de Fornecedores já marcava `Dados
incompletos` para quem está sem CEP ou sem forma de pagamento
(`fornecedorIncompleto`), e é exatamente essa a leitura certa agora —
criar sem endereço é permitido e fica sinalizado.

Nada mudou no banco: as seis colunas já aceitavam nulo. O que travava era
só o Zod.

## 2. Por que documento, e-mail e telefone subiram de régua

O cadastro rápido de dentro da PP (decisão 048) já exigia os três, por um
motivo que vale para os dois caminhos: **o documento é a chave que
impede cadastro repetido** — sem ele a verificação não tem o que comparar
— e **e-mail e telefone são como o financeiro cobra a nota**. Um
fornecedor criado pela página sem esses campos ia dar o mesmo trabalho
depois.

Efeito colateral aceito: na base de hoje, 1 dos 23 fornecedores está sem
e-mail e 1 sem telefone. Editar qualquer um dos dois passa a pedir o
campo que falta antes de salvar.

`fornecedorCompletoSchema` virou alias de `fornecedorSchema` — os dois
caminhos passaram a ter a mesma régua, e o nome ficou por ser o que as
actions do cadastro rápido usam.

## 3. O rodapé que conta, e o botão que espera

O rodapé lista o que falta em português corrido — *"Falta CNPJ, e-mail e
telefone."* — e vira *"Pronto para criar"* quando não falta nada. O botão
só acende aí.

A conta é feita **na tela**, relendo o formulário a cada tecla; quem
recusa de verdade continua sendo o servidor, que confere o que a tela não
tem como conferir: dígito verificador do CPF/CNPJ, formato da chave PIX,
banco existente e duplicidade. Por isso o botão aceso não é promessa de
sucesso — é só a garantia de que os campos foram preenchidos.

**Documento repetido também apaga o botão**, com o rodapé dizendo por
quê. E digitar no campo do documento limpa o aviso na hora: com o botão
travado, esperar o `blur` deixaria quem está corrigindo sem saída
aparente.

## 4. O que o desenho mudou de forma

- **Um cartão com quatro seções** (Identificação, Pagamento, Endereço,
  Observações), cada uma com a explicação numa coluna à esquerda e o selo
  `Obrigatório`/`Opcional`. Eram cinco cartões soltos, todos iguais.
- **Banco e PIX viraram abas**, com selo `preenchido`. As duas ficam
  montadas: trocar de aba não apaga o que foi digitado.
- **Agência e conta ganharam o dígito no mesmo campo**, separado por
  barra, como se escreve num cheque.
- **O tipo de pessoa subiu para o topo**, fora do cartão: ele manda nos
  rótulos do formulário inteiro (Nome fantasia/Nome, CNPJ/CPF).
- O cartão externo saiu das duas páginas — o formulário traz o próprio.

No dialog da PP a coluna da explicação vira uma linha acima dos campos: o
cartão ali é estreito, e duas colunas apertariam os dois lados.

## Onde a regra mora

| | Arquivo |
|---|---|
| As regras | `lib/validations/fornecedores.ts` |
| O formulário (as três telas) | `app/(app)/fornecedores/fornecedor-form.tsx` |
| As páginas, sem o cartão externo | `fornecedores/novo/page.tsx`, `fornecedores/[id]/page.tsx` |
| O selo "Dados incompletos" | `fornecedores-list.tsx` — `fornecedorIncompleto` |

## Conferido no navegador (09/09/2026)

Nos três modos. Na página: o rodapé encolhe a lista de pendências a cada
campo preenchido, o erro de tamanho do documento aparece na hora, a aba
PIX acende o selo `preenchido` com o "Usar CNPJ do cadastro", e o
cadastro **sem endereço** gravou com as seis colunas em `null`. O
documento repetido abriu o aviso âmbar com "Abrir cadastro existente" e
travou o botão. Na edição, a aba abre no PIX quando é só o que o
fornecedor tem. No dialog da PP, o formulário colapsa para uma coluna e
o rodapé fica corrido no fim.

## Fora desta decisão

- **Endereço obrigatório para enviar PP ao financeiro.** Cogitado como
  meio-termo e descartado: o Tiago escolheu opcional nos dois caminhos.
- **Backfill de e-mail e telefone** nos dois cadastros antigos que estão
  sem. Eles só serão pedidos quando alguém editar o registro.
