# 166 — Regime tributário (Real e Presumido separados) e CNAE obrigatórios no fornecedor, e a PP travada para cadastro incompleto

**Data:** 2026-10-09
**Status:** aceita e implementada (09/10/2026); revista em 10/10/2026 (§6: o GP edita o cadastro pendente inteiro).
**Quem decidiu:** Tiago, em 09/10/2026, sobre o protótipo "Regime e CNAE" (3 versões, com dois ajustes pedidos nos comentários).
**Revê:** a regra do regime do módulo fiscal (entrega 1, 02/10/2026) e a [142](142-modulo-fiscal-pontos-remanescentes.md) §5 ("Lucro Real ou Presumido" numa opção só).
**Completa:** a [150](150-cadastro-de-veiculos.md) (o veículo usa o mesmo formulário do fornecedor) e a [153](153-pp-a-emitir.md) (a PP a emitir e o "Gerar PP").
**Migrations:** `20261009500001_regime_e_cnae_do_fornecedor.sql`, `20261009500002_regime_dos_fornecedores_com_pp_pela_consulta.sql` e `20261009500003_comentarios_da_decisao_166.sql`.
**Número:** nasceu como 165. Antes do push, a varredura dos worktrees achou a 165 em uso pela frente do filtro por coluna nas listas, criada antes; esta passou a 166 (a mais nova move). As migrations 500001 e 500002, já aplicadas, citam "Decisão 165" no cabeçalho e ficam como foram aplicadas; a 500003 corrige o número nos comentários das colunas.

## O que aconteceu

O regime tributário do fornecedor era opcional, com Lucro Real e Lucro
Presumido numa opção só ("Lucro Real ou Presumido", o valor `normal`), e o
cadastro não tinha CNAE. Em 09/10/2026, dos 51 fornecedores pessoa jurídica
ativos, 39 não tinham regime e nenhum tinha CNAE. O Tiago pediu os dois
obrigatórios, Real e Presumido separados, a lista inteira do CNAE com busca,
e a PP travada enquanto o cadastro antigo não for regularizado.

## A regra

1. **Regime tributário obrigatório na pessoa jurídica**, com quatro
   opções: Lucro Real, Lucro Presumido, Simples Nacional e MEI. O legado
   "Lucro Real ou Presumido" (`normal`) não se escolhe mais. Para as
   retenções da aprovação da PP, Real, Presumido e o legado seguem a mesma
   regra (só Simples e MEI não sofrem retenção).
2. **CNAE obrigatório na pessoa jurídica**, um por fornecedor: a lista
   inteira do IBGE (CNAE 2.3, 1.332 subclasses), num campo com busca pelo
   código (com ou sem pontuação) ou pela atividade. Pessoa física não tem
   regime nem CNAE.
3. **A consulta do CNPJ sugere.** A mesma consulta que o cadastro já fazia
   preenche o CNAE principal e põe o principal e os secundários no topo da
   lista. O regime ela só preenche no Simples e no MEI: a Receita não diz se
   é Real ou Presumido, e aí o campo pede a escolha.
4. **Todo cadastro antigo passa por revisão.** O cadastro sem CNAE (todo
   cadastro anterior a 09/10/2026) abre com o regime **vazio na tela** e
   "Antes: …" embaixo, os dois campos marcados em vermelho com "pendente", e
   consulta o CNPJ sozinho ao abrir, para sugerir. O banco guarda o regime
   antigo até alguém salvar: a aprovação das PPs já enviadas lê o regime do
   cadastro.
5. **A PP não é gerada com o cadastro incompleto** (sem regime, com o legado
   ou sem CNAE). Vale para a PP comum e para a verba de alimentação ou de
   transporte paga a um terceiro (decisão 164), que também paga um
   fornecedor (confirmado pelo Tiago em 10/10/2026). No formulário da PP, um aviso vermelho embaixo do
   fornecedor diz o que falta e aponta o lápis; o "Gerar PP" trava. O
   **"Salvar" continua**: a PP a emitir espera o cadastro. O servidor recusa
   a geração (`gerarPPDaPPAEmitir`), e a revisão da PP a emitir mostra a
   frase.
6. **O lápis para quem gera PP.** Administrador e financeiro já tinham o
   lápis, que abre o cadastro inteiro. GP, produtor e freelancer não editam
   fornecedor: com o cadastro incompleto, o lápis aparece para eles e abre o
   **cadastro inteiro, todo editável** — se eles virem outro erro no
   cadastro, corrigem também (Tiago, 10/10/2026; a primeira versão travava
   tudo menos regime e CNAE). O servidor aceita a edição de quem tem o
   cadastro rápido da PP enquanto o cadastro estiver pendente; completo, só
   administrador e financeiro alteram. O aviso das PPs já no financeiro ao
   trocar conta ou PIX (decisão 067) vale igual.
7. **Pendência é vermelha**: o aviso da PP (fundo e texto), o contorno do
   lápis, o ícone do rodapé, a borda dos campos que faltam e as frases
   embaixo deles. O âmbar fica para o que não é pendência ("Alterado
   manualmente").

## A correção imediata das PPs já lançadas

O Tiago pediu que, nos fornecedores com PP já lançada, o regime fosse
corrigido pela consulta do CNPJ na hora — os demais esperam a revisão pela
tela. Os 40 fornecedores PJ com pelo menos uma PP não cancelada foram
consultados em 09/10/2026 (o "Fornecedor Teste", de CNPJ fictício, ficou de
fora). A BrasilAPI estava fora; os 40 vieram do CNPJ.ws, a reserva.

- Os 9 que já tinham regime bateram com a consulta: nada mudou neles.
- Os 31 sem regime receberam o da consulta: 15 Simples, 9 MEI e 7 "nenhum
  dos dois", gravado como o legado `normal` (para a retenção é a regra certa;
  a revisão escolhe Real ou Presumido).
- Resultado: os 41 fornecedores PJ com PP lançada têm regime, e as PPs em
  avaliação no financeiro aprovam com ele.

## Onde a regra mora

| Parte | Arquivo |
| --- | --- |
| Valores do regime e coluna do CNAE | migration `20261009500001`: CHECK `chk_fornecedor_regime` ampliada, `fornecedores.cnae` + CHECK `chk_fornecedor_cnae` (7 dígitos) |
| Regime das PPs já lançadas | migration `20261009500002` (só preenche o vazio) |
| Lista do CNAE | `lib/fiscal/cnaes.ts` (IBGE, 09/10/2026); carregada sob demanda pelo campo |
| Regras puras (pendências, consulta, textos) | `lib/fiscal/regime-do-fornecedor.ts` |
| Obrigatoriedade e CNAE da lista | `lib/validations/fornecedores.ts` (`fornecedorSchema`) |
| CNAE na consulta do CNPJ | `lib/consulta-cnpj.ts` (BrasilAPI `cnae_fiscal`; CNPJ.ws `atividade_principal`) |
| Pendências e quem edita o cadastro pendente | `pendenciasDoCadastroDoFornecedor` e `checarEditarFornecedor` (dentro de `atualizarComSchema`) em `app/(app)/fornecedores/actions.ts` |
| Campo do CNAE | `app/(app)/fornecedores/campo-cnae.tsx` |
| Formulário (revisão e vermelho) | `fornecedor-form.tsx` e `novo-fornecedor-dialog.tsx` |
| Aviso e trava na PP | `gerar-pp-drawer.tsx`; servidor em `gerarPPDaPPAEmitir` (`actions-pp.ts`) |
| Rótulos na aprovação da PP | `lib/fiscal/nf-da-pp.ts` (`textoDoRegime`, `rotuloCurtoDoRegime`) |

## O que ficou de fora

- **A lista de fornecedores** continua com o selo "Dados incompletos" só
  para CEP e pagamento; não há filtro de quem está sem regime ou CNAE.
- **PP já gerada** de fornecedor incompleto segue o caminho normal (envio,
  aprovação, pagamento): a trava é só na geração.
- **CNAE secundário** não se guarda: é um CNAE por fornecedor.
- **BV, conta avulsa, recorrência e desembolso** não são PP e não travam; o
  lápis deles abre o cadastro com os pendentes marcados, para quem edita.

## Como foi testado (09/10/2026)

No sistema (servidor do checkout principal, porta 3000), no job TES-1001/26
do projeto TES-P001/26:

- **Como administrador**: o cadastro do Fornecedor Teste (legado "Lucro Real
  ou Presumido", sem CNAE, CNPJ fictício) abriu com o regime vazio e "Estava
  'Lucro Real ou Presumido'…", os dois campos em vermelho com "pendente", e a
  consulta automática ("CNPJ não encontrado"). A busca do CNAE por "5911" e
  por "filmes para publicidade" achou as subclasses. No formulário da PP, o
  aviso vermelho, o lápis destacado, "Gerar PP" travado e "Salvar" livre: a
  PP a emitir foi salva, e o "Gerar PP" da revisão recusou com a frase do
  servidor. Pelo lápis, o cadastro foi completado (Lucro Presumido,
  5911-1/02) e o formulário voltou ao normal. A PP a emitir de teste foi
  excluída; o Fornecedor Teste ficou completo.
- **Como GP** (usuário "GP Teste Claude", por link mágico autorizado pelo
  Tiago, com o TES-1001/26 passado a ele durante o teste e devolvido no fim):
  num fornecedor real pendente, o aviso apareceu, o lápis surgiu só por causa
  da pendência e abriu o cadastro inteiro com nome, CNPJ, contato e
  pagamento travados (`inert`) e só regime e CNAE livres; a consulta real
  preencheu o CNAE. Cancelado sem salvar (o cadastro não mudou).
- **Pelas actions direto** (sem a tela): `pendenciasDoCadastroDoFornecedor`
  devolveu `[]` no cadastro completo; `completarCadastroFiscalDoFornecedor`
  recusou o cadastro já completo e recusou `normal` e CNAE inexistente.
- "Novo fornecedor" e "Novo veículo" com o texto novo e os dois campos.
- `node --import tsx --test` em `regime-do-fornecedor`, `nf-da-pp` e
  `consulta-cnpj`: 50 testes passam. tsc e lint limpos.

### Revisão de 10/10/2026: o GP edita o cadastro pendente inteiro

O modo "só os pendentes" (campos travados com `inert` e a action
`completarCadastroFiscalDoFornecedor`) saiu. O lápis do GP, do produtor e do
freelancer abre o mesmo formulário do administrador, e a permissão passou
para o servidor: `checarEditarFornecedor` deixa quem tem
`cadastros.fornecedores.inline` salvar enquanto o cadastro estiver pendente
e recusa o completo ("O cadastro deste fornecedor já está completo…",
auditado como `acao_negada`). Testes: 49 (saiu o do esquema próprio).

Conferido em 10/10/2026, logado como "GP Teste Claude" (link mágico
autorizado pelo Tiago; TES-1001/26 passado a ele e devolvido no fim): num
fornecedor real pendente, o lápis abriu o cadastro inteiro, sem campo
travado, com regime e CNAE em vermelho; cancelado sem salvar. Pela action
direta, como GP: no cadastro pendente a permissão passou (o formulário vazio
foi recusado pela validação, nada gravado); no Fornecedor Teste, completo,
veio "O cadastro deste fornecedor já está completo…" e o `acao_negada` ficou
na auditoria.
