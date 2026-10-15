# 156 — O CNPJ da PP é separado da empresa gerencial

**Data:** 2026-10-07
**Status:** aceita e implementada (07/10/2026). ⚠️ **Revisão de 15/10/2026 decidida e ainda não implementada** — "A tomadora é a emissora", no fim deste documento. O Tiago confirma a troca nas PPs antes de qualquer mudança no banco ou no código.
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
3. **O CNPJ vem escolhido pela regional** do job, configurada em Cadastros › Impostos › CNPJs emissores › "CNPJ da PP por regional" (SS → GoCrazy, pedido do Tiago). Sem configuração, vale o CNPJ da empresa gerencial do job (Hitlab → Hitlab, Agência California → California) e, por último, o da empresa principal. Sempre se pode trocar na PP. A relação, nas palavras do Tiago (08/10/2026), e conferida no formulário (AMB-1026/26 abre com GoCrazy; ANI-1004/26, da CCH, com California):

   | Empresa emissora (CNPJ) | Empresa gerencial e regional do job |
   |---|---|
   | GoCrazy | Agência California, regional SS (São Sebastião) |
   | California | Agência California, demais regionais; CCH, todas as regionais |
   | Hitlab | Hitlab |
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
6. **Casos antigos fora da relação, para o Tiago verificar o ocorrido** (levantados em 08/10/2026, com os documentos abertos um a um). Por decisão dele, **nada foi alterado**: a empresa emissora gravada fica como está. ⚠️ Em 15/10/2026 ele decidiu passar essas PPs para a tomadora da nota; aguarda a confirmação dele (ver "Revisão de 15/10/2026", no fim).
   - **Empresa emissora gravada diferente da relação:** PP-00141 (AMB-1022/26) e PP-00145 (AMB-1019/26), da regional SS, gravadas como California no preenchimento de 07/10 (não tinham NF). Os documentos (fatura 1907 e duplicata 42029) vieram contra a GoCrazy.
   - **Jobs da Hitlab com o documento contra outro CNPJ:** PP-00043 (AMB-1002/26, NF 90 contra a California), PP-00049 (AMB-1002/26, NF 87 contra a GoCrazy), PP-00090 (UER-1002/26, NF 7408 contra a California, com ISS retido em Salvador) e PP-00045 (AMB-1002/26, relatório de passagens com cliente California; não é documento fiscal). A PP-00043 e a PP-00049 têm o mesmo fornecedor, valor e serviço com NFs diferentes: confirmar que não é o mesmo serviço pago duas vezes.
   - **Notas contra o cliente:** PP-00069 a PP-00077 (AMB-1001/26, Hitlab, cachês, aprovadas) têm NF com tomador AMBEV S.A., que cita a California "aos cuidados", pelo CNPJ 19.437.976/0003-16 (estabelecimento que não está no cadastro de impostos). Aguarda o Tiago dizer como esses cachês são pagos.
   - **Teste:** a PP-00146 (TES-1014/26) fica com GoCrazy, escolhida à mão no teste, como exemplo de troca manual.
   - **Não conferidas:** PP-00105, 00106, 00107, 00123, 00126 e 00133 (geradas, com NF anexada sem tomador) serão conferidas no envio; recibo do Airbnb (PP-00044), cotação (PP-00086) e comprovante Pix (PP-00093) não têm tomador.
   - **Dentro da relação:** as 10 PPs da SS (documentos contra a GoCrazy, apesar do PDF antigo com California), 16 documentos de NE e RJ (California) e PP-00089 e PP-00113 (Hitlab).

## Testado (07/10/2026)

- AMB-1026/26 (regional SS): o formulário abre com GoCrazy, sem gravar nada.
- TES-1014/26 (regional NE): abre com California. A PP-00146 foi gerada trocando para GoCrazy: PDF com "GO CRAZY CONSULTORIA E MARKETING LTDA · 29.943.648/0001-83", gerencial Agência California.
- Envio da PP-00146 com a NF 9156 no CNPJ da California: aviso vermelho, pop-up (Voltar e Sim, enviar), confirmação de acima do planejado em seguida, auditoria com a confirmação. No financeiro, "CNPJ da PP", a frase vermelha e a faixa na aprovação (fechada sem aprovar).
- Cadastro de impostos: o quadro por regional grava e volta ao padrão (regional Teste); o diálogo do CNPJ salva os campos novos.

## Revisão de 15/10/2026 — a tomadora é a emissora (decidida, NÃO implementada)

**Situação:** decidida pelo Tiago em 14 e 15/10/2026. **Nada foi aplicado.** Ele confirma a troca nas PPs antigas (lista abaixo) antes; só então entram a migration e o código.

**Por quê.** A nota é o documento fiscal: o CNPJ que está nela lança a despesa, retém imposto (o ISS retido da PP-00090 é da California) e deve pagar. A relação por regional (item 3 da regra) continua só como **pré-seleção** na geração.

### A regra revista

1. **A empresa emissora da PP é a tomadora da nota.** Revê o item 4 da regra ("nota em outro CNPJ não barra").
2. **Antes do envio, a nota em outro CNPJ barra.** Respostas do Tiago:
   - no formulário de gerar e de editar a PP, o aviso vermelho vira trava. O campo "Empresa emissora" está na mesma tela;
   - no envio, sai o "Sim, enviar" (pop-up "Enviar com a nota em outro CNPJ?") e entra o botão **"Editar a PP"**, que abre a edição da PP gerada ([173](173-pp-gerada-volta-a-se-editar.md)). Ali a empresa emissora é trocada, o PDF é refeito e a linha do tempo registra "Editada". O sistema não troca sozinho;
   - o servidor barra também, sem a confirmação `confirmarTomadorDiferente`.
3. **Depois do envio, "Corrigir a NF" leva a emissora junto.** Trocar o tomador troca a empresa emissora da PP e das outras PPs que usam a mesma nota, com registro. Ponto a resolver na implementação: PP com notas em CNPJs diferentes (barrar, porque a emissora ficaria ambígua).
4. **A faixa vermelha na aprovação do financeiro fica** para o que já existia.

### Troca nas PPs antigas (aprovada pelo Tiago em 15/10, aguardando a confirmação dele)

Muda só `pedidos_compra.estabelecimento_id`, com auditoria. Os PDFs já gerados **não** são refeitos: são o que o fornecedor recebeu. Situação em 14/10/2026: nenhuma delas paga.

| PP | Job | Valor | Status em 14/10 | Hoje | Passa a ser | Documento |
|---|---|---|---|---|---|---|
| PP-00141 | AMB-1022/26 (SS) | R$ 1.500,00 | em avaliação | California | GoCrazy | fatura 1907 contra a GoCrazy |
| PP-00145 | AMB-1019/26 (SS) | R$ 3.694,09 | em avaliação | California | GoCrazy | duplicata 42029 contra a GoCrazy |
| PP-00043 | AMB-1002/26 (Hitlab) | R$ 3.500,00 | em avaliação | Hitlab | California | NF 90 contra a California |
| PP-00049 | AMB-1002/26 (Hitlab) | R$ 3.500,00 | em avaliação | Hitlab | GoCrazy | NF 87 contra a GoCrazy |
| PP-00090 | UER-1002/26 (Hitlab) | R$ 6.000,00 | em avaliação | Hitlab | California | NF 7408 contra a California, ISS retido em Salvador |
| PP-00045 | AMB-1002/26 (Hitlab) | R$ 5.737,03 | em avaliação | Hitlab | California | relatório de passagens com cliente California (sem nota fiscal) |
| PP-00069 a 00077 | AMB-1001/26 (Hitlab) | R$ 350.000,00 | aprovadas | Hitlab | California | NFs com tomador AMBEV S.A., "aos cuidados" da filial California 19.437.976/0003-16 |

Total que muda de CNPJ: R$ 373.931,12. A PP-00146 (teste) fica como está, a pedido do Tiago.

### Cuidados registrados

- **Os 9 cachês:** o tomador da nota é a AMBEV S.A. A /0003-16 é **filial** da California (mesma raiz 19.437.976), não outra empresa. Entram como California (/0001-54, a do cadastro) por decisão do Tiago. Falta perguntar ao contador como a California registra uma despesa com nota em nome da AMBEV.
- **Conta que paga:** os cachês passam de Hitlab para California. O sistema ainda não confere a conta do pagamento (pendência 2). O financeiro precisa saber, para pagar pela conta certa e registrar o encontro de contas.
- **Para o Tiago verificar:** PP-00043 × PP-00049 (mesmo fornecedor, valor e serviço com NFs diferentes); PP-00045 sem nota fiscal.
- **PPs ainda não enviadas com NF sem tomador** (PP-00105, 00106, 00107 e 00123, todas com a California como emissora): passam pela trava nova no envio. A PP-00126 e a PP-00133 foram enviadas entre 08 e 14/10 com a nota contra a California, igual à empresa emissora; até 14/10, nenhuma PP real chegou ao financeiro com a nota em outro CNPJ.
