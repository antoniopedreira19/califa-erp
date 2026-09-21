# Módulo Pagamento por Remessa — Índice

Documentação do módulo de geração de arquivos de remessa CNAB do ERP California, começando pelo Santander (layout CNAB 240 v11.7, junho/2026).

Este é o **mapa vivo** do módulo. Todo documento novo entra aqui, na ordem em que faz sentido para leitura sequencial (descoberta → visão → decisões → modelo → fluxos).

## Objetivo do módulo, em uma frase

Substituir o pagamento manual (um a um, dentro do internet banking) por **geração de um único arquivo `.REM`** que a agência importa no Santander, paga tudo de uma vez, e recebe um arquivo `.RET` de volta que dá baixa automática nos títulos.

## Como este módulo se conecta ao que já existe

- **Lê** de [`vw_a_pagar`](../../FLUXO-BANCO.md) — a view que unifica pedidos de compra, contas avulsas, desembolsos e (futuramente) folha de pagamento em uma única lista de "títulos a pagar".
- **Escreve** em duas tabelas novas (a nascer): `cnab_remessas` (uma linha por arquivo gerado) e `cnab_remessas_itens` (n linhas por remessa, uma por título incluído).
- **Reaproveita** dados bancários e PIX que já vivem em `fornecedores`, e que passarão a viver também em `colaboradores` e `clientes` (via migrations aditivas da fase 1).
- **Emite** débito na conta bancária de uma das três `empresas_contabeis` (California Filmes, Go Crazy, Hitlab) — cada uma com convênio Santander próprio.

## Documentos

### Fase 1 — Descoberta (fechada em 2026-09-21)
- [`00-descoberta.md`](00-descoberta.md) — o que o Santander exige (leitura crítica do manual CNAB 240 v11.7) + retrato do banco atual (via MCP) + gap consolidado

### Fase 2 — Decisões (viva, cresce por rodada)
- [`02-decisoes.md`](02-decisoes.md) — decision log do módulo (ADRs).
  - **ADR 001** (2026-09-21): colaborador deixa de reaproveitar banco via `fornecedor_id`.
  - **ADR 002** (2026-09-21): `contas_avulsas.colaborador_id` como destinatário primeiro-classe + escopo do MVP travado.
  - **ADR 003** (2026-09-21): fase 4 (modelagem) fechada — 3 migrations aditivas: colaborador ganha shape bancário, empresa contábil ganha config CNAB, tabelas de rastreio + código de barras.
  - **ADR 004** (2026-09-21): **corrige erro de design do ADR 003** — config CNAB (convênio, agência+conta+DVs, sequencial) migra pra `contas_bancarias`. Endereço fica em `empresas_contabeis`. `cnab_remessas.empresa_contabil_id` vira `conta_bancaria_id`.
  - **ADR 005** (2026-09-21): origem `"folha"` separada de `"avulso"` em `vw_a_pagar` — folha aprovada materializa em contas_avulsas, mas ganha identidade própria em toda a stack (chip novo, badge rosa, rastreio em cnab_remessas_itens).

### Fase 3 — Visão (fechada em 2026-09-21)
- [`01-visao-geral.md`](01-visao-geral.md) — objetivo, escopo do MVP (boleto + PIX chave + TED; fornecedor + colaborador; California Filmes primeiro; sem retorno CNAB), fora de escopo, permissões, critérios de aceite, roadmap pós-MVP

### Fase 4 — Modelagem (fechada em 2026-09-21)
- [`03-modelo-de-dados.md`](03-modelo-de-dados.md) — migrations aplicadas em ordem, tabelas tocadas, o que falta (backfill de dados + fase 5)

### Fase 5 — Fluxos (parcialmente fechada)
- [`04-fluxo-geracao.md`](04-fluxo-geracao.md) — geração do arquivo `.REM`: biblioteca pura → server action → UI → download. Documenta as 3 camadas do fluxo com responsabilidades claras.
- `05-fluxo-retorno.md` (a fazer, fase 2 do módulo) — parse do arquivo `.RET`, códigos de ocorrência, baixa automática dos títulos pagos

### Fase 6 — Integração (a fazer)
- `06-integracao-financeiro.md` — onde o botão "Exportar remessa" mora, como o multi-select lê `vw_a_pagar`, como o retorno reflete em `pedidos_compra_parcelas`, `contas_avulsas`, `desembolsos_parcelas`

### Backlog vivo
- [`30-proximos-passos.md`](30-proximos-passos.md) — a fazer / rodando / feito, atualizado a cada fechamento de rodada

## Estado atual

- **Fase 1 (descoberta)**: fechada. Manual do Santander lido, banco levantado via MCP, gap identificado.
- **Fase 2 (decisões)**: ADRs 001–005 travados.
- **Fase 3 (visão)**: fechada. MVP: boleto + PIX chave + TED; fornecedor + colaborador (via motor de folha existente); California Filmes; sem retorno CNAB.
- **Fase 4 (modelagem)**: fechada.
- **Fase 5 (geração)**: fechada. Biblioteca + server action + UI + download prontos e testados.

### Migrations aplicadas em 2026-09-21 (ordem cronológica)

1. `20260921100001_colaborador_sem_vinculo_fornecedor.sql` (ADR 001)
2. `20260921120001_contas_avulsas_colaborador_id.sql` (ADR 002)
3. `20260921140001_colaboradores_dados_bancarios.sql` (ADR 003 §4.1)
4. `20260921160001_empresas_contabeis_config_cnab.sql` (ADR 003 §4.2 — **revertida pelo ADR 004**)
5. `20260921180001_cnab_estruturas_do_arquivo.sql` (ADR 003 §4.3)
6. `20260921200001_config_cnab_migra_para_conta_bancaria.sql` (ADR 004)
7. `20260921200002_cnab_remessas_conta_bancaria_id.sql` (ADR 004)
8. `20260921220001_rpc_alocar_sequencial_cnab.sql` (fase 5.2)
9. `20260921230001_origem_folha_em_vw_a_pagar.sql` (ADR 005)

### Código de geração (fase 5)

- **Biblioteca**: [`lib/cnab/santander/`](../../../lib/cnab/santander/) — funções puras testadas contra fixture do `PE000013.TXT`. `npm run test:cnab` roda 12 casos verdes.
- **Server action**: [`gerarRemessaCnab`](../../../app/(app)/financeiro/contas-a-pagar/actions-cnab.ts) valida, resolve destinatário, aloca sequencial atomicamente via RPC, monta arquivo, grava rastreio, retorna Base64.
- **UI**: [`remessa-cnab-dialog.tsx`](../../../app/(app)/financeiro/contas-a-pagar/remessa-cnab-dialog.tsx) — modal centralizado com multi-select, botão "Exportar remessa Santander" na toolbar da aba Títulos a Pagar.

### Backfill parcial

- Config CNAB da conta `California Santander` (convênio `00334682004906997169`, ag. 4682, cc. 13005989-7, sequencial 13) preenchida com dados do `PE000013.TXT` (arquivo antigo aceito pelo Santander).
- Endereço fiscal da California Filmes preenchido (Salvador/BA).
- Dados bancários do colaborador de teste (`Teste`, CPF 86098531528): PIX (CPF) + banco Nubank (260) ag. 0001 / cc. 14720239-6.
- E2E preparado até o botão de geração: salário do "Teste" reduzido pra R$ 1, folha 09/2026 aprovada, 2 `contas_avulsas` materializadas (rateio 50/50) prontas pra virar o primeiro `.REM` real.

### O que ainda falta

Ver [`30-proximos-passos.md`](30-proximos-passos.md) — backlog vivo com prioridades e escopo.

## Regras deste módulo

- **Não gerar arquivo antes de homologar com o Santander.** O convênio precisa estar contratado e testado antes de qualquer pagamento real. Sequenciais 1–10 são tratados como teste pelo banco (Nota G010 do manual); começa produção a partir de 11.
- **Um lote por forma de pagamento.** Boleto, PIX chave, PIX QR Code, TED, tributo com código de barras — cada um vive em um lote separado dentro do arquivo. É regra do CNAB, não negociável.
- **Sanitização de acento no gerador, não no banco.** O CNAB é ASCII/ANSI. O banco continua guardando "Antônio" corretamente; a rotina de geração é quem remove o til/acento antes de escrever o byte. Regra do CLAUDE.md sobre pt-BR completo em UI continua valendo.
- **Dado bancário é ativo estratégico.** Toda mudança de banco/agência/conta/chave PIX de fornecedor, colaborador ou cliente gera evento em `audit_events`.
- **Cada empresa contábil (CNPJ) tem seu próprio convênio.** California Filmes, Go Crazy e Hitlab não compartilham arquivo — são três CNPJs distintos, três convênios distintos, três séries de sequencial de arquivo independentes.
- **Boleto exige CNPJ do beneficiário no Segmento J52.** Fornecedor sem CNPJ preenchido não pode ser pago por boleto via CNAB. Regra do banco (retorno "AT" se faltar).
- **Migração destrutiva exige confirmação explícita.** Vale a regra transversal do CLAUDE.md — reforçado aqui porque esse módulo mexe em várias tabelas que outros módulos consomem.
