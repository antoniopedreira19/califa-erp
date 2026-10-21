# 198 — A importação do extrato do banco em OFX

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 3, entrega 3A).
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seção
4.4 da especificação), e nos pontos M3.3, M3.6 e M3.8 de 21/10/2026 (opção A
nos três).
**Migrations:** `20261021700001_extrato_importado.sql` e
`20261021700002_vw_extrato_linhas.sql`.

## O problema

A conciliação só tinha o lado do sistema: o Extrato da conta era a lista dos
lançamentos, e conferir com o banco era abrir o internet banking ao lado e
bater linha a linha. Nada guardava o que o banco disse.

## A regra

1. **A aba nova "Conciliação automática"**, a terceira da conta, ao lado de
   Extrato e Títulos (`&aba=banco`). Ela importa o extrato do banco e mostra
   cada linha com o que o sistema tem para ela (decisão 199).
2. **Arquivos aceitos:** OFX SGML 1.0x e XML 2.x. O valor com vírgula
   ("-1920,00", o do Santander) e o com ponto valem; com os dois
   separadores, o último é o decimal. O arquivo é lido em windows-1252, a
   não ser que o cabeçalho diga UTF-8 (`lib/conciliacao/ofx.ts`).
3. **A conta vem do arquivo e não se troca.** O arquivo só entra na conta
   aberta no topo, e é dela quando o ACCTID tem os dígitos da agência mais
   os da conta (com o dígito), ou termina no número da conta com o dígito
   (`arquivoEhDaConta`; a RPC confere a mesma regra). O código do banco
   (BANKID) também tem de bater com o banco do cadastro; código que a tabela
   não conhece passa, e quem decide é a conta.
   - O arquivo de **outra conta cadastrada** é recusado com o link "Abrir a
     conciliação da …".
   - O de **conta nenhuma**, ou a conta aberta **sem agência e número** no
     cadastro, é recusado com o caminho para Cadastros do Financeiro ›
     Contas bancárias. Das contas reais, hoje só a California Santander tem
     os dois.
4. **Reimportar não duplica.** O FITID do Santander muda a cada download
   (carrega a hora da exportação), então a linha se reconhece pela
   **impressão digital**: conta | data | valor em centavos | histórico
   normalizado (sem acento, maiúsculas, espaços juntados) | posição entre os
   iguais. Linhas idênticas no mesmo dia continuam separadas pela posição.
   `unique (tenant_id, conta_bancaria_id, digital)` garante no banco.
5. **O arquivo é lido no navegador e só as linhas sobem.** O limite do corpo
   da Server Action (1 MB) aceita um mês inteiro de linhas, que o arquivo
   cru talvez não coubesse. O servidor confere tudo de novo, porque o que
   vem do navegador não é confiável: o formato (zod), o banco, a conta e a
   impressão digital, que é calculada no servidor. O arquivo cru não fica
   guardado em lugar nenhum. Até 5.000 movimentos por arquivo e 5 MB de
   arquivo.
6. **O cabeçalho do arquivo**: "Conta do extrato · nome · banco · agência /
   conta · reconhecida pelo arquivo (banco N, conta ••••NNNN)"; embaixo, o
   nome do arquivo, o banco, a conta, o período, "N movimentos · N novos ·
   N já importados" e o saldo que o banco informa (LEDGERBAL). Sem nada novo,
   o aviso "Nada novo neste arquivo", com o porquê do FITID.
7. **Os quadros**: Saldo no banco (data), Saldo do sistema (fim do último dia
   do extrato), Diferença ("Bate ✓" ou o valor) e Conciliados (N de M, com
   barra). Os quadros e o cabeçalho são da última importação da conta.
8. **Dia em andamento**: o arquivo gerado (DTSERVER, no fuso do arquivo; sem
   fuso, Brasília) no mesmo dia do último movimento ainda não tem o dia
   inteiro. Aparece a nota "dd/mm ainda está em andamento…", e esse dia não
   conta como coberto pelo extrato (decisão 199, "sem linha no banco").
9. **Quem importa**: admin e financeiro, como na conciliação. As tabelas só
   têm leitura para `authenticated`, pela RLS do papel; tudo que grava passa
   por RPC `SECURITY DEFINER` que confere o papel
   (`_exige_financeiro_conciliacao`). A importação fica na auditoria
   (`extrato.importado`, com a conta, o arquivo, o período, os movimentos e
   os novos).

## O que ficou diferente do protótipo

- **O texto da área do arquivo.** O protótipo dizia "Ele é lido aqui na
  tela: nada é gravado até você conciliar". No sistema a importação grava as
  linhas do banco (é o que permite reimportar sem repetir e conciliar
  depois), então o texto diz: "O sistema guarda só as linhas do extrato, sem
  repetir as que já vieram; nada muda nos títulos até você conciliar."
- **"Importar o 2º arquivo" e "Usar o extrato de exemplo"** eram só do
  protótipo e não entraram.

## Como ficou no banco

- `extrato_importacoes`: um registro por arquivo, com o período, o DTSERVER,
  o saldo do banco, quantos movimentos e quantos novos.
- `extrato_linhas`: uma por movimento, sem repetir, com a importação que a
  trouxe primeiro e as colunas da solução (ignorada, resolvida sozinha,
  avaliada pela automação, `sem_auto`), que as entregas 3B e 3C usam.
- `vw_extrato_linhas` (`security_invoker`): a linha com `conciliada` — ter
  lançamento ligado (decisão 199). A aba lê numa consulta só as pendentes de
  qualquer data e as resolvidas do período aberto.
- `importar_extrato(p_conta_bancaria_id, p_arquivo)`: confere o papel, a
  conta (não é cartão, está ativa, tem número, o arquivo é dela), grava a
  importação e as linhas novas (`on conflict do nothing`) e audita.

## Como foi conferido

- No banco, numa transação desfeita no fim: a primeira importação gravou 2
  linhas novas, a segunda 0; o arquivo de outra conta e a conta sem número
  foram recusados; o GP foi recusado e não viu linha nenhuma.
- No navegador, na Conta Teste (agência e número fictícios cadastrados pela
  tela de Contas bancárias), com um OFX montado: o de conta nenhuma recusado,
  o da conta "Teste" recusado com o link para a conciliação dela, o da Conta
  Teste com 10 movimentos e 10 novos; a mesma importação de novo com 0 novos
  e o aviso. No banco: 2 importações, 10 linhas, 2 eventos de auditoria, o
  DTSERVER às 08:00 de Brasília.
- Testes: `lib/conciliacao/ofx.test.ts` (o exemplo do Santander, a segunda
  importação, linhas iguais, a conta da digital, o valor, o XML sem
  DTSERVER, o histórico normalizado, o banco e a conta do arquivo).

## Pendências

1. **Linha importada não se apaga.** Não há tela para desfazer uma
   importação; a linha errada se resolve com "Ignorar" (entrega 3B).
2. **Agência e número no cadastro.** Das contas reais, só a California
   Santander os tem; as outras precisam ser completadas para importar.
