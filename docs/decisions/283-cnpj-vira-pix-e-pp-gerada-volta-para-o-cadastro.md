# 283 — CNPJ vira chave PIX sozinho no cadastro, e a PP gerada volta para "pelo cadastro" sem cancelar

**Data:** 2026-11-27
**Status:** aceita e implementada (27/11/2026).
**Quem decidiu:** Daniel, em 27/11/2026, a partir do caso Executar (PP-01767, 26/11/2026).
**Revê:** parcialmente a [153](153-pp-a-emitir.md) (destrava o método de pagamento na PP gerada), amplia o cadastro da [161](161-pp-por-boleto-ou-chave-aleatoria.md) com uma pré-seleção automática e refina a mensagem de "cadastro incompleto" da [166/255](166-cadastro-do-fornecedor-trava-a-pp.md).
**Migration:** nenhuma. A revisão é de código (form, action e audit log).

## O que aconteceu

26/11/2026, PP-01767 (R$ 118.970, AMB-1073/26 BRAHMA LANÇAMENTOS LATAS CARNAVAL 2027). O Produtor Responsável cadastrou o fornecedor Executar como PJ, com e-mail, telefone, regime e CNAE preenchidos. O formulário cobrou "a conta ou o PIX", o botão Salvar ficou cinza, e o atalho que ele tomou foi marcar **"Sem conta nem PIX no cadastro"** (ver 161 §3).

A marca jogou a PP pro caminho "fora do cadastro". A geração foi via Boleto (único meio que não exige chave PIX válida). O envio ao financeiro travou pedindo **NF + boleto** (161 §5) — e a Executar recebe por PIX CNPJ e não emite boleto. Fim do caminho para o usuário: a decisão 153 proíbe editar a PP gerada; cancelar implica refazer e passar pelo Comitê outra vez (R$ 118.970 ≫ limite).

Investigando, dois buracos ficaram claros:

1. **O CNPJ aparece em dois campos distintos do cadastro** — identificador fiscal e chave PIX — e o usuário razoavelmente achou que digitar no primeiro bastava. Não bastava: o seletor "Tipo de chave PIX" ficou vazio e o botão "Usar CNPJ do cadastro" só aparecia DEPOIS de escolher CNPJ no seletor.
2. **Depois da PP gerada, a produção não tinha caminho de volta.** O método de pagamento vira pedra junto com valor e cronograma (153), sem razão — valor e cronograma não mudam quando se troca só a chave PIX.

Varredura no banco em 27/11/2026: **43 fornecedores PJ** ativos estavam com "sem_dados_pagamento = true" e CNPJ válido no cadastro, 100% dos marcados. É o atalho que a decisão 161 introduziu sem contrapartida.

## A regra

1. **O CNPJ (ou CPF) entra sozinho como chave PIX no cadastro NOVO.** Pessoa jurídica abre com `pix_tipo = cnpj` pré-selecionado; pessoa física, com `cpf`. Enquanto a chave estiver vazia OU igual aos dígitos do documento, segue o documento digitado. Ao escolher outro tipo de chave (email, telefone, aleatória) ou digitar outra chave na mão, a sincronização para.
   - Vale para a página de cadastro, a edição, o "+" da PP e o pop-up do veículo da mídia — é o `FornecedorForm`.
   - O cadastro antigo que já tem PIX cadastrado NÃO é tocado. O cadastro novo com meio pré-marcado como `sem_dados_pagamento` (preMarcarSemConta da 161) também não — quem veio pedir atalho continua com o atalho.
2. **"Sem conta nem PIX" ganhou aviso contextual.** Ao marcar a opção com CNPJ válido digitado no documento, aparece "O CNPJ pode ser a chave PIX. Desmarque isto, escolha 'CNPJ' no tipo da chave acima e o sistema preenche sozinho — evita exigir boleto físico no envio da PP." Texto do próprio checkbox também ficou mais claro sobre a consequência (cada PP vai exigir boleto físico, chave aleatória ou link).
3. **A mensagem "cadastro incompleto" do servidor sugere o atalho.** Quando a pendência é "a conta ou o PIX" e o fornecedor é PJ com CNPJ válido, a mensagem acrescenta "Se o fornecedor recebe por PIX no CNPJ, escolha 'CNPJ' no tipo da chave — o sistema já preenche a chave com os dígitos." Centralizada em `mensagemCadastroIncompleto` (`lib/cadastro-do-fornecedor-na-pp.ts`), usada por `gerarPPDaPPAEmitir` e `finalizarPedidoCompraImpl`.
4. **A PP gerada volta para "pelo cadastro" sem cancelar nem reaprovar.** Novo botão ícone "Voltar para o cadastro do fornecedor" no painel, visível quando `pp.status = 'gerada'` E `pp.foraDoCadastro = true` E o usuário tem `jobs.emitir_pp` E o job aceita geração (mesmo gate de gerar). Zera `pagamento_fora_do_cadastro_*` e copia a foto atual do PIX/conta do cadastro. Valor, parcelas, fornecedor e todo o resto continuam congelados — só o canal de pagamento é reescrito.
   - Server action: `voltarPPParaPagamentoDoCadastro(ppId)` em `actions-pp.ts`.
   - Audit: `pedido_compra.pagamento_voltou_para_cadastro`, com o meio antigo em metadata.
   - O cadastro atual precisa passar em `pendenciasDoCadastroNaPP({pagaPeloCadastro: true})` — a mensagem é a mesma que o gerar cobraria, com a dica do CNPJ-vira-PIX.
5. **Trocar entre meios de FORA do cadastro continua exigindo cancelar e refazer.** Boleto → chave aleatória, link → boleto, etc., são casos raros. A revisão enxuta da 153 cobre só o "volta pro cadastro", que é o caso de 95%.

## Por que não as outras

- **Forçar CNPJ como chave PIX em todo cadastro (automático e sem checkbox):** ~10% dos fornecedores PJ têm PIX diferente do CNPJ (PIX email da empresa, chave de conta operacional específica). Sincronização silenciosa direcionaria pagamento pra chave errada. O sistema sugere; o usuário decide.
- **Liberar edição total da PP gerada:** valor e parcelas definem Comitê, trimestre contábil e cronograma de caixa. Não dá pra mexer sem reaprovação. Só o meio de pagamento é inócuo nesse sentido.
- **Rodar UPDATE em massa nos 43 PJs "sem_dados + CNPJ válido":** sem confirmar com o fornecedor que o CNPJ é a chave PIX dele, forçar os dados cria risco de pagamento errado. A limpeza acontece sob demanda: na próxima PP, o Fix 1 resolve na hora. Se o financeiro quiser um script com a lista para confirmar via WhatsApp, abre uma task à parte.

## O que não muda

- A decisão 153 continua valendo para valor, parcelas, fornecedor, item, cronograma, anexos e todo o resto. Só o canal de pagamento ("fora do cadastro" vs "pelo cadastro") ganhou um caminho de volta.
- O CHECK `pp_fora_do_cadastro_formato` do banco não muda — a action zera `pagamento_fora_do_cadastro_meio` para `null`, e o CHECK aceita null.
- "Sem conta nem PIX no cadastro" segue existindo para o fornecedor que de fato não tem PIX nem conta e vai receber por boleto/chave aleatória/guia/link a cada PP. Só ganhou aviso contextual quando o CNPJ tá digitado e seria a saída.
- O pop-up do cadastro rápido (o "+" da PP) usa o mesmo `FornecedorForm`; a pré-seleção do PIX CNPJ vale ali também.

## Onde a regra mora

| Parte | Arquivo |
| --- | --- |
| Pré-seleção `pix_tipo = cnpj/cpf` em cadastro novo | `app/(app)/fornecedores/fornecedor-form.tsx` — state inicial do `pixTipo` |
| Sincronização "chave segue o documento" | `app/(app)/fornecedores/fornecedor-form.tsx` — `useEffect` com `chaveSegueDoc` |
| Aviso no checkbox "Sem conta nem PIX" | `app/(app)/fornecedores/fornecedor-form.tsx` — bloco condicional após o label |
| Dica do CNPJ-vira-PIX no servidor | `lib/cadastro-do-fornecedor-na-pp.ts` — `dicaCnpjEhPix`, `mensagemCadastroIncompleto` |
| Chamadas de "cadastro incompleto" trocadas | `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — `gerarPPDaPPAEmitir` e `finalizarPedidoCompraImpl` |
| Server action da PP gerada | `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — `voltarPPParaPagamentoDoCadastro` |
| Botão "Voltar para o cadastro" | `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx` — `BotaoIcone` + handler `voltarParaCadastro` |
| Campo `foraDoCadastro` no `PPDoItem` | `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx` (interface) + `job-item-realizado-table.tsx` (origem) |
| Audit action nova | `lib/auth/audit.ts` — `pedido_compra.pagamento_voltou_para_cadastro` |

## Como foi testado (27/11/2026)

- `tsc` limpo, `next lint` limpo, `npm run build` limpo.
- Testes do helper em `lib/cadastro-do-fornecedor-na-pp.test.ts` — 14 passando, incluindo os 6 novos de `dicaCnpjEhPix` e `mensagemCadastroIncompleto`.
- Caso concreto: PP-01767 Executar corrigida direto no banco em 26/11/2026 (UPDATE no fornecedor + na PP). O botão "Voltar para o cadastro" passa a resolver esse mesmo caso por UI em qualquer PP gerada daqui em diante.

## Pendências

- **Trocar entre meios de FORA do cadastro** (boleto → link, link → chave aleatória, etc.) continua só por cancelar/refazer. Se aparecer demanda recorrente, faz um drawer próprio com as opções do meio.
- **Limpeza dos 43 PJs "sem_dados + CNPJ válido":** sob demanda. Lista disponível sob SQL na `fornecedores` (tenant California).
- **Forma de pagamento visível no painel da PP gerada:** hoje o painel mostra o selo da PP e os anexos; incluir "método atual: PIX CNPJ pelo cadastro" seria útil pro produtor conferir antes do envio. Entra em outra entrega.
