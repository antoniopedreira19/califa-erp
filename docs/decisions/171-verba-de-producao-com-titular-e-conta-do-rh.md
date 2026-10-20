# 171 — A verba de produção igual às outras, e a conta do RH na PP do colaborador

**Data:** 2026-10-14
**Status:** aceita e implementada (14/10/2026). Revista em 19/10/2026: o titular freela é um registro de `freelancers` (ver o fim).
**Quem decidiu:** Tiago, em 13/10/2026 (noite), a partir do retorno de uma produtora sobre a PP-00160.
**Revê:** a [164](164-verbas-de-alimentacao-e-transporte.md) — a regra 4 ("sem pagamento para a pessoa") e a verba de produção, que ficava de fora do titular.
**Migration:** `20261014100001_verba_de_producao_com_titular.sql`.

## O que aconteceu

Em 13/10/2026 uma produtora gerou duas PPs de verba de alimentação no
DEE-1001/26. A PP-00161 (uma pessoa como terceiro, com cadastro de
fornecedor feito 7 minutos antes) saiu com os dados bancários. A
PP-00160 (uma colaboradora do RH) saiu sem nenhum —
era a regra 4 da 164: a PP da pessoa não registra meio de pagamento, e o
financeiro decide na aprovação. Ela perguntou se precisava incluir algo e
se o financeiro pagaria "pelo PIX cadastrado no banco de dados".

O levantamento mostrou que a colaboradora **tinha** conta e PIX no RH (193
dos 211 colaboradores ativos têm conta ou PIX; os 69 freelas não têm
nada), mas a ficha do RH só abre para administrador e RH: nem a produção
nem os 4 usuários do financeiro enxergam. O Tiago escolheu a opção C entre
quatro: **imprimir no PDF a conta e o PIX do RH, como na PP de fornecedor**.

E pediu que a verba de produção funcione do mesmo modo que as outras
duas — "Titular da verba", a mesma lista, a opção do terceiro —, com
qualquer outra diferença trazida para ele aprovar. As três que restavam
(quem presta contas, os textos das telas e os textos do PDF) foram
aprovadas para ficar iguais.

## A regra

1. **As três verbas têm titular.** Produção, alimentação e transporte usam o
   mesmo campo "Titular da verba": a lista de colaboradores ativos do RH e
   freelas trabalhando (`pessoas_para_verba`), ou a caixa "Terceiro
   (fornecedor)" com o pagamento do fornecedor. O "Responsável" (usuário do
   sistema) sai do formulário.
2. **Quem não está na lista entra como terceiro.** Em 14/10/2026, 7 GPs, 7
   produtores, 7 administradores e 3 freelancers com acesso ao sistema não
   estão no RH nem nos freelas (só 1 deles tem cadastro de fornecedor). O
   Tiago decidiu manter a lista só com RH e freelas, igual nos três tipos;
   quem faltar recebe como terceiro, com cadastro de fornecedor.
3. **A PP do colaborador traz a conta e o PIX do RH.** O PDF ganha o bloco
   "DADOS BANCÁRIOS DO TITULAR DA VERBA PARA PAGAMENTO", no desenho do da
   PP de fornecedor: banco, agência, conta, tipo de conta, nome, CPF, tipo
   de chave e chave PIX (sem e-mail). Os dados são os do RH **no momento da
   geração**: mudança posterior na ficha não altera a PP. Sem conta nem PIX
   no RH (18 dos 211), e no freela, a PP sai sem o bloco, e o financeiro
   decide na aprovação, como antes.
4. **Quem tira a foto é o banco.** O gatilho `trg_pp_foto_do_colaborador`
   copia a ficha do RH para as colunas da foto da PP (as mesmas do
   fornecedor, decisão 067) e o CPF para `verba_titular_cpf`, na geração —
   e, na PP ainda gerada, de novo se o titular mudar. Depois disso, a foto
   fica: a tela não a apaga. Não há função que a tela chame para ler a
   ficha: ela entregaria a conta e o CPF de qualquer colaborador a quem gera
   PP, pelo console. Assim, o dado só aparece numa PP que de fato foi
   gerada para aquela pessoa, com autor e data.
5. **Risco aceito:** quem gera PP pode gerar uma verba só para ver o PIX de
   um colaborador. Fica registrado quem gerou.
6. **Prestação de contas igual nas três:** administrador, GP, produtor ou o
   freela do job. O responsável da verba de produção anterior a esta
   decisão continua podendo prestar a dele.
7. **Textos iguais nas três:** "Titular da verba" nas telas (ficha "Ver PP",
   revisão da PP a emitir, prestação, dossiê e aprovação da prestação no
   financeiro); no PDF, "DADOS DO TITULAR DA VERBA", "Assinatura do Titular
   da Verba" e a natureza "Verba de Produção — adiantamento sob
   responsabilidade de quem está nomeado acima, com prestação de contas ao
   final".
8. **A remessa continua só com fornecedor** (escolha do Tiago: "não agora").
   A verba do colaborador é paga manualmente, pelos dados do PDF.

## O que já existia

- **As 10 PPs de verba de produção anteriores** (1 paga, 2 em avaliação, 1
  gerada, 6 canceladas) continuam com "Responsável", como registro: a
  verba sem titular é a antiga (`verbaDeResponsavel`), e as telas e o PDF
  refeito a mostram como foi gerada.
- **As 4 PPs a emitir de produção** com responsável pedem o titular quando
  forem abertas; o servidor recusa gerar com responsável ("A verba de
  produção agora tem titular, como as outras").
- **PP-00160 e PP-00165** (alimentação, titular colaborador, as duas do
  DEE-1001/26): a migration preencheu a foto do RH, e o PDF das duas foi
  refeito com o bloco de pagamento (`scripts/refazer-pdf-verba-colaborador-171.ts`).
  O script comparou o texto: nada saiu do documento, só entrou o bloco. A
  PP-00165 tem só PIX no RH; a PP-00160, conta e PIX.

## Com a edição da PP gerada (decisão 173)

A 173 (publicada junto) deixa a PP gerada ser editada no lugar. Na verba
do colaborador, a edição refaz o PDF **depois** de gravar, com a foto lida
de volta da PP: titular igual mantém a foto da geração, titular novo faz o
gatilho tirar outra. A verba de produção antiga (com responsável) abre na
edição sem titular, que passa a ser obrigatório.

## No banco

- CHECKs `chk_pp_verba_coerencia` e `chk_ppae_verba`: aceitam a produção
  com titular; a forma antiga (responsável, sem titular) segue válida.
- `pedidos_compra.verba_titular_cpf` (texto, 11 dígitos), gravado só pelo
  gatilho.
- `pp_foto_do_colaborador()` (SECURITY DEFINER, sem EXECUTE para
  `authenticated` e `anon`) e o gatilho `trg_pp_foto_do_colaborador`
  (BEFORE INSERT OR UPDATE em `pedidos_compra`). `colaboradores` (tabela do
  RH, a outra frente) só é lida.
- `enviar_prestacao_verba`: a regra única da prestação.

## Conferido

Em 14/10/2026, no TES-1023/26 (projeto de teste), com o colaborador de
teste do RH "Teste PJ Gerar Contrato": PP-00168, verba de produção com
titular colaborador — o formulário mostrou "Titular da verba" e a caixa do
terceiro (que troca para o campo Fornecedor), a revisão mostrou o titular,
o gatilho tirou a foto (conta, PIX e CPF), o PDF saiu com o bloco e os
textos novos, e a ficha "Ver PP" mostrou "Titular da verba". A PP-00127
(verba de produção antiga) seguiu mostrando "Responsável". A PP-00168 foi
cancelada depois.

## Fora daqui

- Remessa para a verba do colaborador (destinatário do RH, como a folha).
- Freela sem conta: continua caso a caso, até o RH ter os freelas.

## Revisão de 19/10/2026 — o freela vem de `freelancers`

A lista "Titular da verba" passou a ler os freelas de `freelancers` (o
cadastro do RH, 221 pessoas migradas) no lugar da tabela provisória
`freelas`. A migration `20261019900003_titular_freela_da_verba_vem_de_freelancers.sql`
levou junto as FKs `verba_freela_id` de `pedidos_compra` e
`pedidos_compra_a_emitir`, que ainda apontavam para `freelas` e recusavam
qualquer freela escolhido na lista nova. As referências antigas trocaram
pelo CPF (27 de 29); as 2 do freela de teste sem CPF ficaram com o id antigo,
e por isso as FKs são `not valid`.

Na mesma data, a lista voltou a deixar de fora quem não está trabalhando:
entra o freela que não está "Encerrado" no módulo de Freelancers (64 de 221 em
19/10), como era com a lista provisória (`20261019900004_titular_da_verba_sem_freela_encerrado.sql`).

A conta do freela ainda não vai para a PP: a foto do pagamento continua só
para o colaborador do RH. Detalhes nas notas (9) e (11) de 19/10/2026 do
`HANDOFF_JOBS.md`.
