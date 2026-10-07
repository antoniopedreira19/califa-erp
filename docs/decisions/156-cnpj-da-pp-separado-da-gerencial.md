# 156 — O CNPJ da PP é separado da empresa gerencial

**Data:** 2026-10-07
**Status:** aceita e implementada (07/10/2026).
**Quem decidiu:** Tiago, em 07/10/2026, a partir de um caso reportado pela produção (NF 102, regional SS, com tomador GoCrazy) e da lista de "Empresa emissora" do formulário da PP, que mostrava as empresas gerenciais.
**Revê:** a [152](152-nf-do-fornecedor-com-cadastro-proprio.md) no CNPJ tomador sugerido e na conferência da nota (antes, pela empresa gerencial).
**Migration:** `20261007300009_cnpj_da_pp_separado_da_gerencial.sql`.

## O problema

O campo "Empresa emissora" do formulário da PP listava as empresas **gerenciais** (Agência California, CCH, Hitlab, Ventura, Empresa Teste). A PP usava essa escolha para três coisas:

| Uso | Deveria ser | Era |
|---|---|---|
| Quem vê a PP (RLS), relatórios, fluxo de caixa por empresa | Gerencial | ✅ |
| Cabeçalho do PDF da PP, que diz ao fornecedor contra qual CNPJ emitir a nota | CNPJ | ❌ a PP-00144, de um job da CCH, saiu com "CCH LTDA · CNPJ 00.000.000/0000-00" |
| Conferência do CNPJ tomador da NF | CNPJ | ❌ as NFs 19 e 102, com tomador GoCrazy (regional SS), apareciam como erro numa PP da Agência California |

As duas dimensões são independentes (palavras do Tiago): o CNPJ da California pode arcar com custos da Hitlab gerencial, e a regional SS (São Sebastião) da Agência California costuma sair pela GoCrazy. Isso já valia no resto do sistema: a conta bancária pertence a uma empresa contábil desde 11/09/2026, e o Faturar escolhe o "CNPJ emissor" separado da gerencial desde 02/10/2026. Só a PP fazia os dois papéis com um campo.

## A regra

1. **A empresa gerencial da PP é a do job.** Não se escolhe no formulário: aparece como informação ("Empresa gerencial do job: Agência California"). A geração grava a do job mesmo que venha outra. Antes, em 79 PPs reais, a escolhida já era sempre a do job.
2. **"Empresa emissora" é o CNPJ da PP** (`pedidos_compra.estabelecimento_id`): a lista são os CNPJs ativos do cadastro de impostos (hoje California, GoCrazy e Hitlab). Ele:
   - sai no cabeçalho e em "Dados para faturamento da cobrança" do PDF (razão social da empresa contábil, CNPJ, endereço, inscrições);
   - vem como CNPJ tomador da NF;
   - é com ele que a nota é conferida;
   - é o CNPJ da conta que paga (pendência abaixo).
3. **O CNPJ vem escolhido pela regional** do job, configurada em Cadastros › Impostos › CNPJs emissores › "CNPJ da PP por regional" (SS → GoCrazy, pedido do Tiago). Sem configuração, vale o CNPJ da empresa gerencial do job (Hitlab → Hitlab, Agência California → California) e, por último, o da empresa principal. Sempre se pode trocar na PP.
4. **Nota em outro CNPJ não barra** (resposta do Tiago):
   - na NF, aviso em vermelho: "A nota está no CNPJ X, mas a PP é do CNPJ Y. Se a nota veio errada, peça outra ao fornecedor; enviada assim, o financeiro decide na aprovação.";
   - no envio, um pop-up "Enviar com a nota em outro CNPJ?", com "Voltar" e "Sim, enviar". O servidor confere de novo e registra na auditoria (`nota_em_outro_cnpj_confirmada`);
   - no financeiro, "CNPJ da PP" no quadro da nota, a frase vermelha em cada nota em outro CNPJ e uma faixa vermelha no pop-up de aprovação ("A nota está em outro CNPJ que não o da PP… Confira antes de aprovar.").
5. **PPs que já existiam** receberam o CNPJ (só preencheu o vazio): o tomador da NF anexada; sem NF, o CNPJ da empresa gerencial; sem ele (CCH, Ventura, Empresa Teste), o da principal. Resultado em 07/10/2026: 65 California, 26 Hitlab, 8 GoCrazy. Os PDFs já gerados não mudam.

## Banco

- `pedidos_compra.estabelecimento_id` → `fiscal_estabelecimentos`. `empresa_id` segue sendo a gerencial (chave da RLS).
- `fiscal_cnpj_da_pp_por_regional (regional_id, tenant_id, estabelecimento_id, atualizado_por)`: leitura para o tenant; escrita para administrador e financeiro.
- `fiscal_estabelecimentos` ganhou os dados do cabeçalho do PDF (endereço, número, complemento, bairro, CEP, telefone, e-mail, inscrições), editáveis no diálogo do CNPJ. Os da California e da Hitlab vieram da empresa gerencial de mesmo CNPJ.

## Pendências

1. **Dados cadastrais da GoCrazy** (endereço, IE, IM, telefone, e-mail): não existem em nenhum cadastro. Até serem preenchidos no diálogo do CNPJ, o PDF sai só com razão social, CNPJ, município e UF.
2. **Pagar pela conta do CNPJ da PP** ("sempre do tomador"): a baixa e a remessa ainda não conferem a empresa contábil da conta contra o CNPJ da PP. E o **encontro de contas** quando o CNPJ da PP é diferente do da gerencial.
3. **O que a aprovação faz com a nota em outro CNPJ**: hoje o financeiro só vê o aviso; a decisão (corrigir o tomador, rejeitar, aprovar assim) é dele, sem regra no sistema.
4. **O logo do PDF** continua o da California para todo CNPJ.
5. **A PP-00144** (ANI-1004/26, job da CCH) foi gerada com "CCH LTDA · CNPJ 00.000.000/0000-00" no PDF. Com a regra nova, cancelar e gerar de novo.

## Testado (07/10/2026)

- AMB-1026/26 (regional SS): o formulário abre com GoCrazy, sem gravar nada.
- TES-1014/26 (regional NE): abre com California. A PP-00146 foi gerada trocando para GoCrazy: PDF com "GO CRAZY CONSULTORIA E MARKETING LTDA · 29.943.648/0001-83", gerencial Agência California.
- Envio da PP-00146 com a NF 9156 no CNPJ da California: aviso vermelho, pop-up (Voltar e Sim, enviar), confirmação de acima do planejado em seguida, auditoria com a confirmação. No financeiro, "CNPJ da PP", a frase vermelha e a faixa na aprovação (fechada sem aprovar).
- Cadastro de impostos: o quadro por regional grava e volta ao padrão (regional Teste); o diálogo do CNPJ salva os campos novos.
