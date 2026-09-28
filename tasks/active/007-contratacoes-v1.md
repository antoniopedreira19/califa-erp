# Task 007 — Contratações (v1 sem integração ZapSign)

## Objetivo

Adicionar um pipeline de **Contratação** que antecede o cadastro de colaborador. Hoje um colaborador é criado direto em `/rh/colaboradores/novo`, mas na prática há uma jornada antes disso: carta proposta → aceite → coleta de dados → contrato → assinatura → efetivação. Essa jornada precisa virar um artefato do sistema pra RH acompanhar cada candidato sem planilha paralela.

Nesta v1 **não há integração com a ZapSign**. O envio do contrato pra assinatura e a coleta do PDF assinado acontecem fora do sistema (upload manual pelo RH). A integração real com a API da ZapSign é escopo separado — ver task 008.

## Contexto do ponto de partida

- Colaborador hoje nasce direto ativo via `criarColaborador` em `app/(app)/rh/colaboradores/actions.ts`.
- Existe UI de pendências (Fase 3 do RH, `36f2d03`) que sinaliza dados faltantes — a contratação **preenche** a maioria desses dados antes do colaborador nascer, então quando efetivar o candidato ele já entra "sem pendência crítica".
- Não há tabela de candidatos, propostas ou anexos de contrato.
- Não há página pública sem login no ERP hoje — todas as pages exigem `requireSession()`.
- Existe o modelo de contrato PJ da California (versão 2025) em PDF — usado como referência do template.

## Decisões travadas

Alinhado com o Antonio em 2026-09-29 (versão final):

1. **Nome do módulo: "Contratação"** (não "Proposta", "Onboarding" ou "Admissão").
2. **v1 completa com link público pro candidato**. Sem login pra ele.
3. **Tabela nova `contratacoes` isolada** de `colaboradores`. Só migra pra `colaboradores` quando assina e o RH efetiva.
4. **Recusa e desistência são status separados**:
   - `recusada` = candidato disse não antes de assinar
   - `desistiu` = aceitou mas não assinou
5. **Proposta traz cargo, salário e data de admissão** — só isso o candidato vê na carta. Empresa, regional, tipo de contratação, nível e área ficam no back-office.
6. **Sem ZapSign nesta v1**. Fluxo:
   - RH clica "Gerar contrato" (só se PJ) → sistema monta o PDF via template versionado.
   - RH baixa e envia manualmente pra ZapSign fora do sistema.
   - Candidato assina lá.
   - RH baixa o PDF assinado e anexa no sistema.
   - RH clica "Efetivar" → vira colaborador.
7. **Prazo do link público: 14 dias**, renovável pelo RH.
8. **Card KPI novo em `/rh`**: "Contratações em andamento". Não altera "Colaboradores ativos".
9. **RG é obrigatório desde a contratação.** Novo campo em `colaboradores` (nullable no banco, obrigatório app-level pra novos cadastros e pro contrato PJ). Candidato preenche em `/proposta/[token]`.
10. **Endereço completo é obrigatório desde a contratação.** 7 campos (CEP, logradouro, número, complemento, bairro, cidade, UF), todos migram pro colaborador na efetivação. Complemento é opcional; resto obrigatório pra PJ (pra bater com o contrato).
11. **CLT bifurca o fluxo.** Contratação CLT/estágio pula "Gerar contrato" (a contabilidade envia externo) — vai direto de `dados_completos` pra "Anexar contrato assinado". Só PJ (`pj`/`clt_recibo` + as 5 naturezas) tem o botão "Gerar contrato" habilitado.
12. **5 naturezas de PJ** cobrem o universo: `mei`, `me`, `ltda`, `eireli`, `slu`. Cada uma tem um texto próprio que aparece no contrato. Mapa em `lib/rh/naturezas-pj.ts`, versionado no repo.
13. **Geração de PDF: `@react-pdf/renderer`**. Roda em Vercel serverless sem Chromium, sub-segundo, layout controlável. Template vira um componente React tipado (`_template/contrato-pj.tsx`) — diff no PR fica legível.
14. **Envio da carta proposta: manual na v1.** RH copia o link `/proposta/[token]` e manda por fora. Envio automático via Resend/SMTP entra na task 008 ou task própria.

## Escopo de banco

### Migration 1 — colaboradores ganha RG + endereço + razão social + natureza PJ

```
alter table public.colaboradores
  add column rg              text,
  add column razao_social    text,
  add column pj_natureza     public.pj_natureza,
  add column cep             text,
  add column logradouro      text,
  add column numero          text,
  add column complemento     text,
  add column bairro          text,
  add column cidade          text,
  add column uf              text;
```

Novo enum `pj_natureza`: `mei | me | ltda | eireli | slu`.

CHECKs de formato:
- `cep ~ '^[0-9]{8}$'` quando não null.
- `uf ~ '^[A-Z]{2}$'` quando não null.
- `rg` texto livre (RG não tem formato nacional; varia por estado). Limite 20 chars.

Sem NOT NULL nos campos novos — os 204 legados continuam válidos. Régua "está preenchido?" fica no schema Zod + no helper de pendências (Nível 2 pra todos exceto CNPJ+razao_social+pj_natureza que continuam Nível 1 críticos pra PJ).

### Migration 2 — cria contratacoes + enum + trigger

```
create type public.contratacao_status as enum (
  'rascunho',
  'proposta_enviada',
  'aceite_recebido',
  'dados_completos',
  'contrato_gerado',
  'contrato_assinado',
  'efetivada',
  'recusada',
  'desistiu',
  'expirada'
);

create table public.contratacoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id),
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Carta proposta (candidato vê)
  nome                  text not null,
  email                 text not null,
  cargo                 text not null,
  salario_proposto      numeric(12,2) not null check (salario_proposto > 0),
  data_admissao         date not null,

  -- Interno RH (candidato não vê)
  empresa_id            uuid not null references public.empresas(id),
  regional_id           uuid references public.regionais(id),
  tipo_contratacao      public.tipo_contratacao not null,
  nivel_id              uuid references public.niveis(id),
  area                  text,
  pj_natureza           public.pj_natureza,       -- só se PJ

  -- Dados coletados no aceite (candidato preenche)
  cpf                   text,
  cnpj                  text,
  razao_social          text,
  rg                    text,
  telefone              text,
  data_nascimento       date,
  cep                   text,
  logradouro            text,
  numero                text,
  complemento           text,
  bairro                text,
  cidade                text,
  uf                    text,
  banco_codigo          text,
  banco_nome            text,
  agencia               text,
  agencia_dv            text,
  conta                 text,
  conta_dv              text,
  tipo_conta            public.tipo_conta_bancaria_fornecedor,
  pix_tipo              public.pix_tipo_chave,
  pix_chave             text,

  -- Estado
  status                public.contratacao_status not null default 'rascunho',
  motivo_recusa         text,
  motivo_desistencia    text,

  -- Datas por evento
  proposta_enviada_em   timestamptz,
  aceite_em             timestamptz,
  dados_completados_em  timestamptz,
  contrato_gerado_em    timestamptz,
  contrato_assinado_anexado_em timestamptz,
  efetivada_em          timestamptz,

  -- Link público
  token                 text not null unique,
  token_expira_em       timestamptz not null,

  -- Anexos (paths no bucket)
  contrato_gerado_path    text,
  contrato_assinado_path  text,

  -- Conversão final
  virou_colaborador_id  uuid references public.colaboradores(id) on delete set null
);
```

Mesmos CHECKs de formato que `colaboradores`. FK composta `(regional_id, empresa_id) → regionais(id, empresa_id)` pra garantir que a regional pertence à empresa.

Índices:
- `idx_contratacoes_tenant_status` — filtro na lista.
- `idx_contratacoes_token` — lookup público.

RLS:
- `select/insert/update`: `is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)`.
- `delete`: admin only.
- **Endpoints públicos** (aceitar/recusar/salvar dados) rodam via **service_role client** — não passam por RLS. Validam token no server antes de qualquer operação.

Bucket novo no Supabase Storage:
- `contratacoes-anexos` (privado).
- Paths: `{tenant_id}/{contratacao_id}/contrato-gerado.pdf` e `.../contrato-assinado.pdf`.
- Policy: só admin/rh do tenant lê. Escrita idem.

## Types + validação

Arquivos novos:

- `lib/types.ts` — adiciona `Contratacao`, `ContratacaoStatus`, `PjNatureza`, novos campos de `Colaborador` (rg, razao_social, pj_natureza, 7 endereço).
- `lib/validations/rh-contratacoes.ts`:
  - `criarContratacaoSchema` — proposta + interno RH.
  - `salvarDadosCandidatoSchema` — cpf/cnpj/rg/telefone/nascimento/endereço/bancário.
  - `motivoTextoSchema` — recusar/desistir (mínimo 3 chars).
- `lib/rh/naturezas-pj.ts`:
  ```ts
  export const NATUREZA_PJ_LABEL = { ... };  // pra UI
  export const NATUREZA_PJ_TEXTO_CONTRATO = {
    mei:    "MEI – Microempreendedor Individual inscrita no CNPJ sob o nº",
    me:     "microempresa inscrita no CNPJ sob o nº",
    ltda:   "sociedade empresária limitada, inscrita no CNPJ sob o nº",
    eireli: "EIRELI – Empresa Individual de Responsabilidade Limitada, inscrita no CNPJ sob o nº",
    slu:    "sociedade limitada unipessoal, inscrita no CNPJ sob o nº",
  };
  ```

## Server actions do RH (`app/(app)/rh/contratacoes/actions.ts`)

- `criarContratacao(formData)` — cria em `rascunho`, gera token 32 chars via crypto.
- `enviarProposta(id)` — status vira `proposta_enviada`, grava timestamp. Retorna o link pro RH copiar.
- `renovarLink(id)` — gera novo token, `token_expira_em = agora + 14 dias`.
- `gerarContrato(id)` — só habilitado se `tipo_contratacao ∈ {pj, clt_recibo}` E `pj_natureza` preenchido. Gera PDF via componente React-PDF, sobe pro bucket, status vira `contrato_gerado`.
- `anexarContratoAssinado(id, file)` — RH faz upload do PDF assinado; salva em `contrato_assinado_path`; status vira `contrato_assinado`.
- `efetivar(id)` — cria `colaboradores` + `colaboradores_alocacoes` + `colaboradores_salarios` copiando todos os dados; preenche `virou_colaborador_id`; status vira `efetivada`. Trilha completa preservada.
- `marcarDesistiu(id, motivo)` — status vira `desistiu`.
- Fluxo CLT: `dados_completos` → botão "Anexar contrato assinado" direto (sem "Gerar contrato" no meio).

Todas registram audit event.

## Server actions públicas (`app/proposta/[token]/actions.ts`)

Rodam com **service client**, sem RLS. Validam token + expiração antes de qualquer operação.

- `aceitarProposta(token)` — status `proposta_enviada` → `aceite_recebido`.
- `recusarProposta(token, motivo)` — status `proposta_enviada` → `recusada`.
- `salvarDadosCandidato(token, dados)` — status `aceite_recebido` → `dados_completos`. Valida CPF sempre; CNPJ + razão social + natureza PJ se tipo é PJ.

## UI

### RH

**`/rh/contratacoes`** — lista/kanban:
- Colunas: Aguardando aceite, Aguardando dados, Aguardando contrato, Aguardando assinatura, Finalizadas.
- Card: nome, cargo, empresa, dias no status atual, indicador de urgência (vermelho se > 7 dias).
- Filtros: status (multi), tipo de contratação, empresa, busca por nome.

**`/rh/contratacoes/nova`** — form:
- Passo único, todos os campos internos do RH:
  - Nome, email, cargo, salário, data admissão (carta proposta).
  - Empresa, regional, tipo de contratação, nível, área (interno).
  - Se PJ: dropdown `pj_natureza` obrigatório.

**`/rh/contratacoes/[id]`** — detalhe:
- Cabeçalho com nome + status + trilha temporal.
- Cards de "Dados coletados" (aparece progressivamente conforme candidato preenche).
- Anexos: contrato gerado (baixar), contrato assinado (baixar/anexar).
- Botão contextual conforme status:
  - `rascunho` → **Enviar proposta**
  - `proposta_enviada` → mostra o link + **Copiar link** + **Renovar link** + **Marcar recusada**
  - `aceite_recebido` → apenas exibe "Aguardando candidato preencher"
  - `dados_completos` → **Gerar contrato** (se PJ) ou **Anexar contrato assinado** (se CLT)
  - `contrato_gerado` → **Baixar contrato** + **Anexar contrato assinado** + **Regenerar contrato** + **Marcar desistiu**
  - `contrato_assinado` → **Efetivar** + **Marcar desistiu**
  - `efetivada` → link pro colaborador criado.

### Menu do RH

Adiciona **Contratações** entre "Home RH" e "Colaboradores".

### Público

**`/proposta/[token]`** — Server Component:
- Layout standalone (sem sidebar, sem header do ERP).
- Branding California (logo, cor).
- Server valida token via service client + checa `token_expira_em > now()`.
- Estados:
  - `proposta_enviada`: mostra cargo, salário, data admissão, empresa. Botões **Aceitar** e **Recusar**.
  - `aceite_recebido`: form de dados do candidato (CPF, telefone, nascimento, endereço, banco/PIX, RG, se PJ CNPJ+razão social+natureza).
  - `dados_completos`, `contrato_gerado`, `contrato_assinado`: tela de agradecimento + status atual ("O RH está preparando seu contrato", etc.).
  - `efetivada`: mensagem "Bem-vindo à California!".
  - `recusada` / `desistiu` / `expirada` / token inválido: mensagem "Link inválido ou expirado. Procure o RH."

## Gerador de PDF

Deps novas:
- `@react-pdf/renderer`
- `extenso` (número por extenso pro valor mensal)

Arquivos:
- `app/(app)/rh/contratacoes/_template/contrato-pj.tsx` — componente `<ContratoPJ contratacao={...} />`.
- `app/(app)/rh/contratacoes/_template/estilos.ts` — StyleSheet compartilhado (fontes, margens, header/footer).
- `lib/rh/gerar-contrato-pj.ts` — função pura que recebe `Contratacao`, resolve placeholders + texto da natureza + valor por extenso, chama `renderToBuffer` e devolve Buffer.

Layout do contrato:
- Página A4, margem 25mm.
- Header: logo California + linha divisória.
- Corpo: cláusulas numeradas (14 no total, seguindo o modelo).
- Placeholders resolvidos:
  - `[cargo]` → `contratacao.cargo`
  - `NOME DO COLABORADOR` → `contratacao.nome`
  - `RG nº xx.xxx.xxx.x` → `contratacao.rg`
  - `CPF sob o nº` → `contratacao.cpf` formatado
  - `ENDEREÇO` → montado a partir dos 7 campos
  - `RAZÃO SOCIAL` → `contratacao.razao_social`
  - Bloco natureza PJ → `NATUREZA_PJ_TEXTO_CONTRATO[contratacao.pj_natureza]`
  - `CNPJ sob o nº` → `contratacao.cnpj` formatado
  - Valor + extenso → `R$ 5.500,00 (cinco mil e quinhentos reais)`
  - `DATA DE ADMISSÃO` → formatada em pt-BR
  - Banco / Ag. / CC. → `contratacao.banco_codigo / agencia-dv / conta-dv`
- Footer: endereço agência + numeração "Página X de Y".

## Card KPI e integração ao hub

- Novo card em `/rh` **"Contratações em andamento"**: conta status em `('proposta_enviada','aceite_recebido','dados_completos','contrato_gerado','contrato_assinado')`. Link pra `/rh/contratacoes`.
- Não altera cards existentes.

## Expiração automática

- **v1**: sem cron. Página pública mostra "expirada" quando `now() > token_expira_em`. Server action ao carregar a lista/detalhe faz update lazy do status pra `expirada` quando detecta.
- **v2**: pg_cron diário marca `expirada` em lote (fora do escopo desta task).

## O que fica fora do escopo (task 008 ou futura)

- Integração ZapSign (envio via API + webhook).
- Envio automático de email da proposta (Resend/SMTP).
- Cron de expiração em lote.
- Métricas de conversão.
- Edição de proposta após enviar (só permite reenvio ou cancelamento).
- Múltiplos templates de contrato (v1 tem um só, o de PJ).

## Subtasks de execução

Ordem de implementação (commit ao final de cada, checkpoint pra retomar depois se necessário):

- [x] **Subtask 0** — Task documentada + Migration 1. Commits `200c522` e `3ea2e00`.
- [x] **Subtask 1** — Fundação (schema, tipos, naturezas-pj, Zod). Commit `d8a9c11`.
- [x] **Subtask 2** — Server actions internas do RH. Commit `2986291`.
- [x] **Subtask 3** — Server actions públicas do candidato. Commit `77395c2`.
- [x] **Subtask 4** — UI RH (lista, nova, detalhe + rota API pra PDF). Commit `2d805e2`.
- [x] **Subtask 5** — UI pública `/proposta/[token]` com layout standalone. Commit `ecb7e3c`.
- [x] **Subtask 6** — Gerador de PDF com @react-pdf/renderer. Commit `cf8c296`.
- [ ] **Subtask 7** — Card KPI + integração no hub RH.

## Cenário de aceite

Ao terminar a task, o cenário-teste é:

1. RH cria contratação pra "Fulano de Tal", cargo Gerente de Projetos, salário R$ 10k, admissão 2026-11-01, California/SP, tipo PJ, natureza LTDA.
2. RH clica "Enviar proposta" → aparece link `https://sistemacalifa.com.br/proposta/xyz123` na tela.
3. Abre o link em janela anônima → vê a carta proposta. Aceita.
4. Preenche CPF, CNPJ, razão social, RG, telefone, nascimento, endereço completo, dados bancários.
5. RH abre a contratação → status `dados_completos`, todos os dados aparecem no detalhe. Clica **Gerar contrato** → baixa PDF preenchido, com todos os placeholders resolvidos e texto de LTDA no bloco natureza.
6. RH sobe manualmente pra ZapSign, Fulano assina lá.
7. RH baixa o PDF assinado, volta ao sistema, clica **Anexar contrato assinado**.
8. Clica **Efetivar** → Fulano vira colaborador ativo em `/rh/colaboradores/[novo_id]` com CPF/CNPJ/RG/endereço/telefone/banco/salário/alocação todos preenchidos, **sem pendência crítica**. A contratação fica em `efetivada` com o `virou_colaborador_id` apontando pra ele.
