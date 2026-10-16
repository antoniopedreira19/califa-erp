# 179 — Regime "Lucro Presumido ou Real" numa opção só no fornecedor, preenchido pela consulta do CNPJ

**Data:** 2026-10-15
**Status:** aceita e implementada (15/10/2026).
**Quem decidiu:** Tiago, em 15/10/2026, sobre o print do "Novo fornecedor"
aberto pelo "+" da PP.
**Revê:** a [166](166-regime-e-cnae-do-fornecedor.md) §1 (Real e Presumido
separados) e §3 (a consulta só preenche Simples e MEI). Volta ao que a
[142](142-modulo-fiscal-pontos-remanescentes.md) §5 tinha: Real e Presumido
numa opção só.
**Migration:** `20261015900001_regime_presumido_ou_real.sql`.

## O que aconteceu

A 166 separou o regime "Lucro Real ou Presumido" em duas opções, Lucro Real
e Lucro Presumido. A Receita não diz qual dos dois a empresa usa: quem
cadastra teria de perguntar a cada fornecedor. E a separação não mudava
nada no sistema, porque Real e Presumido seguem a mesma regra de retenção
na aprovação da PP. O Tiago pediu a volta da opção única.

## A regra

1. **Três opções no regime tributário** do fornecedor e do veículo:
   **Lucro Presumido ou Real**, Simples Nacional e MEI. O valor gravado de
   "Lucro Presumido ou Real" é `normal`, o mesmo que a consulta do CNPJ grava
   em `regime_consulta`. O nome mudou de ordem: era "Lucro Real ou
   Presumido" até a 166.
2. **A consulta do CNPJ preenche o regime nos três casos.** MEI, Simples ou
   "nenhum dos dois", que é Lucro Presumido ou Real. Embaixo do campo:
   "Preenchido pela consulta do CNPJ em … · não optante do Simples". O
   regime só fica para escolher à mão quando a consulta falha: CNPJ não
   encontrado, ou BrasilAPI e CNPJ.ws fora do ar. Trocado à mão, o texto
   âmbar diz o que a consulta indicou, como antes.
3. **"Lucro Presumido ou Real" é regime completo.** O cadastro que o tem não
   trava mais a PP por causa do regime. O CNAE continua obrigatório (166).
4. **Nada muda nas retenções.** Simples e MEI não sofrem; Lucro Presumido
   ou Real sofre PIS, COFINS, CSLL e IRRF, como já era
   (`retencoesPadrao`). Na aprovação da PP, o regime aparece como "Lucro
   Presumido ou Real".
5. **O resto da 166 continua:** regime e CNAE obrigatórios na pessoa
   jurídica, cadastro sem CNAE aberto em revisão com "Antes: …" e a consulta
   automática, PP não gerada com o cadastro incompleto, e o vermelho da
   pendência.

## Os cadastros que já existiam

Em 15/10/2026, antes da migration, os fornecedores pessoa jurídica ativos
eram 61:

| Regime gravado | Quantos | O que mudou |
| --- | --- | --- |
| Lucro Real ou Lucro Presumido (escolhidos depois da 166) | 4 | Passaram a "Lucro Presumido ou Real" (migration; o Tiago confirmou a conversão) |
| "Lucro Real ou Presumido" (`normal`), todos sem CNAE | 6 | O regime deixa de ser pendência; o CNAE continua faltando |
| Simples Nacional | 24 | nada |
| MEI | 18 | nada |
| Sem regime | 9 | nada (a revisão pela tela preenche) |

Os 4 convertidos: BOA MUSICA BRASIL e Mercado Livre (eram Lucro Real), JK
INGRESSOS e o Fornecedor Teste (eram Lucro Presumido). Nos três reais, a
consulta gravada já dizia "nenhum dos dois", que agora bate com o regime.

A CHECK `chk_fornecedor_regime` volta a aceitar só `normal`, `simples` e
`mei`. O histórico de auditoria guarda os valores antigos e fica como está.

## Onde a regra mora

| Parte | Arquivo |
| --- | --- |
| Valores e rótulos do regime, consulta, textos embaixo do campo | `lib/fiscal/regime-do-fornecedor.ts` (`REGIMES_DO_FORNECEDOR`, `ROTULO_DO_REGIME`, `regimeDepoisDaConsulta`, `origemDoRegime`, `pendenciasDoCadastroFiscal`) |
| O que o servidor aceita | `lib/validations/fornecedores.ts` (`fornecedorSchema`) |
| Tipo | `lib/types.ts` (`RegimeTributarioFornecedor`) e `lib/fiscal/calculos.ts` (`RegimeDoFornecedor`) |
| Texto na aprovação da PP | `lib/fiscal/nf-da-pp.ts` (`textoDoRegime`, `rotuloCurtoDoRegime`) |
| Formulário (página, "+" da PP e veículo) | `app/(app)/fornecedores/fornecedor-form.tsx` |

## Como foi testado (15/10/2026)

- `node --import tsx --test` em `regime-do-fornecedor`, `nf-da-pp`,
  `consulta-cnpj` e `fiscal`: 55 testes passam. `tsc` e `lint` limpos.
- No sistema, logado como administrador, no servidor do worktree:
  - "Novo fornecedor": a lista do regime mostra as três opções. Com o CNPJ
    da Petrobras (não optante do Simples, sem cadastro), a consulta
    preencheu "Lucro Presumido ou Real" e o texto "Preenchido pela consulta
    do CNPJ em 15/10/2026 · não optante do Simples". Cancelado sem salvar.
  - MAP BRASIL (cadastro antigo, "Lucro Real ou Presumido", sem CNAE): abriu
    em revisão, a consulta automática preencheu "Lucro Presumido ou Real" e
    o CNAE, e o rodapé disse "Tudo preenchido". Cancelado sem salvar.
  - Depois da migration: os 4 cadastros como `normal`, a CHECK com os três
    valores e o comentário da coluna conferidos pelo MCP (10 PJ ativos com
    Lucro Presumido ou Real, 24 Simples, 18 MEI, 9 sem regime). O JK
    INGRESSOS (era Lucro Presumido) abriu com "Lucro Presumido ou Real" e
    "Preenchido pela consulta do CNPJ em 14/10/2026 · não optante do
    Simples".
