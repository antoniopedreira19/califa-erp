# 01 — Visão geral e escopo do MVP

Este documento congela o **escopo do primeiro `.REM` que o módulo vai gerar**. Alterações depois de fechado entram como ADR em [02-decisoes.md](02-decisoes.md), não editam este arquivo.

Referências: leitura do manual em [00-descoberta.md](00-descoberta.md); decisões de escopo em [ADR 002](02-decisoes.md).

## 1. Objetivo

Gerar um arquivo `.REM` (CNAB 240, layout Santander v11.7) contendo todos os títulos que a agência precisa pagar em uma rodada, importar uma única vez no internet banking do Santander e efetivar tudo em uma leva — no lugar de digitar boleto por boleto, PIX por PIX, TED por TED.

## 2. Escopo do MVP

### 2.1 Formas de pagamento suportadas

| Forma CNAB | Descrição | Segmentos exigidos | Onde o dado mora hoje |
|---|---|---|---|
| **30** | Boleto Santander | J + J52 | `contas_avulsas.codigo_barras` / `pedidos_compra.codigo_barras` (a criar na fase 2) |
| **31** | Boleto outros bancos | J + J52 | idem |
| **45** | PIX por chave ou dados bancários | A + B | `fornecedores.pix_*` (pronto); colaborador ganha na fase 1 |
| **03** | TED | A + B | `fornecedores.banco_*` (pronto); colaborador ganha na fase 1 |

Fora do MVP: PIX QR Code dinâmico (forma 47), tributo com código de barras (forma 11), crédito conta Santander (forma 01). Ficam pra fase 2/3.

### 2.2 Destinatários

- **Fornecedores** — 24 registros ativos, 11 com banco preenchido, 17 com PIX. Nenhum trabalho de migração.
- **Colaboradores** — via motor de folha que já existe. RH gera folha → envia → financeiro aprova → materializa `contas_avulsas` com `colaborador_id` preenchido (via [ADR 002](02-decisoes.md)) → cai em `vw_a_pagar` → entra no arquivo.

Fora do MVP: **clientes** (156 registros sem banco/PIX). Reembolsos e estornos a cliente continuam manuais até a fase 2.

### 2.3 Empresa contábil pagadora

**California Filmes e Publicidade LTDA (CNPJ `19437976000154`).**

Go Crazy e Hitlab entram depois de homologada a California. Cada uma tem convênio Santander próprio e sequencial de arquivo próprio — não compartilham nada.

### 2.4 Retorno CNAB

**Fora do MVP.** O `.RET` que o Santander devolve depois do pagamento não é processado no MVP. Baixa dos títulos continua manual — financeiro paga o arquivo no banco, confere no extrato e baixa cada título no ERP.

Fase 2 adiciona parse do retorno + baixa automática por código de ocorrência.

## 3. O que fica de fora, permanentemente

Registrado em [00-descoberta §5](00-descoberta.md#5-o-que-fica-fora-deste-módulo-permanentemente):

- IPVA/DPVAT/Licenciamento por RENAVAM (Segmento N, formas 25/26/27)
- OCT — Ordem de Crédito por Teleprocessamento (Segmento I, forma 35)
- Captura DDA (Segmento G, arquivo retorno)
- Multi-banco no MVP — Santander primeiro, outros bancos entram só se houver demanda

## 4. Permissões

Reusa o gate existente do módulo financeiro:

- **`financeiro.contas_a_pagar.pagar`** — quem já pode dar baixa em título hoje é quem pode gerar remessa e fazer download do `.REM`.
- **`financeiro.remessa.configurar`** — permissão nova (a criar), separada da anterior, pra configurar convênio CNAB da empresa contábil. Segrega quem cadastra do quem opera. Só administrador e o gerente financeiro têm.
- **`empresas_contabeis` config CNAB** — visível só pra quem tem `financeiro.remessa.configurar`. Financeiro-operacional consome mas não altera.

Auditoria (`audit_events`) em toda mudança de config CNAB, geração de remessa e alteração de dados bancários de fornecedor/colaborador.

## 5. Critérios de aceite do MVP

Done when:

- [ ] Migration da fase 1 aplicada: colaborador ganha shape bancário, empresas_contabeis ganha config CNAB (endereço, convênio, sequencial).
- [ ] UI de config CNAB na tela de empresas contábeis. Só California Filmes preenchida no MVP.
- [ ] UI de dados bancários no drawer do colaborador (mesmo componente que fornecedor já tem).
- [ ] Migration da fase 2: `cnab_remessas` + `cnab_remessas_itens`; `codigo_barras` em `contas_avulsas` e `pedidos_compra_parcelas` (pra pagamento boleto).
- [ ] Botão "Exportar remessa Santander" na tela de Contas a Pagar. Multi-select filtrado por empresa contábil pagadora. Rejeita se convênio da empresa não estiver configurado.
- [ ] Server action que valida elegibilidade dos títulos selecionados (CNPJ do beneficiário obrigatório pra boleto; banco+conta+DV obrigatório pra TED; chave PIX obrigatória pra PIX), monta as linhas de 240 bytes com padding correto, sanitiza acentos (`NFD` + regex), incrementa sequencial atomicamente, grava `cnab_remessas`, marca títulos como "em processamento CNAB".
- [ ] Download do `.REM` gerado.
- [ ] Homologação Santander concluída pela California Filmes.
- [ ] Primeiro pagamento real de teste (1 boleto + 1 PIX + 1 TED, valores baixos).

Sem tudo isso, o MVP não está pronto. O que **NÃO** é critério de aceite do MVP e fica pra fase 2/3:

- Parse do arquivo retorno `.RET`
- Suporte a Go Crazy e Hitlab
- PIX QR Code
- Tributo com código de barras
- Cliente como destinatário

## 6. Roadmap depois do MVP

Ordenado por valor / esforço:

1. **Fase 2a — Retorno CNAB.** `.RET` upload + parse + baixa automática dos títulos com ocorrência `00`. Fecha o loop e é o maior ganho depois do MVP.
2. **Fase 2b — Go Crazy + Hitlab.** Só config e homologação; o gerador já roda.
3. **Fase 2c — PIX QR Code (forma 47).** Suporta cobranças com QR Code, incluindo FGTS Digital.
4. **Fase 3 — Tributo com código de barras (forma 11).** DARF, guias municipais, GARE, etc.
5. **Fase 4 — Cliente como destinatário.** Reembolso e estorno via CNAB. Precisa migration de banco/PIX em `clientes` primeiro.
6. **Fase 5 — Multi-banco.** Bradesco, BB, Itaú. Só se houver demanda concreta de negócio.
