# 00 — Descoberta do Módulo RH

## Objetivo deste documento

Retratar o RH da California como ele é hoje, **antes de qualquer decisão de modelagem**. Este documento não decide nada. Ele **captura**. Serve de base para `01-visao-geral.md` (escopo) e `03-modelo-de-dados.md` (tabelas).

## Escopo desta descoberta

- Inventário das abas da planilha atual.
- Colunas observadas em cada aba.
- Atores do processo.
- Integrações identificadas com módulos que já existem no ERP (empresas gerenciais, fornecedores, contas a pagar).
- Dores conhecidas.
- **Questões abertas** a resolver antes de fechar a visão.

## Fora desta descoberta

- Modelagem de tabelas.
- Escopo do MVP.
- Cronograma de fases.
- Decisões técnicas (roles, RLS, integração final).

Tudo isso vem depois, nos documentos seguintes.

---

## 1. Estado atual do RH

O RH da California hoje roda **inteiramente numa planilha Excel** com múltiplas abas. Não há sistema. A administradora financeira/RH (Kika) é a fonte-verdade do processo, roda a folha manualmente, aplica benefícios, controla férias e turnover.

### 1.1 Abas identificadas

| Aba | Função |
|---|---|
| **Colaboradores** | Cadastro mestre de colaboradores (ativos e inativos) |
| **Férias 2026** | Controle de férias por ano |
| **Movimentação Salarial** | Histórico de mudanças de salário |
| **Turnover** | Registro de entradas e saídas |
| **Benefícios** | Vínculo colaborador ↔ benefício com valores |
| **Detalhe41-PRODUÇÃO** | Folha de pagamento (parece ser por competência — investigar) |

Nem todas foram inventariadas em detalhe nesta rodada. Ver **§4 Questões abertas**.

---

## 2. Inventário por aba

### 2.1 Aba Colaboradores

Cadastro mestre. Colunas observadas:

| Col | Nome | Conteúdo observado |
|---|---|---|
| B | Urso(s) | Nome do colaborador |
| C | Status | `Ativo` / `Inativo` |
| D | Gênero | `F` / `M` |
| E | Empresa | `California` / `CCH` / `CSC` |
| F | Centro de Custo (fin) | `CCH SE` / `SP` / `NE` / `HUB` / `CCH Doca` / (vazio) |
| G | Empresa Detalhe | `AMBEV` / `GERAL` / `CREATORS` / (vazio) |
| H | Tipo de Contratação | `PJ` / `CLT` / `CLT + Recibo` / `Estágio` |
| I | Data de Início | Data |
| J | Data Encerramento | Data (vazio se ativo) |
| K | Função | Cargo (`Gerente de Projetos`, `Filmmaker`, `Social Media`, `Diretor de Arte`, `Estagiária do financeiro`, etc.) |
| L | Nível | `N3` / `N4` / `N5` / (vazio) |

**Observação:** a coluna A tem um marker/ícone visual (vazio no rendering), aparentemente usado para destaque. Não é dado.

### 2.2 Aba Detalhe41-PRODUÇÃO (folha mensal)

Parece ser folha de uma competência específica. O nome sugere que existem outras abas (`Detalhe01`, `Detalhe02`... — a investigar). Colunas observadas:

| Col | Nome | Conteúdo |
|---|---|---|
| A | ID | Sequencial da linha |
| B | Nome dos Colaboradores | Nome |
| C | Salário base | Valor |
| D | Dias base | Inteiro (30) |
| E | salário final | Valor calculado |
| F | Admissão | Data (redundante com aba Colaboradores) |
| G | Cargo | Texto (redundante com aba Colaboradores) |
| H | Desconto Total Pass | Valor |
| I | Desconto Plano SulAmérica Saúde - Titular | Valor |
| J | Desconto Plano SulAmérica Saúde - Dependente | Valor |
| K | Saúde Coparticipação (Amil) | Valor |
| L | Desconto Plano Ondo Bradesco - Titular | Valor |
| M | Desconto Plano Ondo Bradesco - Dependente | Valor |
| ... | (colunas seguintes truncadas na visualização) | ? |

Colunas prováveis não vistas: outros benefícios, INSS/FGTS/IRRF para CLT, valor líquido, banco/conta destino, status pagamento.

### 2.3 Abas ainda não inventariadas

Precisam de leitura na próxima rodada:

- **Férias 2026** — como registra período aquisitivo, gozo, saldo, abono, atrasados
- **Movimentação Salarial** — estrutura (uma linha por mudança? aprovação? motivo?)
- **Turnover** — o que grava além de admissão/demissão da aba Colaboradores (motivo? tipo? rescisão?)
- **Benefícios** — catálogo dos benefícios existentes + quem tem cada um (matriz colaborador × benefício)

---

## 3. Atores identificados

| Ator | Papel no RH | Papel no ERP hoje |
|---|---|---|
| Kika (adm. financeira/RH) | Mantém planilha, roda folha, controla benefícios, cadastra colaborador | Ainda não é usuária do ERP |
| Gerentes | Consomem dados (rentabilidade por nível/cargo) | Já usam ERP (jobs, orçamentos) |
| Colaboradores | Passivos hoje | Não têm acesso |
| Contabilidade externa | Recebe folha para gerar guias (GPS/DARF) | Fora do ERP |

**Nota:** só Antonio tem acesso ao ERP hoje. Bruno e demais GPs ainda não foram convidados (ver `docs/HANDOFF.md` §6). O RH vai forçar a entrada de pelo menos mais 1 usuária (Kika) e possivelmente da contabilidade.

---

## 4. Integrações com o que já existe no ERP

### 4.1 Empresas gerenciais (`empresas`)
- Colaborador tem coluna **Empresa** com valores `California` / `CCH` / `CSC` — mesmas empresas gerenciais que já existem no sistema.
- Vínculo natural: `colaboradores.empresa_id → empresas.id` NOT NULL.

### 4.2 Fornecedores (`fornecedores`)
- Colaborador PJ (majoritário — ~70% da planilha) é pago via nota. O CNPJ e dados bancários já estão (ou deveriam estar) no cadastro de fornecedores.
- Vínculo natural: `colaboradores.fornecedor_id → fornecedores.id` **nullable** — só faz sentido para PJ/MEI.
- Reaproveitamento crítico: na baixa da folha, os dados bancários vêm do fornecedor sem duplicação.

### 4.3 Contas a pagar (`contas_avulsas` + `vw_a_pagar` + `dar_baixa_avulsa_com_plano`)
- O ERP já tem um motor de contas a pagar unificado (Tela 3.2 — ver `supabase/migrations/20260817000004_titulos_a_pagar.sql`).
- `contas_avulsas` cobre "obrigações pendentes fora de PP" e já tem tudo que a folha precisa: valor, natureza, data prevista/pagamento, plano de contas, empresa, fornecedor opcional.
- `vw_a_pagar` une PP + avulsas — a folha entra na Tela 3.2 **sem código novo**, apenas gerando avulsas em lote.
- Ciclo de aprovação e baixa (via `dar_baixa_avulsa_com_plano`) já valida conta bancária, plano de contas, empresa da conta vs empresa do lançamento.

### 4.4 Plano de contas (`plano_contas_tipos` + `plano_contas_subtipos`)
- Já existem subtipos de "Despesa Pessoal" (ver `20260827000006_plano_contas_subtipos_despesa_pessoal.sql`) — provavelmente cobrem salário CLT, salário PJ, encargos, benefícios.
- A folha vai apenas **classificar cada avulsa** no subtipo correto por tipo de contratação e natureza do valor (salário base vs benefício vs encargo).

### 4.5 Auditoria (`audit_events`)
- Já existe RPC `log_audit_event`. Todo evento sensível de RH (contratação, demissão, mudança de salário, rodada de folha) vai por ali.

### 4.6 Storage
- Padrão de bucket privado por tenant já está estabelecido (`orcamento-importacoes`, `pedidos-compra`, `contas-avulsas`). NFs/Recibos de PJ e anexos de folha vão seguir o mesmo padrão em bucket próprio (`rh-anexos` ou similar).

---

## 6. Direção fechada — Rodada 1 da descoberta

Decisões travadas com Antonio/Daniel nesta primeira rodada de conversa. Vira base direta do `03-modelo-de-dados.md`.

### 6.1 Alocação é multidimensional, simultânea e histórica

- Colaborador se aloca no par **(empresa, regional)** — nada de dimensão "divisão" ou "centro de custo". Sistema opera só com `empresas` e `regionais` que já existem.
- **N alocações vigentes ao mesmo tempo** para o mesmo colaborador (ex.: 60% California-SP + 40% CCH-Doca).
- Alocação muda no tempo → timeline com `data_inicio` e `data_fim` nullable (NULL = vigente).
- **Rateio entre alocações é percentual explícito** (`percentual numeric(5,2)`). RH define; financeiro pode ajustar antes de aprovar a folha. Constraint: soma dos percentuais das linhas vigentes = 100% por colaborador em cada instante.

### 6.2 Modelo em duas camadas

**Camada 1 — Alocação vigente (`colaboradores_alocacoes`)** — mantida pelo RH:
- Linha por (colaborador, empresa, regional, período)
- Várias linhas podem coexistir sem `data_fim`
- Fonte-verdade da pergunta *"onde está hoje?"*

**Camada 2 — Snapshot da folha (`folhas_pagamento_alocacoes`)** — imutável após aprovação:
- Nasce copiando o vigente do RH no momento da geração da folha
- Editável **só** pelo financeiro, **só** antes de aprovar/pagar
- Fonte-verdade da pergunta *"onde estava em jan/2026?"*
- Base para o rateio da(s) avulsa(s) que a folha gera em contas a pagar

**Consequência:** correção do financeiro no snapshot de janeiro não reescreve a alocação vigente do RH, e mudança na vigente do RH em fevereiro não bagunça o snapshot de janeiro. Cada camada tem uma responsabilidade só.

### 6.3 Salário é histórico desde o MVP — e histórico = movimentação salarial

- Nasce como tabela `colaboradores_salarios`. **Uma linha por mudança de salário.**
- Cada linha é uma **movimentação salarial** — não existe tabela separada para "movimentações". Registrar aumento de R$ 3.000 → R$ 4.000 = fechar a linha antiga (`data_fim`) e abrir uma nova com R$ 4.000; o delta R$ 1.000 é derivado da comparação com a linha anterior.
- Campos previstos: `colaborador_id`, `valor`, `data_inicio`, `data_fim` nullable, `motivo` opcional (dissídio, promoção, reclassificação, etc.), `aprovado_por` opcional, `criado_por`, `created_at`.
- Salário atual = derivado (linha com `data_fim IS NULL`).
- **Folha congela o salário no snapshot** — mesma lógica da alocação.
- **Tela de "movimentação salarial"** (visualização temporal com filtros por período/motivo/gerente) é uma UI que **lê essa tabela**. Se for necessária no MVP, entra na fase de tela; a estrutura de dados já suporta.

### 6.4 Regional "GERAL" por empresa (para colaborador transversal)

- Alguns colaboradores da planilha atual têm CC vazio (Cristiana Kika, Marina, Fabia). Perfil transversal (backoffice, financeiro, TI).
- Decisão: `alocacoes.regional_id` fica **NOT NULL** para manter consistência com o resto do sistema (jobs e orçamentos já exigem regional).
- Migration desta fase cria uma regional **"GERAL"** em cada empresa que ainda não tem, para abrigar esses transversais.

### 6.5 Dimensão "Empresa Detalhe" (AMBEV/GERAL/CREATORS) fica fora do MVP

- A coluna Empresa Detalhe da planilha atual (AMBEV para conta dedicada, CREATORS para squad, etc.) **não entra no modelo agora**. Kika e time seguem controlando externamente se necessário.
- Se voltar como necessidade, entra em fase futura como dimensão da alocação (não do colaborador — o mesmo colaborador pode ter alocações em contas diferentes).

### 6.6 Nível é cargo, não faixa salarial

- **`niveis` é catálogo tenant-wide** (tabela dedicada) — `N3`, `N4`, `N5` e futuros (`N1`, `N2`, `N6`+).
- Nível define **hierarquia de cargo**, não faixa salarial. Um Gerente de Projetos N3 é mais júnior que um N5. Não há regra de "N4 ganha entre R$X e R$Y".
- Colaborador tem `nivel_id` (FK nullable — estagiários e alguns cargos não têm nível).
- CRUD do catálogo entra em `/cadastros/niveis` no MVP, no mesmo padrão de `categorias`, `regionais`, etc.

### 6.7 CPF/CNPJ vive no colaborador; fornecedor é link opcional

**Achados do banco (via MCP, `20260916`):**
- Já existem 24 fornecedores, todos com `cpf_cnpj` preenchido (21 PJ + 3 PF).
- 21 de 24 têm PIX cadastrado — mecanismo de pagamento dominante.
- **Cruzamento com a planilha de colaboradores mostra baixa sobreposição** — só ~5 nomes batem. A maior parte dos colaboradores PJ **ainda não é fornecedor** no ERP.

**Decisão:**
- `colaboradores.cpf_cnpj text` — mesma unified column dos fornecedores, mesma regra de formato (11 dig PF, 14 dig PJ, CHECK derivado de `tipo_contratacao`).
- `colaboradores.fornecedor_id uuid nullable` — link opcional pra fornecedor existente (reuso de dados bancários/PIX na baixa da folha).
- **Auto-match no form:** ao digitar CPF/CNPJ, sistema verifica em `fornecedores` do mesmo tenant e oferece "vincular" se já existir.
- **Criar-fornecedor-num-click:** para colaborador PJ novo, o form oferece "cadastrar também como fornecedor" (bota nome + CNPJ + dados bancários no cadastro de fornecedor de tabela). Como a maioria dos PJs ainda não é fornecedor, isso é caminho comum, não edge case.
- Unique index `(tenant_id, cpf_cnpj)` só quando não NULL — evita duplicação no RH.
- **Sem** unique cruzada entre `colaboradores.cpf_cnpj` e `fornecedores.cpf_cnpj` — o link é explícito via FK, não implícito por documento.

### 6.8 Plano de contas já está pronto (nada a criar)

Confirmado via MCP: `plano_contas_tipos` já tem "Despesa com Pessoal" com 14 subtipos completos (Salário 001, Benefícios 002, Bonificação 003, 13° 004, Estagiário 005, Férias 006, FGTS 007, INSS 008, IR Retido 009, Outros 010, ProLabore 011, Processo trabalhista 012, Rescisão 013, Transporte 014).

Quando a folha for gerar contas avulsas, cada linha se auto-classifica num destes — nenhum subtipo novo precisa ser criado pelo módulo RH.

### 6.9 Alocação inspirada em `empresa_members` (precedente do sistema)

A tabela `empresa_members` (68 linhas hoje) já usa o padrão de "usuário aloca em N empresas × regionais" com FK direta. `colaboradores_alocacoes` segue o mesmo molde, adicionando:

- `regional_id` NOT NULL (não nullable como em members) — com fallback "GERAL"
- `percentual` (rateio, ausente em members)
- `data_inicio`, `data_fim` (histórico, ausente em members — members é sempre vigente)

Serve como precedente arquitetural — não estamos inventando padrão novo.

### 6.11 Role `rh` nasce dedicado no MVP

- Novo valor `rh` no enum `app_role` (aditivo, sem risco). Enum atual: `administrador`, `gerente_producao`, `financeiro`, `produtor`, `freelancer`.
- Helper `is_tenant_rh(uuid)` criado no padrão do `is_tenant_admin` — mesma estrutura, só troca o filtro de role.
- Acesso à rota `/rh` e a todas as tabelas do módulo (`niveis`, `colaboradores`, `colaboradores_alocacoes`, `colaboradores_salarios`, `folhas_pagamento`, `folhas_pagamento_alocacoes`) é **restrito a `administrador` OU `rh`** — RLS e guard de rota.
- `financeiro` não acessa nada do RH no MVP. Quando o motor da folha existir, uma migration aditiva alarga o SELECT para incluir `financeiro` (leitura do snapshot da folha) sem quebrar nada.
- Roles operacionais (`gerente_producao`, `produtor`, `freelancer`) não veem RH.

### 6.12 Fora deste MVP (fase futura, um subsistema por vez)

- **Dependentes** de plano de saúde
- **Benefícios** (catálogo + vínculo colaborador↔benefício)
- **Férias** (período aquisitivo/concessivo, gozo, abono)
- **Turnover / rescisão** detalhada (motivo, valores, aviso prévio)
- **Folha mensal completa** (geração/aprovação/pagamento — só a estrutura das camadas 1 e 2 está prevista aqui; o motor da folha é subsistema próprio)
- **NFs/Recibos** por competência para PJs
- **Encargos CLT** (INSS/FGTS/IRRF)
- **Autoserviço do colaborador** (holerite, pedido de férias) — colaborador segue passivo no MVP

**Não confundir com fase futura:** o histórico salarial (§6.3) já cobre movimentação salarial **como dado**. A pergunta em aberto pra Bloco 2 é se a **tela dedicada de movimentação** vale entrar no MVP ou fica pra depois.

---

## 7. Dores conhecidas (a expandir)

Levantamento inicial — precisa validação com Kika/Antonio:

- Planilha compartilhada é **fonte única de erro**: mudança de estrutura por engano quebra fórmulas.
- Não há **histórico auditável** de mudança de salário — a linha é sobrescrita.
- Cálculo de folha manual: risco de erro humano em desconto de benefício.
- NFs de PJ chegam por e-mail/WhatsApp — sem rastreabilidade centralizada por competência.
- Folha vira contas a pagar via digitação manual no financeiro — retrabalho e risco.
- Férias controladas em outra aba, desconectadas da aba Colaboradores.
- Sem visibilidade para gerentes: "quantos colaboradores tenho em CCH SE?" exige abrir Excel.

---

## 8. Questões abertas

Preencher antes de fechar `01-visao-geral.md`. Numeradas para referência futura. Marcadas com ✅ quando resolvidas em rodada de discovery — o texto original fica preservado para rastreabilidade.

### Sobre estrutura de dados

- **Q1.** ~~`Centro de Custo (fin)` (CCH SE, SP, NE, HUB, CCH Doca) — é catálogo com uso em outros relatórios (DRE, rentabilidade de job)? Ou é dimensão exclusiva do RH? Aparece na aba Folha?~~ → ✅ **Decidida (Rodada 1, §6.1)**: dimensão CC sai do modelo. Sistema opera só com `empresas` + `regionais`.
- **Q2.** ~~`Empresa Detalhe` (AMBEV, GERAL, CREATORS) — o que representa?~~ → ✅ **Decidida (Rodada 1, §6.5)**: dimensão fica fora do MVP. Se voltar, entra como dimensão da alocação em fase futura.
- **Q3.** ~~`Nível` (N3/N4/N5) — existe tabela de faixa salarial vinculada?~~ → ✅ **Decidida (Rodada 1, §6.6)**: `niveis` é catálogo tenant-wide de **hierarquia de cargo** (não faixa salarial). CRUD em `/cadastros/niveis`. `colaboradores.nivel_id` FK nullable.
- **Q4.** ~~Existe **CPF** e/ou **CNPJ** guardado hoje em algum lugar?~~ → ✅ **Decidida (Rodada 1, §6.7)**: CPF/CNPJ vive em `colaboradores.cpf_cnpj` (unified) com auto-match e criação-num-click de fornecedor. `fornecedor_id` FK nullable como link opcional. Achados via MCP em §6.7 justificam.
- **Q5.** ~~**Dependentes** (para plano de saúde) — quantos são normalmente? Guardar nome/CPF ou só a contagem? Impacto no cálculo do desconto.~~ → ✅ **Decidida (Rodada 1, §6.5)**: modelagem de dependentes fica para fase futura junto com benefícios/plano de saúde.

### Sobre processos

- **Q6.** Movimentação salarial — cada mudança gera linha nova, ou sobrescreve? Existe **fluxo de aprovação** (gerente pede → Kika/Antonio aprovam)?
- **Q7.** Férias — controle é por **período aquisitivo/concessivo** (padrão CLT), ou simplificado por "quantos dias já tirou no ano"? Tem **abono pecuniário** (venda de 10 dias)? Como registra **atrasado** (vencido)?
- **Q8.** Turnover — só data de entrada/saída? Ou grava **motivo** (pedido de demissão, dispensa com/sem justa causa, término de contrato), **rescisão** (valores, aviso prévio)?
- **Q9.** Benefícios — o catálogo (Total Pass, SulAmérica, Bradesco Ondo, Amil) é **fixo** ou muda com frequência? Quais são **gratuitos** (empresa paga 100%)? Quais têm **coparticipação** (funcionário paga parte)?
- **Q10.** NFs/Recibos de PJ — como chegam hoje (e-mail, Drive, WhatsApp)? Upload no sistema seria **por competência** ou avulso? Anexo é obrigatório para liberar pagamento?
- **Q11.** Folha mensal — em que dia do mês é rodada? Quais são as **rubricas variáveis** (adiantamento, hora extra, comissão, prêmio)? **13º**, **férias** e **rescisão** entram na mesma folha ou em folhas separadas?
- **Q12.** Encargos CLT — INSS/FGTS/IRRF são calculados na planilha ou por outra ferramenta (contabilidade externa)? A guia (GPS/DARF) fica anexada em algum lugar hoje?

### Sobre acesso e sistema

- **Q13.** Colaborador vai virar **usuário do ERP** (para ver holerite, pedir férias)? Ou só admin/RH acessa dados de RH?
- **Q14.** Novo role `rh` ou `admin_rh` deve nascer, ou usa `administrador` no início?
- **Q15.** **LGPD/confidencialidade** — quem pode ver salário? Gerente pode ver salário do seu time? Só Kika/Antonio? Regra de RLS específica.
- **Q16.** Migração da planilha — importar de uma vez na primeira carga, ou começar do zero e migrar aos poucos?

---

## 9. Próximos passos

1. **Finalizar Bloco 1 do Rodada 1** — responder Q2 (Empresa Detalhe), Q3 (Nível), Q4 (CPF/CNPJ).
2. **Rodada 2 do discovery** — responder as questões de processos e acesso (§8 Q6–Q16), fotografar as abas restantes (Férias, Movimentação Salarial, Turnover, Benefícios) e apurar a estrutura da folha.
2. **`01-visao-geral.md`** — consolidar objetivo, escopo do MVP, fora de escopo e princípio de evolução do módulo.
3. **`02-escopo-por-fase.md`** — quebrar o módulo em subsistemas com ordem de dependência.
4. **`03-modelo-de-dados.md`** — modelar as tabelas por subsistema, uma migration por fase.
5. **`04-fluxos-operacionais.md`** — cadastro, benefícios, folha, rescisão.
6. **`06-integracao-financeiro.md`** — como a folha aprovada gera lote de `contas_avulsas`.
7. **`07-decisoes.md`** — registrar as decisões que resolvem as questões abertas (uma seção por Q).

Só depois do passo 4 aprovado é que a **primeira migration** entra no repositório.
