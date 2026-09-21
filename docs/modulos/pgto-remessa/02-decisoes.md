# 02 — Decisões (ADR log)

Decision log do módulo. Cada decisão é um ADR pequeno com: **contexto**, **decisão**, **consequências**. Ordenados cronologicamente.

Este arquivo é vivo. Não reescreve decisões antigas — cria ADR novo que substitui a anterior e faz o link.

---

## ADR 001 — Colaborador não reaproveita dados bancários via fornecedor

**Data:** 2026-09-21
**Status:** Aplicado
**Migration:** [`20260921100001_colaborador_sem_vinculo_fornecedor.sql`](../../../supabase/migrations/20260921100001_colaborador_sem_vinculo_fornecedor.sql)

### Contexto

A [migration original de RH](../../../supabase/migrations/20260916000005_rh_colaboradores.sql) criou `colaboradores.fornecedor_id` como FK opcional pra fornecedores, com o propósito documentado no comentário da coluna: *"reuso de dados bancários/PIX na baixa da folha"*. Era um atalho consciente pra não duplicar campos bancários enquanto a fase da folha era esqueleto.

Quando o módulo de pagamento por remessa começou (2026-09-21), o Antonio revisitou essa decisão. Motivação: pagamento CNAB obriga desenhar bem onde os dados bancários vivem, e a ambiguidade "colaborador PJ é fornecedor?" precisava ser resolvida antes de qualquer migration nova.

### Decisão

Colaborador ganha shape bancário próprio, sem passar por fornecedores. `colaboradores.fornecedor_id` removido do banco, da UI, do schema Zod e do tipo TypeScript.

### Justificativa

1. **Semântica diferente.** Fornecedor de produção aparece no autocomplete de Pedido de Produção; colaborador PJ **não deveria** aparecer lá. NF emitida por PJ contratado não é serviço de produção — é folha, contabilmente. Manter o link forçava um autocomplete misturado que ninguém queria.
2. **Ciclo de vida diferente.** Colaborador tem admissão, encerramento, alocação por regional/empresa, histórico salarial. Fornecedor não tem nada disso. RLS também é diferente (colaborador é `is_tenant_rh` + `is_tenant_admin`, fornecedor é `is_tenant_member`).
3. **Risco de dado divergente.** Se um freelancer virasse fornecedor **e** colaborador PJ, com dados bancários replicados nas duas tabelas, a troca de conta ficava ambígua — qual das duas atualiza? Uma fonte por papel elimina a ambiguidade.
4. **Custo mínimo agora.** 0 colaboradores tinham `fornecedor_id` preenchido em produção. Zero dado a migrar. Remoção pura, aditiva-negativa.

### Consequências

- Colaborador vai ganhar as colunas `banco_codigo`, `banco_nome`, `agencia`, `agencia_dv`, `conta`, `conta_dv`, `tipo_conta`, `pix_tipo`, `pix_chave` numa migration futura do próprio módulo (fase 1 do CNAB). Mesmo shape que fornecedor já tem — código de UI reaproveita 100%.
- Formulário de novo colaborador perdeu o auto-match por documento e os cards "Fornecedor já cadastrado" / "Criar fornecedor a partir deste cadastro". Simplificação de UX.
- Server action `buscarFornecedorPorDocumento` do módulo de RH foi removida. A função homônima no módulo de fornecedores continua existindo — é outra coisa (previne duplicata no próprio cadastro de fornecedor).
- Card "Dados do colaborador" (página de detalhe) perdeu a linha "Fornecedor vinculado".
- NF emitida por PJ contratado **não vira PP**. Vira conta avulsa gerada pela folha aprovada, quando o motor de folha for implementado — com `folha_id` e (novo campo, a criar) `colaborador_id`. Essa decisão fica registrada como implícita aqui e será formalizada em ADR próprio na fase de folha.

### Arquivos tocados no mesmo commit

Banco:
- `supabase/migrations/20260921100001_colaborador_sem_vinculo_fornecedor.sql`

TypeScript / código:
- `lib/types.ts` — campo `fornecedor_id` removido do tipo `Colaborador`
- `lib/validations/rh-colaboradores.ts` — campo `fornecedor_id` removido do schema Zod
- `app/(app)/rh/colaboradores/actions.ts` — função `buscarFornecedorPorDocumento` removida; bloco `criarFornecedor` removido; `fornecedor_id` removido do insert e do update
- `app/(app)/rh/colaboradores/colaborador-form-novo.tsx` — auto-match e cards removidos
- `app/(app)/rh/colaboradores/[id]/page.tsx` — join `fornecedor:fornecedores(id, nome)` removida do select
- `app/(app)/rh/colaboradores/[id]/card-dados.tsx` — linha "Fornecedor vinculado" e prop removidas
- `app/(app)/rh/colaboradores/[id]/editar-dados-drawer.tsx` — state e envio de `fornecedor_id` removidos

Verificação: `tsc --noEmit` limpo, `next lint` no diretório tocado limpo.

### Nota — bug detectado e corrigido pós-implementação

Após aplicar a migration 20260921100001, foi detectado que a rotina [`aprovarLinhaFolha`](../../../app/(app)/financeiro/contas-a-pagar/actions-folhas.ts) — que materializa folha aprovada em contas avulsas — usava `colab.fornecedor_id` no insert. Removida a coluna, a rotina quebraria em runtime (o `select` do PostgREST retornaria erro por coluna inexistente).

Correção estrutural (não workaround) aplicada no ADR 002 abaixo: `contas_avulsas` ganhou `colaborador_id` como destinatário-primeiro-classe, e a rotina passou a gravar `colaborador_id = colab.id` em vez do vínculo antigo. A `vw_a_pagar` foi recriada expondo a nova coluna.

O achado positivo: **o motor de folha já materializa contas avulsas** e o pagamento a colaborador não precisa mais de "conta avulsa manual" no MVP. Isso muda a resposta da pergunta original sobre destinatários (ver ADR 002).

---

## ADR 002 — Escopo do MVP + colaborador como destinatário primeiro-classe em contas_avulsas

**Data:** 2026-09-21
**Status:** Aplicado (parte estrutural) + Fechado (parte de escopo)
**Migrations:** [`20260921120001_contas_avulsas_colaborador_id.sql`](../../../supabase/migrations/20260921120001_contas_avulsas_colaborador_id.sql)

### Contexto

Duas decisões travadas na mesma sessão porque uma depende da outra:

1. Após ADR 001 remover o atalho `colaboradores.fornecedor_id`, o fluxo de folha (motor pronto, ver `00-descoberta.md §3.4`) precisava de um novo canal pra dizer *pra quem* depositar. Adiar isso quebraria a UI de aprovação de folha imediatamente.
2. O Antonio decidiu o escopo do primeiro arquivo `.REM` — quais formas de pagamento, quem é destinatário, qual empresa contábil inaugura, se retorno CNAB entra.

### Decisão — parte estrutural

`contas_avulsas` ganha `colaborador_id uuid null` referenciando `colaboradores(id)` com `ON DELETE RESTRICT`. `vw_a_pagar` expõe a coluna. `aprovarLinhaFolha` grava `colaborador_id = colab.id` em vez de `fornecedor_id = colab.fornecedor_id`.

`colaborador_id` complementa (não substitui) `fornecedor_id` e `cliente_id` — no fluxo de folha, `colaborador_id` é preenchido e os outros dois ficam null. Sem CHECK impedindo os três preenchidos ao mesmo tempo por enquanto (decisão explícita — evitar restrição prematura).

### Decisão — parte de escopo do MVP

**A. Formas de pagamento no MVP:**
- Boleto Santander (forma 30) + Boleto outros bancos (forma 31)
- PIX por chave ou dados bancários (forma 45)
- TED (forma 03)

Justificativa pra TED entrar apesar de sobrar código no gerador: 6 dos 24 fornecedores hoje não têm PIX cadastrado (só banco/agência/conta), e colaborador CLT tipicamente recebe em conta pessoal sem chave PIX. TED reusa 100% do modelo de dados dos outros (Segmentos A + B), e o incremento no gerador é ~15% (finalidade da TED + escolha de câmara CIP vs STR).

**B. Destinatários no MVP:**
- Fornecedores (24 registros, dados prontos)
- Colaboradores (via motor de folha → contas_avulsas.colaborador_id — o desenho de "conta avulsa manual" foi descartado após o achado de §3.4)

Cliente fica fora do MVP. Volta em fase 2 se surgir demanda concreta.

**C. Empresa contábil que inaugura:** California Filmes (`19437976000154`). Go Crazy e Hitlab replicam depois de homologada.

**D. Retorno CNAB (`.RET`):** fica **fora do MVP**. Baixa após pagamento continua manual — financeiro paga o arquivo no banco, confere no extrato e baixa o título no ERP. Fase 2 adiciona parse do retorno + baixa automática.

### Consequências

**Estrutural:**
- Migration 20260921120001 aplicada. Coluna, índice e view atualizados.
- `actions-folhas.ts` corrigida: `select("id, nome, tipo_contratacao")` e `insert({..., colaborador_id: colab.id, ...})`.
- `lib/types.ts` — `ContaAvulsa` ganha `colaborador_id: string | null` e `folha_id: string | null` (o segundo era inconsistência pré-existente — a coluna já existia no banco mas não no tipo).
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` — mapper explícito pro tipo `ContaAvulsa` passa a preencher as duas colunas novas.

**Escopo do MVP:**
- Colaborador **precisa ganhar shape bancário próprio** (`banco_codigo`, `agencia`, `conta`, DVs, `tipo_conta`, `pix_tipo`, `pix_chave`) — próxima migration da fase 1. Mesmo shape que fornecedor já tem.
- `empresas_contabeis` precisa ganhar config CNAB (convênio Santander, endereço, sequencial de arquivo). Só California Filmes inicialmente — as outras duas ficam com null e o gerador rejeita.
- Não vai ter tabela `cnab_retornos` no MVP. Só `cnab_remessas` e `cnab_remessas_itens`. Retorno vira estrutura na fase 2.
- Gerador precisa suportar 3 formas de pagamento (boleto/PIX/TED) na v1, mas o código compartilha a maior parte entre elas.

### Verificação

- Migration aplicada via MCP; conferido que `contas_avulsas.colaborador_id` existe, índice `idx_contas_avulsas_colaborador` existe, `vw_a_pagar` expõe a coluna.
- `tsc --noEmit` limpo após ajuste em `lib/types.ts` e `avulsa/[id]/page.tsx`.
- `next lint` limpo no diretório `app/(app)/financeiro/contas-a-pagar`.
- Fluxo de aprovação de folha volta a funcionar (não foi testado manualmente ainda em runtime — depende de linha de folha enviada + aprovação; o type-check garante que os shapes batem).

---

## ADR 003 — Fase 4 (modelagem) fechada: 3 migrations aditivas

**Data:** 2026-09-21
**Status:** Aplicado
**Migrations:**
- [`20260921140001_colaboradores_dados_bancarios.sql`](../../../supabase/migrations/20260921140001_colaboradores_dados_bancarios.sql)
- [`20260921160001_empresas_contabeis_config_cnab.sql`](../../../supabase/migrations/20260921160001_empresas_contabeis_config_cnab.sql)
- [`20260921180001_cnab_estruturas_do_arquivo.sql`](../../../supabase/migrations/20260921180001_cnab_estruturas_do_arquivo.sql)

### Contexto

Escopo do MVP definido no ADR 002 (boleto + PIX chave + TED; fornecedor + colaborador; California Filmes; sem retorno). Faltava desenhar o modelo de dados que suporta o gerador CNAB da fase 5.

### Decisão

Três migrations aditivas, cada uma independente da outra e commitável isolada. Detalhe completo em [`03-modelo-de-dados.md`](03-modelo-de-dados.md); resumo:

**4.1 — Colaborador ganha shape bancário (9 colunas).**
Mesmo shape que `fornecedores` já tem (`banco_*`, `pix_*`, `tipo_conta`). Enums reaproveitados (`tipo_conta_bancaria`, `pix_tipo_chave`), sem migration nova de tipo. Validação vive no schema Zod, não no CHECK do banco — evita restrição prematura e mantém cadastro rápido funcionando.

**4.2 — Empresas contábeis ganham config CNAB (10 colunas).**
Convênio Santander (20 pos), agência+conta de débito com DVs, sequencial de arquivo (obrigatório >= 11), endereço. Todos nullable. Só California Filmes vai ser preenchida no MVP.

**4.3 — Código de barras + tabelas de rastreio.**
- `codigo_barras text` em `pedidos_compra_parcelas` e `contas_avulsas`, com CHECK de 44 dígitos.
- `cnab_remessas` — cabeçalho por arquivo, com sequencial único por empresa contábil e hash SHA256 do conteúdo.
- `cnab_remessas_itens` — 1 linha por título incluído, com "nosso número" atribuído pelo gerador e `ocorrencia_retorno` que fica null até a fase 2 processar o `.RET`.
- RLS `is_tenant_member`; GRANT SELECT/INSERT/UPDATE `authenticated`.

### Justificativa das opções

- **Cada migration commitável isolada**: se homologação Santander falhar e tivermos que revisar layout, dá pra reverter 4.3 sem tocar em 4.1/4.2 (que servem pra outras coisas do sistema — folha, config bancária, etc).
- **Nenhum CHECK cross-tabelas**: por exemplo, "colaborador só entra em contas_avulsas se folha_id preenchido" seria útil, mas restringiria casos legítimos (repasse manual a colaborador fora de folha) e amarraria migrations futuras. Ficam como regras na server action, não no banco.
- **Enum vs text pra `status` e `origem_tipo`**: escolhido text com CHECK. Mudar valor em enum vira migration destrutiva; CHECK vira `ALTER TABLE DROP + ADD CONSTRAINT`, mais barato. Perde autocomplete no PostgREST mas ganha flexibilidade.
- **`ocorrencia_retorno` como text**: até 2 dígitos (`00`, `AT`, `HF`), mas fica text pra caber múltiplas ocorrências separadas por vírgula no futuro se preciso.
- **Sem tabela `cnab_retornos` no MVP**: retorno fica pra fase 2. Reprocessar depois é fácil — a tabela nasce, a coluna `ocorrencia_retorno` já existe pra UPDATE.

### Consequências

**Estado do módulo depois desta fase:**
- Banco pronto pra receber o gerador CNAB.
- UI: colaborador e empresa contábil já têm forms de cadastro dos dados necessários.
- Falta:
  - Backfill manual da config CNAB de California Filmes (fora de migration).
  - Backfill manual de banco/PIX dos 24 fornecedores + 1 colaborador.
  - Server action de geração de arquivo (fase 5).
  - Botão "Exportar remessa" na tela de Contas a Pagar.

**Verificação:**
- Todas as 3 migrations aplicadas via MCP, conferido via `information_schema.columns` e `information_schema.tables`.
- `tsc --noEmit` limpo.
- `next lint` limpo (warning pré-existente em `components/ui/multi-select.tsx` não é desta fase).
- 3 commits limpos no repo (`37e51c2`, `1bc43af`, `7cd9ccd`).

---

## ADR 004 — Config CNAB pertence à conta bancária, não à empresa contábil

**Data:** 2026-09-21
**Status:** Aplicado
**Migrations:**
- [`20260921200001_config_cnab_migra_para_conta_bancaria.sql`](../../../supabase/migrations/20260921200001_config_cnab_migra_para_conta_bancaria.sql)
- [`20260921200002_cnab_remessas_conta_bancaria_id.sql`](../../../supabase/migrations/20260921200002_cnab_remessas_conta_bancaria_id.sql)

### Contexto

A fase 4.2 (ADR 003) botou convênio, agência+DV, conta+DV e sequencial em `empresas_contabeis`. Ao olhar a tela de contas bancárias no dia seguinte, o Antonio pescou o erro: cada linha da tela é uma conta específica (BB California, Bradesco California, California Santander, Paypal California, Conta Teste, etc), e uma PJ contábil tem VÁRIAS contas. Convênio Santander é contratado por conta — se a California algum dia contratar um segundo convênio numa outra conta, o modelo original obrigaria duplicar em `empresas_contabeis`.

### Decisão

- **Migra** de `empresas_contabeis` pra `contas_bancarias`: `convenio_cnab_santander`, agência (+ novo `agencia_dv`), conta (+ novo `numero_conta_dv`), `sequencial_arquivo`.
- **Mantém** em `empresas_contabeis` o endereço fiscal (`endereco_logradouro`, `endereco_cidade`, `endereco_cep`, `endereco_uf`) — é característica do CNPJ, aparece no header do arquivo como identificação do titular do débito.
- **Renomeia** `cnab_remessas.empresa_contabil_id` → `cnab_remessas.conta_bancaria_id`. Cada arquivo é gerado a partir de UMA conta específica.
- **Unique constraint** de `cnab_remessas` passa a ser `(conta_bancaria_id, sequencial_arquivo)`. Cada conta tem sua própria série independente.

### Justificativa

1. **Semântica correta.** Convênio bancário é contratado por conta, não por CNPJ. A tabela `contas_bancarias` já existia justamente pra representar uma conta específica dentro de um banco, com `banco`, `agencia`, `numero_conta`, `empresa_contabil_id` FK — tudo o que faltava era complementar com DVs e config de remessa.
2. **Flexibilidade futura.** Uma PJ pode ter conta corrente Santander + conta poupança Santander, cada uma com convênio distinto. Uma PJ pode ter conta Santander + conta BB com convênios simultâneos (multi-banco na fase futura do módulo). Nas duas hipóteses, `contas_bancarias.convenio_*` funciona; `empresas_contabeis.convenio_*` obrigaria duplicação.
3. **Sequencial por conta.** O banco controla sequencial de arquivo por convênio, e convênio é por conta. Sequencial em `contas_bancarias` casa exatamente com como o banco enxerga.
4. **Custo baixo agora.** Nenhum registro em `cnab_remessas`; 1 registro de backfill em `empresas_contabeis` (California Filmes) — refeito na conta correta (`California Santander`) no mesmo commit. Endereço fiscal (Salvador/BA) permanece em `empresas_contabeis` sem mexer.

### Consequências

- Server action `salvarConfigCnabEmpresaContabil` removida. Nova `salvarConfigCnabContaBancaria` em `app/(app)/financeiro/cadastros/contas-bancarias/actions.ts`.
- Drawer `admin/empresas/contabeis/config-cnab-drawer.tsx` deletado. Novo drawer em `app/(app)/financeiro/cadastros/contas-bancarias/config-cnab-drawer.tsx`.
- Card de empresa contábil perdeu o item de menu "Configurar CNAB Santander" e o indicador verde "CNAB Santander configurado".
- Lista de contas bancárias ganhou botão de ícone Landmark na coluna de ações (verde quando configurado, cinza quando não) — só aparece quando `banco` contém "santander". Reduz ruído visual em contas de outros bancos.
- Auditoria: `empresa_contabil.config_cnab_editada` removida; `conta_bancaria.config_cnab_editada` adicionada.
- Schema Zod `configCnabSantanderSchema` renomeado para `configCnabContaBancariaSchema` e mudou de arquivo (`lib/validations/empresas-contabeis.ts` → `lib/validations/contas-bancarias.ts`). Campos renomeados: `agencia_debito`/`conta_debito` → `agencia`/`numero_conta` (reusa os nomes existentes na tabela `contas_bancarias`).
- Backfill refeito na conta `California Santander` (id `18f505b2-81ad-4076-83d7-6a020b6f79ae`) via MCP: agência 4682, conta 13005989-7, convênio 00334682004906997169, sequencial 13.

### Verificação

- Migrations aplicadas via MCP e conferidas via `information_schema`.
- `tsc --noEmit` limpo.
- `next lint` limpo nos diretórios tocados.

---

## ADR 005 — Origem "folha" separada de "avulso" em `vw_a_pagar`

**Data:** 2026-09-21
**Status:** Aplicado
**Migration:** [`20260921230001_origem_folha_em_vw_a_pagar.sql`](../../../supabase/migrations/20260921230001_origem_folha_em_vw_a_pagar.sql)

### Contexto

Quando a folha é aprovada, [`aprovarLinhaFolha`](../../../app/(app)/financeiro/contas-a-pagar/actions-folhas.ts) materializa `contas_avulsas` com `folha_id` preenchido (ADR 002). Ao consultar `vw_a_pagar`, essas linhas apareciam com `origem_tipo='avulsa'` — o CASE original só olhava `recorrente_id` (`WHEN recorrente_id IS NOT NULL THEN 'recorrente' ELSE 'avulsa'`).

Feedback do Antonio na tela de Contas a Pagar: badge "AVULSO" na coluna Origem confundia porque folha e avulsa são conceitos diferentes. O gestor precisa distinguir na hora de decidir o que exportar em remessa, e a distinção existe no dado (`folha_id`), mas não estava exposta.

### Decisão

CASE de 3 braços na view — folha ganha origem própria:

```sql
CASE
  WHEN a.folha_id IS NOT NULL THEN 'folha'
  WHEN a.recorrente_id IS NOT NULL THEN 'recorrente'
  ELSE 'avulsa'
END
```

Propagação em toda a stack:
- `OrigemTitulo` type em `lib/types.ts` ganha `"folha"`
- `origemTituloLabel` retorna `"FOLHA"`
- `CHIP_ORIGEM` em `titulos-pagar-list.tsx` ganha `{ key: "folha", label: "Folhas" }`
- `origemChipClass` retorna cor rosa (`rose-50`/`rose-700`) — separa visualmente do violeta usado pra "AVULSO"
- Contagem por origem no filtro inclui `folha: N`
- `cnab_remessas_itens.chk_origem_tipo` relaxado pra aceitar `'folha'` (era só 4 valores)
- Server action `gerarRemessaCnab` grava `origem_tipo='folha'` direto no INSERT (removido downcast pra `'avulsa'` que era workaround do CHECK antigo)
- `CnabOrigemTipo` type em `actions-cnab.ts` ganha `"folha"`

### Justificativa

1. **Semântica correta.** Folha aprovada não é despesa avulsa. Uma vem de motor de folha com rateio e histórico; a outra é lançamento manual do financeiro.
2. **UX de remessa CNAB.** Na hora de gerar `.REM`, o gestor pode filtrar "só folhas" pra pagar todos os colaboradores do mês numa leva, e "só avulsos" pra separar contas de aluguel/luz/etc.
3. **Rastreio em `cnab_remessas_itens`.** Com `origem_tipo='folha'` gravado, o histórico de remessas passa a distinguir quantos títulos por origem foram enviados — útil pra relatório futuro.
4. **Custo mínimo.** Migration ~10 linhas; propagação no código é cirúrgica (só CASE, type, labels, chip, badge). Zero backfill (a view é derivada).

### Consequências

- Contas avulsas com `folha_id IS NOT NULL` que já existiam (as 2 do teste E2E do "Teste") **automaticamente** aparecem como "FOLHA" — a view é recalculada por consulta.
- Nenhuma dupla contagem: chip "Folhas" mostra o que antes ia pra "Avulsos". Contador da aba principal (badge no tab header) permanece igual, agrupando todos.
- Lógica de estorno de compra em `page.tsx` (que filtrava por `origem === "avulso" || "recorrencia"`) foi atualizada pra incluir `"folha"` — mesmo comportamento contábil, mesma família contas_avulsas.
- Server action de remessa agora grava origem real em `cnab_remessas_itens`, sem downcast.

### Verificação

- Migration aplicada via MCP. `vw_a_pagar` recompilada; teste em SQL confirmou que as 2 contas avulsas geradas pela folha do "Teste" apareceram com `origem_tipo='folha'`.
- CHECK atualizado; INSERT de teste com `origem_tipo='folha'` aceito.
- `tsc --noEmit` limpo.
- `next lint` limpo nos diretórios tocados.

---

## ADR 006 — [reservado]

*Próxima decisão será a fase 6 (persistência do arquivo em Storage) ou a fase 2 do módulo (parse do `.RET`).*
