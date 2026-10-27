# 210 — O código do projeto perde a sigla do cliente: P-NNNN/AA na produção, F-NNNN/AA no financeiro

**Data:** 2026-10-23
**Decidido por:** Tiago
**Status:** aceita e aplicada em 26/10/2026, ~17h10, na hora combinada com
a frente do Antonio; código publicado logo em seguida (`d413ac31`).
**Revista por:** a [217](217-codigo-do-projeto-fora-das-telas.md) (27/10/2026): o
código continua gerado como aqui, mas não aparece mais nas telas.
**Migration:** ⚠️ destrutiva — `20261023950001_codigo_do_projeto_sem_sigla.sql`
(sobrescreve `projetos.codigo`, `orcamentos.codigo`,
`projetos_financeiro.codigo` e `jobs_aberturas.projeto_financeiro_rotulo`;
troca a assinatura de `trocar_cliente_do_projeto`).

---

## 1. O problema

Desde a decisão 114 o projeto leva a sigla do cliente (`AMB-P004/26` na
produção, `AMB-F004/26` no financeiro). Em 23/10/2026 o Tiago pediu que
Cliente e Marca passem do projeto para o orçamento (redesenho em validação,
fora desta decisão) e decidiu que o código do projeto não precisa da sigla:
serve só ao controle do sistema. Quem lê a sigla é o código do job
(`AMB-1006/26`), que não muda.

## 2. A regra

1. **Formato:** produção `P-NNNN/AA` (ex.: `P-0001/26`); financeiro
   `F-NNNN/AA` (ex.: `F-0001/26`). Sem sigla.
2. **Orçamento** acompanha o projeto: `P-0001/26-01`.
3. **Quatro dígitos:** foram 94 projetos em 30 dias. Passando de 9999 o
   número cresce, não corta.
4. **Sequencial por letra e ano:** o maior número já usado + 1. A produção
   e o financeiro seguem cadastros e numerações separados, como antes; a
   letra separa os dois.
5. **Ano = o da criação do projeto**, no fuso de São Paulo. Até aqui era o
   da data de início (produção) ou do início do job (financeiro), que se
   editam depois.
6. **Número nunca volta:** o gerador lê, além dos projetos de hoje, o
   registro de códigos usados — `codigos_de_projeto_usados` na produção
   (decisão 122) e `codigos_de_projeto_financeiro_usados` no financeiro
   (novo: o projeto do financeiro sem job é apagado, decisão 119).
7. **`PRJ-`/`FIN-` descartados:** existe cliente com a sigla FIN.
8. **Código de job não muda** (`SIGLA-1NNN/AA`, decisão 114).

## 3. A troca dos atuais

Pela ordem de criação (`created_at`, desempate pelo código), dentro da
letra e do ano. Ensaio de 23/10/2026 (SELECT com o de-para da migration):

- **104 projetos** → `P-0001/26` … `P-0104/26`, 104 códigos distintos.
  `HIT-P001/26` → `P-0001/26`; `AMB-P004/26` → `P-0002/26`; o projeto de
  teste `TES-P001/26` → **`P-0006/26`**; `AMB-P017/26` → `P-0033/26`;
  `AMB-P044/26` → `P-0104/26`.
- **179 orçamentos** trocam só o prefixo e mantêm o `-NN`
  (`AMB-P004/26-03` → `P-0002/26-03`).
- **73 projetos do financeiro** → `F-0001/26` … `F-0073/26`
  (`AMB-F004/26` → `F-0001/26`; `AMB-F034/26` → `F-0073/26`).
- **141 de 143 rótulos** da foto da abertura ("CÓDIGO · nome") trocam o
  código. Os 2 restantes são de projetos do financeiro já apagados: não há
  código novo para eles, e ficam com o antigo.
- **Registro de orçamentos usados:** os 220 códigos de projetos que existem
  ganham a versão com o prefixo novo, para o número de orçamento excluído
  continuar sem voltar (decisão 148). O código de antes fica no registro.
- **`updated_at` fica como está:** a troca é do sistema, não edição de
  ninguém.

Cada troca grava um evento `projeto.codigo_trocado`,
`orcamento.codigo_trocado` ou `projeto_financeiro.codigo_trocado` com
`decisao = '210'` e o código de antes: o de-para inteiro fica na auditoria.
A auditoria antiga, os PDFs e as planilhas já emitidos ficam com o código
da época. As planilhas exportadas voltam pelo Importar como antes: ele acha
os orçamentos pelos ids escondidos, não pelo código.

Fica de fora: o **nome** de dois projetos é o código antigo de outro
(cópias: um se chama "AMB-P040/26", outro "GOO-P004/26"). Nome é texto de
quem cadastrou e não muda.

## 4. O que muda no sistema

- `lib/codigos/projetos.ts`: `gerarCodigoProjeto(supabase, tenantId)` e
  `gerarCodigoDaLetra` (lê projetos + registro por letra e ano),
  `proximoCodigoDeProjeto({ letra, ano, codigosUsados })` e
  `anoDoCodigoDeProjeto`. Saiu a contagem de projetos do cliente, que só
  fazia sentido com a sigla. Testes em `lib/codigos/projetos.test.ts`.
- `lib/codigos/projetos-financeiro.ts`: `gerarCodigoProjetoFinanceiro(supabase, tenantId)`.
- O gerador não exige mais código curto do cliente: a sigla só é exigida
  onde é usada, no código do job (o envio já recusa cliente sem sigla).
- **Troca de cliente (decisão 122):** não mexe mais em código. Saiu a busca
  do "código que o projeto já teve", o aviso "Ao salvar, o projeto ganha um
  código novo com a sigla…" no formulário, e os eventos de troca de código
  que ela gravava. `trocar_cliente_do_projeto` perde o parâmetro do código
  (a versão de 4 argumentos sai do banco: chamada pelo código de antes, ela
  devolveria o projeto ao formato com sigla).
- `/orcamentos/novo`: o subtítulo diz `P-NNNN/AA` (dizia `CLI-NNNN/AA`,
  desatualizado desde a 114).
- Ordenações por `codigo` (lista de projetos do financeiro, faixa do
  projeto) passam a dar a ordem de criação dentro do ano, em vez de agrupar
  por cliente.

## 5. Como publicar

O código novo grava o formato novo, e o antigo, rodando depois da
migration, criaria projeto com sigla e chamaria a RPC de 4 argumentos, que
não existe mais. Então, numa hora sem uso e combinada com o Antonio:

1. olhar `audit_events` das últimas horas (projeto, orçamento ou projeto do
   financeiro sendo criado);
2. aplicar a migration pelo MCP e conferir no banco (formatos, contagens,
   rótulos, registros, eventos);
3. publicar o código no `main` logo em seguida (cherry-pick sobre o
   `origin/main`);
4. conferir se algum projeto ou projeto do financeiro foi criado no formato
   antigo no intervalo e, se houver, trocá-lo pela mesma regra;
5. conferir no navegador: lista e página do projeto, criação de projeto e
   orçamento no `P-0006/26 · Teste`, campo Projeto da abertura, página do
   projeto do financeiro.

## 6. Aplicada em 26/10/2026

Antes de aplicar, o estado foi relido: nenhuma migration desde 23/10 tocou
projeto, orçamento, abertura ou os registros de códigos; gatilhos e
`trocar_cliente_do_projeto` iguais aos do ensaio; nenhum projeto ou
orçamento sendo criado na auditoria (havia PPs sendo geradas). Os números
cresceram desde o ensaio de 23/10 e a troca usou os do dia:

- **107 projetos** → `P-0001/26` … `P-0107/26` (os 3 criados depois do
  ensaio são `P-0105` a `P-0107`);
- **185 orçamentos** com o prefixo novo;
- **80 projetos do financeiro** → `F-0001/26` … `F-0080/26`;
- **152 de 154 rótulos** da abertura (os 2 de projeto apagado ficam);
- **226 códigos** de orçamento usados ganharam a versão com o prefixo novo;
- **372 eventos** `*.codigo_trocado` com `decisao = '210'` (107 + 185 + 80).

Conferido no banco depois: nada fora do formato novo, todo orçamento com o
prefixo do projeto, `updated_at` intocado e os gatilhos religados,
`codigos_de_projeto_financeiro_usados` com RLS, leitura para
`authenticated` e nada para `anon`, e só a versão de 3 argumentos da RPC.

Fica de fora: uma solicitação de freelancer importada do sistema antigo
(módulo do Antonio) cita um código antigo de projeto no nome do job, que é
texto livre copiado. Não é trocada.
