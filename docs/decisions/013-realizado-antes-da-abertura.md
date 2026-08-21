# 013 — Planilha do job visível e realizado editável antes da abertura

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** aba "Planilha Interna" do detalhe do job (`/jobs/[jobId]`),
nos status `aguardando_abertura` e `rejeitado_financeiro`. Regra definida
pelo Tiago.

## Decisão

Nos dois status de **pré-abertura** — `aguardando_abertura` (enviado ao
financeiro, ainda não aberto) e `rejeitado_financeiro` (devolvido) — a
planilha do job aparece **inteira** (orçado × planejado × realizado, com
totais) e o bloco **Realizado é editável** por quem já podia editá-lo
(administrador ou responsável do job).

O que continua esperando a abertura pelo financeiro:

| Capacidade | Pré-abertura | Aberto / Em produção |
|---|---|---|
| Ver a planilha completa | ✅ | ✅ |
| Lançar/editar realizado | ✅ | ✅ |
| Errata ("Alterar orçado") | ❌ | ✅ |
| Adicionar/alterar BV | ❌ | ✅ |
| Gerar PP | ❌ | ✅ |

A aba "Pedidos de Produção (PPs)" segue o flag restrito: sem ações antes
da abertura.

## Por quê

A produção começa a gastar antes de o financeiro abrir o job. Até aqui a
aba mostrava só o bloco "Realizado indisponível", então o custo já
incorrido era anotado fora do sistema e transcrito depois — com o atraso
e o erro de digitação que isso implica.

O que a abertura protege não é o **registro** do que aconteceu, é o que
tem consequência financeira: errata mexe no orçado que o financeiro
acabou de conferir, e BV e PP são compromisso de pagamento num job que
ainda pode ser devolvido. Por isso a linha foi traçada entre "lançar
realizado" e "gerar documento", e não entre "ver" e "não ver".

`rejeitado_financeiro` segue a mesma regra de `aguardando_abertura`: o
job voltou para a produção corrigir, e é justamente aí que ela precisa da
planilha.

## Onde a regra mora

Duas funções em `lib/types.ts`, lidas pela tela **e** pelas server
actions — é o que impede as duas leituras de divergirem:

- `jobAceitaRealizado(status)` → `aberto`, `em_producao`,
  `aguardando_abertura`, `rejeitado_financeiro`.
- `jobAceitaAcoesPlanilha(status)` → `aberto`, `em_producao`.

Consumidores:

| Onde | Usa |
|---|---|
| `app/(app)/jobs/[jobId]/page.tsx` | as duas — gera `podeEditarRealizado` e `podeAcoesPlanilha` |
| `app/(app)/jobs/[jobId]/actions-realizado.ts` | `jobAceitaRealizado` |
| `app/(app)/jobs/[jobId]/realizado/actions-errata.ts` | `jobAceitaAcoesPlanilha` |
| `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` | `jobAceitaAcoesPlanilha` (emitir e cancelar) |
| `app/(app)/_bv/actions.ts` | `jobAceitaAcoesPlanilha` |

O gate do BV **não existia**: a interface escondia o botão antes da
abertura e ninguém tinha escrito a trava no servidor. Com a planilha
visível ela virou obrigatória, e entrou em `carregarContexto`, que é por
onde as três ações de BV passam.

## O que ficou de fora, de propósito

- **Permissão não mudou.** Continua administrador ou responsável do job;
  a pré-abertura não abre o realizado para mais gente.
- **BV já lançado continua consultável** na pré-abertura, em modo
  somente-leitura — mesmo tratamento que o job encerrado recebe. O que a
  abertura libera é lançar e alterar.
- **Job encerrado e cancelado seguem congelados** para tudo, inclusive
  realizado (`jobEstaCongelado`).
- Nenhuma migration: a regra é de status e permissão, não de estrutura.

---

## ⚠️ Nota de 2026-08-18 — a trilha de BV não estava sumindo

Esta decisão separa o que a pré-abertura libera (o **realizado**) do que
ela não libera (errata, BV e PP). A verificação no navegador achou uma
sobra: num job pré-abertura com um BV lançado antes, a pílula "Abrir BV"
continuava na calha e o popup abria editável — porque a exceção que
mantém BVs consultáveis foi escrita para o job **encerrado**, e a
pré-abertura herdou a mesma condição (`podeAcoes` falso nos dois casos).

Sem risco de dado: a action já recusava. Corrigido com um `preAbertura`
explícito, que distingue os dois casos, e com o `BvDialog` passando a
usar `readOnly={!podeAcoes}` em vez de `!editable` — o `editable` é o
flag do realizado, que na pré-abertura é verdadeiro. Ver entrega 36 do
`HANDOFF_JOBS.md`.


---

## ⚠️ Nota de 2026-08-21 — o realizado deixou de ser lançado

Esta decisão liberou **lançar realizado** na pré-abertura, e a linha que
ela traça ("registrar o que aconteceu" × "gerar documento") continua
valendo para errata, BV e PP. O que mudou é o outro lado: **não existe
mais lançamento de realizado.**

O realizado passou a ser derivado — soma das PPs do item, ou o próprio
orçado em `A` e `D` — e `upsertItemRealizado` foi removida. Na prática a
linha "Lançar/editar realizado ✅" da tabela acima virou letra morta: na
pré-abertura não há PP a emitir, então o realizado fica em zero até a
abertura (nos tipos que geram PP) ou já mostra o orçado (em `A` e `D`).

`jobAceitaRealizado` continua existindo e continua sendo o gate de quem
pode ver o quê; ela só não guarda mais nenhuma escrita.

Ver `022-bv-liquido-e-realizado-por-pp.md`.
