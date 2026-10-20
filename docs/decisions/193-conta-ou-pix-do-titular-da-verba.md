# 193 — A conta ou o PIX do titular da verba: automático pelo cadastro quando ele tem, digitado na PP quando não tem

**Data:** 2026-10-19
**Status:** aceita e implementada em 19/10/2026.
**Quem decidiu:** Tiago, em 19/10/2026 — versão 3 do protótipo "Conta do
titular da verba" (https://claude.ai/artifact/QzX86STwm9XFVarN3wqLp9), a
"opção A" de 15/10 refeita depois que o freela passou a vir do cadastro de
freelas do RH.
**Revê:** a [171](171-verba-de-producao-com-titular-e-conta-do-rh.md) — o
freela e o colaborador sem conta no RH, que saíam sem dados bancários.
**Migration:** `20261019900005_conta_do_titular_da_verba.sql`. Ela foi
aplicada com o número 191 no cabeçalho e nos comentários: a 191 foi
reservada por outra sessão (item no PDF da PP) antes do push, e esta
decisão virou 193. Os comentários das funções no banco foram corrigidos
pela `20261019900006_decisao_193_renumerada.sql`; o corpo do gatilho
segue dizendo 191, como foi aplicado.

## O problema

A 171 fez a PP de verba do colaborador sair com a conta e o PIX da ficha
do RH, copiados pelo banco. O freela ficou de fora: a lista provisória de
freelas não tinha conta, e a PP dele saía sem dados bancários. O
financeiro passou a recusar essas PPs — a PP-00127 voltou em 19/10 com
"ta sem os dados bancarios". Em 19/10 havia 10 PPs de freela em avaliação,
todas sem conta.

No mesmo dia o freela passou a vir do cadastro de freelas do RH
(`freelancers`, decisão 171 revista), que tem PIX e conta, mas digitados à
mão: o tipo da chave não é guardado, o banco está escrito de dezenas de
jeitos ("nubank", "Inter - 077"), a conta às vezes não tem dígito, e o
tipo de conta não existe. Dos 64 freelas ativos, 59 têm PIX e 63 têm conta.

## A regra

1. **Quem paga pelo cadastro não vê campo.** O colaborador com conta ou
   PIX na ficha do RH (como na 171) e o freela com PIX completo no
   cadastro de freelas têm o pagamento copiado para a PP pelo banco, ao
   gerar. Embaixo do titular aparece só "Pagamento pela conta e pelo PIX
   da ficha do RH" ou "Pagamento pelo PIX do cadastro de freelas"; a
   revisão diz o mesmo em "Dados bancários". O dado não passa pela tela.
2. **PIX completo** é o que tem o tipo deduzido com segurança: e-mail,
   chave aleatória, CNPJ, ou 11 números iguais ao CPF da própria pessoa.
   Onze números que não são o CPF dela podem ser telefone ou o CPF de
   outra pessoa: não vão automático. Em 19/10, 46 dos 64 freelas ativos.
3. **Quem não paga pelo cadastro digita o PIX ou a conta, obrigatório** —
   o freela sem PIX completo e o colaborador sem conta nem PIX na ficha
   (18 de 210). O campo "Pagamento" aparece embaixo do titular, no
   desenho do "Outro PIX / Outra conta" da 127: PIX (tipo e chave) ou
   conta (banco, agência, conta, dígito e tipo). Sem ele a PP não salva
   nem gera; o servidor confere de novo, com a régua do cadastro de
   fornecedor.
4. **A conta do cadastro de freelas não vai automática**: falta o tipo de
   conta e, em parte, o dígito.
5. Vale para as três verbas e para o reembolso (decisão 187). O terceiro
   (fornecedor) não muda: paga pelo cadastro dele.
6. O pagamento sai no PDF no bloco "Dados bancários do titular da verba
   (ou do reembolso)", que a 171 já imprimia para o colaborador, com o CPF
   do titular.

## Por que não pré-preencher o campo com o cadastro

Foi a primeira recomendação, e caiu na mesma conversa: para preencher, o
sistema teria de entregar a conta e o PIX de qualquer freela a quem gera
PP — freelancer incluso (decisão 136) —, o vazamento que a 171 evitou
copiando a ficha pelo gatilho. E o cadastro é uma migração sem
conferência: o titular da PP-00127 tinha lá um CNPJ diferente do
cadastro de fornecedor feito no mesmo dia.

## No banco

- `pix_do_cadastro_do_freelancer(uuid)`: o PIX usável do freela (tipo,
  chave no formato do banco, CPF), ou nada. Sem EXECUTE para
  `authenticated` e `anon`; só o gatilho e a lista a chamam.
- `pp_foto_do_colaborador()` (gatilho `trg_pp_foto_do_colaborador`):
  copia o PIX do freela como copia a ficha do colaborador, e guarda o
  pagamento digitado de quem não tem cadastro usável enquanto a PP está
  "gerada" — enviada, a foto não muda. A PP de freela já enviada antes
  desta decisão não ganha foto depois.
- `pessoas_para_verba(uuid)` devolve `paga_pelo_cadastro` (sim ou não,
  nunca o dado), que decide se o formulário pede o campo.
- O pagamento digitado mora nas colunas da foto da PP (`fornecedor_*`,
  como o do colaborador) e, na PP a emitir, em `dados.pagamento_do_titular`,
  com `dados.titular_paga_pelo_cadastro` gravado pelo servidor ao salvar.

## No sistema

- Formulário da PP (`gerar-pp-drawer.tsx`) com o campo de
  `pagamento-do-titular-field.tsx`; validação no servidor por
  `lib/validations/pagamento-do-titular.ts`.
- Gerar, salvar a PP a emitir, editar a PP gerada (173) e "Editar e
  Reemitir PP" (153) levam o pagamento digitado. Na PP gerada em edição,
  a ação `pagamentoDigitadoDaPP` devolve só o digitado.
- A prévia do PDF mostra o pagamento digitado; o do cadastro só sai na PP
  gravada.

## Fora daqui

- As 10 PPs de freela enviadas antes desta decisão seguem sem conta: o
  financeiro resolve caso a caso ou pede a reemissão.
- Remessa (CNAB) continua só para fornecedor.
- O cadastro de freelas guardar o tipo do PIX e o tipo de conta (módulo de
  Freelancers, outra frente) poria mais freelas no automático.
