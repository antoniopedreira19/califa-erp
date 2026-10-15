# 156 — O CNPJ da PP é separado da empresa gerencial

**Data:** 2026-10-07
**Status:** aceita e implementada (07/10/2026). ⚠️ **Revista em 15–16/10/2026 e implementada em 16/10/2026** — "A tomadora é a emissora", no fim deste documento (migration `20261015970001_tomadora_e_emissora_da_pp.sql`).
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
6. **Casos antigos fora da relação, para o Tiago verificar o ocorrido** (levantados em 08/10/2026, com os documentos abertos um a um). Por decisão dele, **nada foi alterado**: a empresa emissora gravada fica como está. ⚠️ Em 16/10/2026, com a confirmação dele, essas PPs passaram para a empresa do documento (ver "Revisão de 15/10/2026", no fim).
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

## Revisão de 15/10/2026 — a tomadora é a emissora (implementada em 16/10/2026)

**Situação:** decidida pelo Tiago em 14, 15 e 16/10/2026; a troca nas 15 PPs antigas confirmada por ele em 16/10/2026; fatura e recibo com o campo de CNPJ, também em 16/10. Implementada no mesmo dia: migration `20261015970001_tomadora_e_emissora_da_pp.sql` e o código descrito em "Como ficou", abaixo.

**Por quê.** A nota é o documento fiscal: o CNPJ que está nela lança a despesa, retém imposto (o ISS retido da PP-00090 é da California) e deve pagar. A relação por regional (item 3 da regra) continua só como **pré-seleção** na geração.

### A regra revista

1. **A empresa emissora da PP é a tomadora da nota.** Revê o item 4 da regra ("nota em outro CNPJ não barra").
2. **A empresa emissora segue o documento sozinha** (Tiago, 16/10/2026, revendo a resposta de 15/10). Ao anexar a nota com outro CNPJ tomador, a PP passa para a empresa do documento, o PDF é refeito e aparece um aviso informativo — sem trava e sem "tem certeza?". Sem documento ainda, vale a pré-seleção pela regional. O servidor faz a mesma conta (não confia só na tela) e registra a troca. *Substitui* o que estava decidido em 15/10: barrar o envio e abrir a edição da PP pelo botão "Editar a PP" ([173](173-pp-gerada-volta-a-se-editar.md)). Motivo: com a regra "a tomadora é a emissora", a correção era sempre a mesma; o financeiro continua podendo rejeitar documento errado.
   - **Fatura e recibo dizem o CNPJ também** (Tiago, 16/10/2026): só o campo "Contra qual CNPJ", já preenchido, obrigatório no envio. A empresa emissora segue NF, fatura ou recibo do mesmo jeito.
3. **Depois do envio, "Corrigir a NF" leva a emissora junto.** Trocar o tomador troca a empresa emissora da PP e das outras PPs que usam a mesma nota, com registro. Ponto a resolver na implementação: PP com notas em CNPJs diferentes (barrar, porque a emissora ficaria ambígua).
4. **A faixa vermelha na aprovação do financeiro fica** para o que já existia.
5. **A PP é documento interno, por enquanto** (Tiago, 16/10/2026): não vai a terceiros. O cabeçalho com a empresa emissora fica (sem ele o documento perde a cara profissional) e mostra a empresa do documento anexado, que é quem paga.
6. **O PDF ganha "Empresa gerencial" e "Regional" embaixo de "Job:"**, sempre as do job (Tiago, 16/10/2026). Assim, a quem o job pertence fica no documento, e o cabeçalho diz quem paga. Desenho aprovado com dados fictícios: job da Hitlab, regional Hitlab, cabeçalho California (nota contra a California). Os trechos escritos para o fornecedor ("Solicitamos por ordem do sacado", "Dados para faturamento da cobrança", "Assinatura do Fornecedor") ficam como estão até o Tiago decidir.

### Troca nas PPs antigas (confirmada pelo Tiago e aplicada em 16/10/2026)

Aplicada pela migration `20261015970001`, que só troca a PP que ainda estava com a empresa de antes e desfaz tudo se não forem exatamente 15. Cada PP ganhou o passo "Empresa emissora trocada" na linha do tempo e a auditoria `pedido_compra.emissora_trocada` (origem: a migration). Em 16/10, antes de aplicar: os 9 cachês já estavam **pagos em 08/10 pela conta California Santander** (a troca registra quem pagou) e a PP-00090 tinha sido **aprovada em 15/10 sem a retenção do ISS** de R$ 300 que a nota traz (aviso ao financeiro antes do pagamento).

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
- **PPs ainda não enviadas com NF sem tomador** (PP-00105, 00106, 00107 e 00123, todas com a California como emissora): o tomador é pedido no envio, e a empresa emissora segue o que ficar ali. A PP-00126 e a PP-00133 foram enviadas entre 08 e 14/10 com a nota contra a California, igual à empresa emissora; até 14/10, nenhuma PP real chegou ao financeiro com a nota em outro CNPJ.
- **Fora do alcance desta revisão:** se o financeiro registrar, na aprovação, um tomador diferente do da produção, a empresa emissora não segue sozinha — a frase vermelha "A nota está no CNPJ…" continua no dossiê e na aprovação. E a fatura ou o recibo em avaliação não têm "Corrigir": o "Corrigir a NF" é só da nota.

### Como ficou (16/10/2026)

- **Regra:** `emissoraDosDocumentos` (`lib/fiscal/cnpj-da-pp.ts`, com teste): os documentos com CNPJ (`documentoTemCnpj`: NF, fatura, recibo) definem a empresa emissora; sem eles, vale o seletor; em CNPJs diferentes, barra ("Os documentos desta PP estão em CNPJs diferentes…"). O CNPJ da fatura e do recibo fica no mesmo campo da NF (`pedidos_compra_anexos.nf_tomador_estabelecimento_id`).
- **Formulário (gerar, editar, PP a emitir):** com documento que diga o CNPJ, o seletor "Empresa emissora" trava na empresa dele e diz "Definida pelo documento: NF 123. Para mudar, corrija o CNPJ no documento."; sem documento, "Quem paga a PP. Com nota, fatura ou recibo anexado, vale o CNPJ do documento." O documento que passa a dizer o CNPJ nasce com a empresa de agora. O servidor faz a mesma conta (`emissoraPelosAnexos`) na geração, na edição e na PP a emitir.
- **Envio e "Pronta para envio":** sem "tem certeza?". O aviso azul na nota (e no "Contra qual CNPJ") diz "A empresa emissora da PP passa de X para Y, o CNPJ desta nota, e o PDF é refeito."; depois de gravar os anexos, `seguirDocumentoNaPP` troca a empresa, refaz o PDF (`refazerPdfDaPP`, a mesma data de emissão) e registra. A mensagem do envio acrescenta "A empresa emissora passou para Y". O 4º parâmetro `confirmarTomadorDiferente` e o retorno `tomadorDiferente` saíram.
- **"Corrigir a NF":** depois da RPC, `seguirDocumentosDaNotaCorrigida` aplica a regra na PP corrigida e nas outras PPs com a mesma nota (canceladas fora). PDF refeito na gerada e na em avaliação; a aprovada e a paga guardam o documento.
- **Linha do tempo:** o gatilho `trg_pp_registra_troca_de_emissora` registra toda troca ("De California para GoCrazy, o CNPJ do documento (NF 15601)."), com o rótulo "Empresa emissora trocada" na ficha da PP e no dossiê do financeiro.
- **PDF:** "Empresa gerencial" e "Regional" embaixo de "Job:" (`carregarContextoPdf` lê os nomes do job; campos obrigatórios no gerador, com as duas linhas só quando há valor).

### Testado (16/10/2026)

Como **GP Teste Claude**, em `localhost:3097`, no TES-1014/26 (item Passagem, Fornecedor Teste, R$ 100):
- formulário: fatura com "Contra qual CNPJ" GoCrazy travou o seletor em GoCrazy ("Definida pelo documento: fatura…"); a NF anexada depois nasceu com GoCrazy; NF trocada para California deu a mensagem vermelha de CNPJs diferentes; sem a fatura, o seletor travou em California pela NF;
- **PP-00206** gerada (California); PDF com "Empresa gerencial: Agência California" e "Regional: NE";
- envio com a NF 15601 trocada para GoCrazy: aviso azul, só o "tem certeza?" de acima do planejado, PP em avaliação com GoCrazy, PDF refeito com o cabeçalho da GoCrazy, evento e auditoria (origem `envio`);
- "Corrigir a NF" com o tomador de volta para California: aviso azul, PP com California, eventos "NF corrigida" e "Empresa emissora trocada", auditoria (origem `correcao_da_nf`); a ficha da PP mostra os dois passos com o motivo.
- `tsc`, `lint`, testes do fiscal (152) e `build` limpos. A PP-00206 ficou em avaliação no TES-P001/26.
