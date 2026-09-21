# 00 — Descoberta

Retrato do estado inicial do módulo em 2026-09-21. Este documento é imutável depois de fechado; correções entram como notas na fase de decisões.

## 1. O problema

Hoje o financeiro paga fornecedor, colaborador e conta avulsa **um a um**, dentro do internet banking do Santander. Cada baixa exige digitar (ou copiar/colar) dados bancários, valor, data. Erro de digitação vira retrabalho, dinheiro no lugar errado ou pagamento em duplicidade.

O Santander tem um mecanismo já pronto pra isso: **arquivo de remessa CNAB 240**. A empresa gera um arquivo `.REM` com todos os pagamentos do lote, importa uma vez no banco, paga tudo de uma vez, e recebe um arquivo `.RET` de volta com o status de cada pagamento.

Este módulo materializa isso no ERP.

## 2. O que o Santander exige (leitura do manual CNAB 240 v11.7, junho/2026)

Referência: *Cash Management — Pagamento a Fornecedores — Manual de Troca de Arquivos — Layout CNAB 240 Posições — YLEC_2403 V.11.7 — Junho/2026*.

### 2.1 Estrutura do arquivo

Texto puro, **240 bytes por linha**, sem separador nenhum. Cada campo tem posição inicial e final rígidas; alfanumérico à esquerda com espaço à direita, numérico à direita com zero à esquerda. Um byte fora do lugar em qualquer linha invalida o arquivo inteiro.

```
Header de Arquivo (tipo 0)                       ← 1×
  Header de Lote (tipo 1)                        ← 1 lote POR forma de pagamento
    Detalhes (tipo 3, segmentos A/B/C/J/J52/N/O) ← n
    Trailer de Lote (tipo 5)                     ← soma valores + qtd registros
Trailer de Arquivo (tipo 9)                      ← soma lotes + qtd registros totais
```

Regra dura: **um lote = uma forma de pagamento**. Pagar 3 boletos + 2 PIX + 1 TED no mesmo arquivo obriga 3 lotes.

### 2.2 Formas de pagamento relevantes ao ERP

Do menu de códigos (Nota G002 do manual), estes casam com casos de uso reais da agência:

| Código | Descrição | Segmentos exigidos | Complexidade |
|---|---|---|---|
| **30** | Boleto Santander | J + J52 | Baixa (só código de barras + CNPJ do beneficiário) |
| **31** | Boleto outros bancos | J + J52 | Baixa |
| **45** | PIX por chave ou dados bancários | A + B | Média |
| **47** | PIX por QR Code (estático ou dinâmico) | J + J52-PIX | Média-alta (exige Payload Location) |
| **03** | TED | A + B | Média (exige finalidade + endereço do favorecido) |
| **01** | Crédito em conta corrente Santander | A + B opcional | Baixa |
| **11** | Tributo/concessionária com código de barras | O | Baixa (DARF, FGTS, guias) |

Fora de escopo permanente pro caso da agência: OCT (Segmento I, forma 35), IPVA/DPVAT/Licenciamento (Segmento N, formas 25/26/27), captura DDA (Segmento G, arquivo retorno only).

### 2.3 Restrições não-óbvias que caem no banco depois

Anotadas aqui porque o manual as menciona no meio do texto e é fácil esquecer:

- **Boleto exige CNPJ do beneficiário no Segmento J52** (pág. 21 e 23 do manual). Se faltar, retorno vem com código `AT`. Fornecedor sem CNPJ preenchido **não pode ser pago por boleto via CNAB**.
- **Código de barras vem embaralhado na linha digitável.** A linha digitável tem 47 dígitos, o código de barras tem 44 — os 3 DVs de campo (posições 10, 21, 32) são descartados na conversão (Nota G008, pág. 42).
- **Empresa pagadora precisa do código de convênio.** Não é agência+conta comum — é um número (20 posições alfanuméricas) contratado com o gerente Santander pra habilitar o serviço "Pagamento a Fornecedores".
- **Sequenciais 1 a 10 são tratados como teste** se o cliente contratou "sequencial para teste" (Nota G010). Contador começa em 11 pra produção.
- **Data em dia não útil vira o próximo dia útil**, automaticamente pelo banco (Nota 2.7). PIX é exceção — banco processa em dia não útil.
- **CNAB é ASCII/ANSI, não UTF-8.** Nome com acento precisa ser sanitizado antes de gravar. A regra transversal do CLAUDE.md ("pt-BR completo em UI") permanece — a sanitização é responsabilidade do gerador, não do banco de dados.
- **Cada CNPJ tem seu convênio.** California Filmes, Go Crazy e Hitlab são três empresas contábeis distintas. Três convênios, três sequenciais independentes, três arquivos separados por rodada de pagamento.
- **Horário de corte importa**. TED e boletos acima do "Valor de Referência" têm horário limite específico do banco. PIX em dia útil aceita agendamento até 23:10 pra clientes sem float; em dia não útil até 19:20 (Nota 2.1). QR Code respeita vencimento do próprio QR.

### 2.4 Retorno

O arquivo `.RET` que o Santander devolve tem os mesmos segmentos do `.REM`, mas com o campo "Ocorrências para o Retorno" preenchido (posições 231–240 de cada linha, seção 5 do manual). Códigos importantes:

- `00` — Crédito ou Débito Efetivado → dá baixa automática do título
- `01` — Insuficiência de Fundos → título fica pendente, notifica financeiro
- `02` — Cancelado pelo Pagador → título volta a "aguardando"
- `AT` — CNPJ do beneficiário divergente → cadastro precisa ser corrigido
- `HF` — trava de limite diário excedida
- `ZI` / `ZY` — beneficiário divergente ou histórico de crédito inválido

Lista completa nas páginas 61–64 do manual.

## 3. Estado atual do banco (levantado via MCP em 2026-09-21)

Consultas rodadas contra o projeto Supabase `avlwxyknvhlzvnysbzrg`.

### 3.1 Cadastros pagáveis (destinatários)

| Entidade | Registros ativos | Dados bancários hoje | Gap CNAB |
|---|---|---|---|
| `fornecedores` | 24 | **Sim** — `banco_codigo`, `banco_nome`, `agencia`, `agencia_dv`, `conta`, `conta_dv`, `tipo_conta`, `pix_tipo`, `pix_chave` + endereço completo. 11/24 com banco, 17/24 com PIX. | Nenhum — cadastro pronto. |
| `colaboradores` | 1 (CLT) | **Não** — nem banco, nem PIX. | Migration aditiva pendente (fase 1 do módulo). |
| `clientes` | 156 | **Não** — só CNPJ, email, telefone. | Migration aditiva pendente **se** cliente entrar no MVP. |

Observação sobre colaboradores: a coluna `fornecedor_id` (link opcional pra fornecedor que reaproveitava dados bancários) foi **removida em 2026-09-21** — ver ADR 001 em `02-decisoes.md`.

### 3.2 Empresa pagadora (a que assina o débito no header do arquivo)

Três `empresas_contabeis` cadastradas:

| Nome | CNPJ | Contas Santander em `contas_bancarias` |
|---|---|---|
| CALIFÓRNIA FILMES E PUBLICIDADE LTDA | 19437976000154 | 1 (agência/conta vazios) |
| GO CRAZY CONSULTORIA E MARKETING LTDA | 29943648000183 | 1 (agência/conta vazios) |
| HITLAB PRODUÇÃO MUSICAL LTDA | 04409741000181 | 1 (agência/conta vazios) |

**Gap crítico**: as 12 contas bancárias hoje têm `agencia` e `numero_conta` **null**. São placeholders semânticos usados no rateio de lançamentos, não têm dado operacional. Precisam ser preenchidas — e ganhar `agencia_dv`, `numero_conta_dv`, código do convênio Santander, sequencial de arquivo — antes do primeiro `.REM`.

### 3.3 Origens de "a pagar" (o que vira linha no arquivo)

A view `vw_a_pagar` já unifica quatro origens:

1. **`pedidos_compra_parcelas`** — parcela de PP com `status='aprovada'`, `pago_em is null`. Tem `fornecedor_id` e — sacada importante — **congela os dados bancários do fornecedor na aprovação** (`fornecedor_banco_codigo`, `fornecedor_agencia`, `fornecedor_pix_chave`, `dados_pagamento_congelados_em`). Isso é ouro pro CNAB: pagamento fica imune a mudança do cadastro depois.
2. **`contas_avulsas`** com `status='aprovada'` e `pago_em is null` — pode ter `fornecedor_id`, `cliente_id`, `colaborador_id` (adicionado em 21/09/2026) e `folha_id`.
3. **`desembolsos_parcelas`** — parcela com desembolso `status='aprovada'` ou `'pago'`. Pode ter `fornecedor_id` ou `cliente_id`.
4. **`pp_verba_devolucoes`** — natureza=entrada. Fica **fora** do CNAB de pagamento (é dinheiro voltando pro caixa).

### 3.4 Fluxo folha → contas a pagar (achado em 21/09/2026, pós-descoberta inicial)

Existe motor pronto e testado que materializa folha aprovada em `contas_avulsas`. Documentado aqui como correção do retrato inicial, que subestimou esse fluxo:

- RH cria linha em `folhas_pagamento` com colaborador + salário + alocação (percentual por empresa/regional).
- RH envia → `status='enviada'`.
- Financeiro revisa em `/financeiro/contas-a-pagar` (tab "Folhas de Pagamento") — vê valor sugerido, pode editar o valor e as alocações antes de aprovar.
- Aprovação chama a server action [`aprovarLinhaFolha`](../../../app/(app)/financeiro/contas-a-pagar/actions-folhas.ts) que:
  1. Aplica edições (se houve).
  2. Cria **N `contas_avulsas`** (uma por alocação, valor rateado pelo percentual), com `status='aprovada'`, `folha_id` preenchido, `colaborador_id` preenchido (novo campo — antes era `fornecedor_id = colab.fornecedor_id` via ADR 001, removido em 21/09).
  3. Propaga edições pra Camada 1 (histórico salarial + alocação vigente) se houve mudança.
  4. Marca a linha da folha como `aprovada`.
- Idempotência garantida: se já existem `contas_avulsas` pra essa folha, a rotina recusa reaprovar sem estorno.

Consequência pro módulo: colaborador **NÃO precisa de "conta avulsa manual"** pra entrar no CNAB. O motor de folha já entrega prontinho no `vw_a_pagar` — o gerador CNAB só precisa saber ler `colaborador_id` além de `fornecedor_id`.

### 3.5 Volumes reais

Volumes hoje: 0 títulos em aberto. Sistema ainda em fase inicial; volumetria real vai aparecer em produção.

### 3.4 Enums que já cobrem o que o CNAB pede

- `forma_pagamento`: `pix | transferencia | boleto | cartao_credito` — mapeia direto para os códigos 45/03/30/–.
- `tipo_conta_bancaria`: `corrente | poupanca | pagamento` — bate 1:1 com os códigos G013 B / G032 do manual.
- `pix_tipo_chave`: `cpf | cnpj | email | telefone | aleatoria` — bate 1:1 com Nota G032.

Nenhum enum precisa ser criado.

## 4. Gap consolidado

O que falta pro primeiro arquivo `.REM` sair:

**Blocker 1 — Empresa pagadora sem convênio nem dados operacionais.** `contas_bancarias` tem os 3 placeholders Santander, mas com `agencia`/`numero_conta` nulos, sem DV, sem convênio, sem sequencial. Fase 1 resolve.

**Blocker 2 — Colaborador sem shape bancário.** Precisa ganhar `banco_codigo`, `agencia`, `conta`, etc, mesmo shape que fornecedor já tem. Fase 1 resolve.

**Blocker 3 — ~~`contas_avulsas` não sabe pra quem depositar quando a origem é folha~~ RESOLVIDO em 21/09/2026 (hotfix ADR 002).** Coluna `contas_avulsas.colaborador_id` adicionada, `vw_a_pagar` recriada expondo a coluna, `aprovarLinhaFolha` corrigida pra gravar `colaborador_id = colab.id` (antes era `fornecedor_id = colab.fornecedor_id` — que sumiu no ADR 001).

**Blocker 4 — Boleto/tributo sem código de barras no modelo.** `pedidos_compra` e `contas_avulsas` não têm `codigo_barras` (44 dígitos) nem `linha_digitavel`. Precisa migration aditiva. Fase 2 resolve.

**Blocker 5 — Nada rastreia arquivos gerados.** Precisa tabela `cnab_remessas` (metadados do arquivo — sequencial, quem gerou, hash, path do storage) + `cnab_remessas_itens` (n linhas, uma por título incluído, com "nosso número" atribuído pelo gerador e "ocorrência" de retorno). Fase 2 resolve. Sem isso, não há como amarrar "esse título foi pago via esse arquivo".

**Blocker 6 — Cliente como destinatário fica fora do MVP.** Decisão pendente. Se entrar, precisa migration aditiva de banco/PIX em `clientes`. Fica na fila da fase 2 ou 3.

**Blocker 7 — Homologação Santander.** Antes de qualquer produção, precisa contratar o convênio "Pagamento a Fornecedores" nas três empresas contábeis e trocar arquivos de teste com o gerente Santander. É trabalho externo, não técnico — mas precisa começar em paralelo à fase 1 porque leva tempo.

## 5. O que fica fora deste módulo, permanentemente

Documentado pra não voltar depois com "e se a gente adicionasse isso":

- **Pagamento de IPVA/DPVAT/Licenciamento por RENAVAM** (Segmento N, formas 25/26/27). Não é caso da agência.
- **OCT — Ordem de Crédito por Teleprocessamento** (Segmento I, forma 35). Padrão exclusivo Santander pra tipos específicos de pagamento; não é caso da agência.
- **Captura de títulos DDA** (Segmento G, arquivo retorno). É serviço de cobrança, não de pagamento — nem passa perto de contas a pagar.
- **Multi-banco** (Bradesco, BB, Itaú). Layout CNAB 240 é padrão FEBRABAN, mas cada banco tem particularidades. Começa Santander; outros bancos entram como fase futura se houver demanda.

## 6. Referências

- Manual Santander: PDF `pagamento-fornecedores-layout-CNAB-240 (1).pdf` na raiz do repositório (não commitado — só arquivo local do Antonio).
- Migração original que criou o gap resolvido em 2026-09-21: [`20260916000005_rh_colaboradores.sql`](../../../supabase/migrations/20260916000005_rh_colaboradores.sql).
- Migração que resolveu o gap: [`20260921100001_colaborador_sem_vinculo_fornecedor.sql`](../../../supabase/migrations/20260921100001_colaborador_sem_vinculo_fornecedor.sql).
- View unificada de "a pagar": `public.vw_a_pagar` (não versionada como arquivo próprio; nasceu em [`20260820000010_views_a_pagar_e_fluxo_caixa_desembolso.sql`](../../../supabase/migrations/20260820000010_views_a_pagar_e_fluxo_caixa_desembolso.sql)).
