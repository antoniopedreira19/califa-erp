# 128 — O job devolvido se corrige no orçamento e volta com o mesmo código

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migrations:** `20260929950001_job_devolvido_reserva_o_codigo.sql`,
`20260929950002_planejado_do_job_devolvido.sql`,
`20260929950003_sair_do_mensal_junta_os_meses.sql`,
`20260929950004_comentarios_decisao_128.sql` (só comentários) e
`20260929950005_planejado_do_job_devolvido_le_o_interno.sql` (conserto).
**Protótipo:** https://claude.ai/artifact/R4g9sjrnCSEh6j4swueJLT
**Revisa:** 057 (o "Cancelar envio" sai do job devolvido), 078 (sair do
mensal junta os meses) e 114 (o código do job devolvido volta).

---

## 1. O problema

O AMB-1012/26 voltou do financeiro em 28/09/2026 porque o GP abriu o
orçamento como Always On, e era Influencer · Ativação. O reenvio da 057 só
reabre o formulário de abertura (nome, cidade, datas, contatos,
descritivo), e a categoria vem travada do orçamento, que não se editava com
job criado. A única saída era o "Cancelar envio à abertura", que queima o
código, e depois cancelar a aprovação, corrigir, aprovar e enviar de novo
— outro código para o mesmo trabalho.

Nenhuma das quatro devoluções reais até 29/09 pedia o que o reenvio
corrige: AMB-1004 (planejado maior que o orçado), UER-1002 (cliente),
AMB-1011 (planilha interna incompleta) e AMB-1012 (categoria e serviço).

Nas palavras do Tiago: "Na maioria dos casos, onde um job for rejeitado
pelo financeiro, ele não será cancelado e, sim, alguma edição será
necessária para que ele possa ser aceitado pelo financeiro."

## 2. A regra em três frases

1. **Com o job devolvido, o "Editar" do orçamento e o planejado da versão
   aprovada abrem para correção**, com o job vivo, e o reenvio é o de
   sempre (057). A aprovação é o acordo com o cliente sobre o ORÇADO; o
   planejado, a categoria e o serviço são internos.
2. **O que muda o orçado passa pelo "Cancelar aprovação"**, que no job
   devolvido cancela o job e guarda o código: ao aprovar de novo e
   enviar, o job volta com o mesmo código.
3. **Sair do Fee ou do Always On para uma planilha comum junta os meses**,
   em todo orçamento, em vez de apagar os que vêm depois do primeiro.

## 3. O que foi decidido

| # | Pergunta | Decisão |
|---|---|---|
| 1 | "Desistir do job" e "Resposta ao financeiro" no reenvio? | **Não.** Os dois saíram da proposta. |
| 2 | Onde se corrige? | **Na tela do orçamento:** "Editar" e o planejado. |
| 3 | Incluir ou remover linha no job devolvido? | **Pelo "Cancelar aprovação".** Linha nova teria orçado zero, que a aprovação não aceita. |
| 4 | Serviço Interno? | **Pelo "Cancelar aprovação":** vira tudo F · Interno, e o faturamento previsto e o valor do job mudam. |
| 5 | Categoria que entra ou sai do internacional? | **Pelo "Cancelar aprovação":** muda os totais, o valor do job e o faturamento previsto. |
| 6 | Fee/Always On com vários meses para planilha comum? | **Opção A: os meses se juntam** (para todo orçamento). Com um mês só, como o AMB-1012, é o mês que vira a planilha comum. |
| 7 | Planilha comum para Fee/Always On com período de vários meses? | Com um mês, pelo "Editar"; com mais, **pelo "Cancelar aprovação"**, para distribuir as linhas e aprovar de novo (versão aprovada com mês vazio é o que a aprovação recusa). |
| 8 | O job cancelado no "Cancelar aprovação"? | **Cancelado, fora do módulo de jobs** (já era assim pela 113), **com o código trocado** para liberar o original, que volta no próximo envio. |
| 9 | Onde fica o botão? | **Variante A do protótipo:** ao lado da versão, onde o "Cancelar aprovação" já fica quando não há job. |

## 4. Como ficou cada tela

### Orçamento com o job devolvido

- **"Editar" liberado.** O rodapé do editor fica só com o status: o
  "Arquivar" some, porque orçamento aprovado não se arquiva (118).
- **Planejado editável na planilha**, só as três colunas (R$ unitário,
  quantidade, dias/meses) e só nas linhas que já existem. Linha em save
  (na versão ou na cópia do job) e orçamento Interno continuam travados. O
  resto da planilha — orçado, nome, tipo, linha nova, ordem, save, BV —
  continua travado. Vale mês a mês no Fee e no Always On.
- **"Cancelar aprovação" ao lado da versão**, com a confirmação que diz o
  código que volta e que PP gerada precisa ser cancelada antes.
- **Barra de baixo:** sai o "Cancelar envio à abertura"; fica o "Enviar Job
  para Abertura" (reenvio). Texto: "Corrija o que o motivo acima pede e
  reenvie. Para mudar o orçado, cancele a aprovação".
- **Avisos:** o da devolução explica os dois caminhos; o verde da versão
  aprovada diz "Orçado travado · com o job devolvido, os dados do orçamento
  e o planejado podem ser corrigidos"; o de estado protegido diz o que está
  aberto.
- **Reenvio:** nome e datas do formulário saem do ORÇAMENTO, não do job —
  partir do job devolveria ao orçamento o valor de antes da correção. Data
  do evento, recebimento, descritivo e contatos seguem do job.

### Orçamento em correção (depois do "Cancelar aprovação")

- **Faixa âmbar "Em correção após a devolução do financeiro · código"**,
  com o motivo da devolução, até o novo envio. Sem ela o motivo só existiria
  no job cancelado, que não aparece em lugar nenhum.
- Na versão aprovada de novo, a barra diz "Próximo passo: reenviar o job
  código para o financeiro".
- **O formulário do envio nasce do job cancelado** (data do evento,
  recebimento, descritivo e contatos), e o campo "Código do job" diz "O mesmo
  código do job devolvido."

### Troca de planilha no "Editar" (todo orçamento)

A confirmação de sair do mensal diz agora: "Os meses se juntam numa
planilha só: os grupos e itens de todos eles passam a valer para o orçamento
inteiro, em todas as versões, e nada é apagado. Grupos com o mesmo nome em
meses diferentes ganham o nome do mês." O botão é "Sim, trocar" (não é mais
destrutivo).

## 5. Onde a regra mora

| Camada | O quê |
|---|---|
| Tela | `page.tsx` do orçamento (`correcaoLiberada`, `soPlanejado`, o job reservado), `AprovacaoActions`, `BannersEstado`/`FaixaCorrecao` e a barra em `fluxo-abertura.tsx`, `EnviarJobModal` (`codigoReaproveitado`), `ItensTable` (`soPlanejado` no `editorDe`). |
| Servidor | `atualizarOrcamento` aceita `job_criado` com o job devolvido e recusa Interno, internacional e entrada no mensal com vários meses. `atualizarCampoItem` manda o planejado da versão aprovada para a RPC. `cancelarAprovacaoDoJobDevolvido` cancela o envio com `codigo_reservado` e depois a aprovação. `enviarJobParaAbertura` (passo 6a) reaproveita o código depois de criar o job. |
| Banco | `jobs.codigo_reservado`. `reaproveitar_codigo_do_job_devolvido`: numa transação, o cancelado ganha "-C1" ("-C2"...) e o job novo fica com o código; só com a mesma sigla. `editar_planejado_do_job_devolvido`: grava a versão e a cópia do job juntas, com as recusas. `trocar_modelo_mensal_do_orcamento`: saindo do mensal, junta os meses. |
| Auditoria | `job.envio_abertura_cancelado` com `codigo_reservado: true`, `versao_orcamento.aprovacao_cancelada`, `job.codigo_reaproveitado` (código, código gerado, job cancelado), `item_versao.planejado_corrigido_na_devolucao` e `orcamento.editado` com `com_job_devolvido`. |

**Por que o código se reaproveita no envio, e não no cancelamento:** o
gerador é o maior número da sigla + 1, e o código devolvido pode ser o maior
(o AMB-1012 era o maior da AMBEV em 29/09). Renomeado no cancelamento, o
próximo job da sigla, de qualquer projeto, o pegaria. Enquanto reservado ele
fica no job cancelado; no envio, o job novo nasce com um código novo e a RPC
troca os dois. Se ela recusar, o job segue com o código com que nasceu.

## 6. O que NÃO mudou

- O "Cancelar envio à abertura" do job aguardando o financeiro (057): cancela
  e o código queima, como antes.
- A regra de "número não volta" (114) para qualquer outro job cancelado.
- A trava de PP gerada no cancelamento (057 §4).
- O financeiro continua podendo trocar categoria e serviço do job na
  abertura (055/072).

## 7. Limites conhecidos

- **Save mexido no job devolvido não volta para a versão.** Com o job
  devolvido, o save se edita direto na cópia do job (099 §11). O "Cancelar
  aprovação" (como o "Cancelar envio" de antes) devolve o consumo de save à
  versão, mas a marca de save alterada só na cópia não volta, e o job novo
  nasce da versão.
- **O código reservado tem o ano de quando nasceu:** reenviado em outro ano,
  o job mantém o "/26".

## 8. Testado (29/09/2026, no TES-P001/26 · "Orçamento de Teste")

- Aprovação da v4, envio (TES-1015/26), devolução pelo financeiro.
- Com o job devolvido: planejado (quantidade 2 → 1) gravado na versão e na
  cópia, com auditoria; orçado não abre; "Editar" recusou Interno e
  internacional com as mensagens da tela; categoria Evento → Conteúdo
  gravou; reenvio com o formulário já na categoria nova e o mesmo job.
- Segunda devolução, "Cancelar aprovação": job cancelado com
  `codigo_reservado`, orçamento e versão em revisão, faixa âmbar com o
  motivo; orçado alterado; aprovação; envio com o formulário preenchido e a
  dica do código. O job novo ficou TES-1015/26 e o cancelado TES-1015/26-C1
  (auditoria `job.codigo_reaproveitado` com o código gerado TES-1016/26).
- "Teste A" (Always On, 2 meses com itens): troca para Influencer · Ativação
  juntou os meses, 4 linhas e R$ 50.000,00 mantidos, grupos "· Outubro" e
  "· Novembro". Simulação desfeita no "Teste Always On" (3 meses, 21 linhas,
  R$ 255.000,00) antes da aplicação.
- Primeira tentativa de gravar o planejado: "permission denied for function
  orcamento_de_investimento_interno" — a RPC rodava como quem chama e usava
  uma função sem permissão para `authenticated`; consertada na `950005`.
