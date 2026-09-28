# Task 007 — Contratações (v1 sem integração ZapSign)

## Objetivo

Adicionar um pipeline de **Contratação** que antecede o cadastro de colaborador. Hoje um colaborador é criado direto em `/rh/colaboradores/novo`, mas na prática há uma jornada antes disso: carta proposta → aceite → coleta de dados → contrato → assinatura → efetivação. Essa jornada precisa virar um artefato do sistema pra RH acompanhar cada candidato sem planilha paralela.

Nesta v1 **não há integração com a ZapSign**. O envio do contrato pra assinatura e a coleta do PDF assinado acontecem fora do sistema (upload manual pelo RH). A integração real com a API da ZapSign é escopo separado — ver task 008.

## Contexto do ponto de partida

- Colaborador hoje nasce direto ativo via `criarColaborador` em `app/(app)/rh/colaboradores/actions.ts`.
- Existe uma UI de pendências (Fase 3 do RH, `36f2d03`) que sinaliza dados faltantes — a contratação **preenche** a maioria desses dados antes do colaborador nascer, então quando efetivar o candidato ele já entra "sem pendências críticas".
- Não há tabela de candidatos, propostas, ou anexos de contrato.
- Não há página pública sem login no ERP hoje — todas as pages exigem `requireSession()`.

## Decisões travadas com o Antonio em 2026-09-29

1. **Nome do módulo: "Contratação"** (não "Proposta", "Onboarding" ou "Admissão").
2. **v1 completa com link público pro candidato**. Sem login pra ele.
3. **Tabela nova `contratacoes` isolada** de `colaboradores`. Só migra pra `colaboradores` quando assina e o RH efetiva.
4. **Recusa e desistência são status separados**:
   - `recusada` = candidato disse não antes de assinar
   - `desistiu` = aceitou mas não assinou até o prazo
5. **Proposta traz cargo, salário e data de admissão** — só isso o candidato vê na carta. Empresa, regional, tipo de contratação, nível e área ficam no back-office.
6. **Sem ZapSign nesta v1**. Fluxo do contrato:
   - RH clica "Gerar contrato" → sistema monta o PDF/documento com os dados coletados.
   - RH baixa e envia manualmente pra ZapSign fora do sistema.
   - Depois que o candidato assina lá, RH baixa o PDF assinado da ZapSign.
   - RH anexa o PDF assinado no sistema.
   - RH clica "Contratar" → vira colaborador.
7. **Prazo do link público: 14 dias**, renovável pelo RH.
8. **Card KPI novo em `/rh`**: "Contratações em andamento". Não altera "Colaboradores ativos".

## Decisões PENDENTES (travar antes de implementar)

- **Como o sistema "monta o contrato"?**
  - (A) Template `.docx` ou `.html` versionado no repositório com placeholders (`{{nome}}`, `{{cpf}}`, `{{salario}}`, etc.). Sistema preenche e gera PDF via biblioteca (ex: pdfmake, docx templater). RH baixa o PDF pronto.
  - (B) Sistema mostra os dados coletados numa página imprimível. RH copia/cola num Word externo e edita à vontade. Mais burro mas zero risco.
  - Recomendação: **(A) com um template fixo por tipo de contratação** — CLT tem cláusulas diferentes de PJ. Se não tiver template pronto, começa com (B) e evolui.
- **Envio da carta proposta é email automático ou link copiado?**
  - Se automático: precisa SMTP (Resend? SendGrid?). Verificar se o projeto já tem provedor configurado pra outros fluxos.
  - Se manual: RH copia o link `/proposta/[token]` da tela e manda por WhatsApp/email pessoal.
  - Recomendação: **manual na v1** — evita dependência nova; automático entra junto com o ZapSign na task 008.

## Entregas

### Banco

Migration `contratacoes`:

- Tabela `contratacoes`:
  - Identidade e trilha: `id`, `tenant_id`, `created_by`, `created_at`, `updated_at`.
  - Proposta (candidato vê): `nome`, `email`, `cargo`, `salario_proposto`, `data_admissao`.
  - Interno (RH define): `empresa_id`, `regional_id`, `tipo_contratacao`, `nivel_id`, `area`.
  - Coletado no aceite (candidato preenche): `cpf`, `cnpj`, `telefone`, `data_nascimento`, `banco_codigo`, `agencia`, `agencia_dv`, `conta`, `conta_dv`, `tipo_conta`, `pix_tipo`, `pix_chave`.
  - Estado: `status contratacao_status`, `motivo_recusa`, `motivo_desistencia`.
  - Datas por etapa: `proposta_enviada_em`, `aceite_em`, `dados_completados_em`, `contrato_gerado_em`, `contrato_assinado_anexado_em`, `efetivada_em`.
  - Link público: `token` (unique), `token_expira_em`.
  - Anexos: `contrato_gerado_path` (PDF que o sistema gerou), `contrato_assinado_path` (PDF que voltou da ZapSign).
  - Conversão final: `virou_colaborador_id` (FK → colaboradores, nullable).
- Enum novo `contratacao_status`:
  ```
  rascunho, proposta_enviada, aceite_recebido, dados_completos,
  contrato_gerado, contrato_assinado, efetivada,
  recusada, desistiu, expirada
  ```
- CHECKs de formato: mesmos do `colaboradores` pra CPF (11), CNPJ (14), telefone (10 ou 11).
- Unique `token`.
- RLS: `is_tenant_admin OR is_tenant_rh` pra select/insert/update. Delete admin-only. **Token flow (público) usa service client** — página pública valida token e só lê linha específica sem RLS.
- Bucket novo no Supabase Storage: `contratacoes-anexos` (privado). Paths: `{tenant_id}/{contratacao_id}/contrato-gerado.pdf` e `.../contrato-assinado.pdf`.

### Types + validação

- `lib/types.ts`: `Contratacao`, `ContratacaoStatus`.
- `lib/validations/rh-contratacoes.ts`:
  - `criarContratacaoSchema` — RH define proposta + campos internos.
  - `salvarDadosCandidatoSchema` — candidato preenche (só CPF/CNPJ/tel/nascimento/bancário).
  - `motivoTextoSchema` — recusar/desistir com motivo curto.

### Server actions (`app/(app)/rh/contratacoes/actions.ts`)

- `criarContratacao` — cria em `rascunho`, gera token.
- `enviarProposta` — status vira `proposta_enviada`, grava `proposta_enviada_em`. (v1 sem email; retorna o link pro RH copiar.)
- `renovarLink` — gera novo token, estende `token_expira_em`.
- `gerarContrato` — gera o PDF (ver decisão pendente A vs B), salva em `contrato_gerado_path`, status vira `contrato_gerado`.
- `anexarContratoAssinado` — RH faz upload do PDF assinado, salva em `contrato_assinado_path`, status vira `contrato_assinado`.
- `efetivar` — cria `colaboradores` + `colaboradores_alocacoes` + `colaboradores_salarios`, preenche `virou_colaborador_id`, status vira `efetivada`.
- `marcarDesistiu` — RH marca com motivo, status vira `desistiu`.

### Server actions públicas (`app/(auth-public)/proposta/actions.ts` ou similar)

- `aceitarProposta(token)` — status vira `aceite_recebido`.
- `recusarProposta(token, motivo)` — status vira `recusada`.
- `salvarDadosCandidato(token, dados)` — status vira `dados_completos`.
- Todas validam `token` e `token_expira_em` antes de tocar em qualquer coisa. Usam service client (não RLS).

### UI RH

- **`/rh/contratacoes`** (lista/kanban por status). Filtro por status, busca por nome/cargo. Card por candidato com status atual e dias no status.
- **`/rh/contratacoes/nova`** — form de criação (nome, email, cargo, salário, data admissão, empresa, regional, tipo, nível, área).
- **`/rh/contratacoes/[id]`** — detalhe com trilha, os dados coletados até então, os anexos, e o botão da próxima ação (muda conforme status). Botões contextuais:
  - `rascunho`: **Enviar proposta** (mostra o link pra copiar).
  - `proposta_enviada`: **Renovar link** / **Marcar recusada**.
  - `aceite_recebido`: aguarda candidato preencher; mostra o form status.
  - `dados_completos`: **Gerar contrato**.
  - `contrato_gerado`: **Anexar contrato assinado** / **Regenerar contrato** / **Marcar desistiu**.
  - `contrato_assinado`: **Efetivar** (converter em colaborador) / **Marcar desistiu**.
  - `efetivada`: mostra link pro `/rh/colaboradores/[virou_colaborador_id]`.
- **Menu `/rh`**: item novo "Contratações" **antes** de "Colaboradores".
- **Card KPI** no hub `/rh`: "Contratações em andamento".

### UI pública (sem login)

- **`/proposta/[token]`** — Server Component que valida token via service client e renderiza:
  - Se `proposta_enviada`: cara da carta com botões Aceitar / Recusar.
  - Se `aceite_recebido`: form de dados do candidato.
  - Se `dados_completos` ou depois: tela de espera "Aguarde o RH gerar o contrato".
  - Se `expirada` ou token inválido: mensagem "Link expirado, procure o RH".
- **Sem sidebar, sem header do ERP**. Layout próprio, branding California mas página standalone.

### Expiração automática

- **v1**: cron não precisa. Página pública mostra "expirada" quando `now() > token_expira_em`; status no banco só muda quando o RH abre a contratação e o sistema atualiza (job simples via server action ao carregar detalhe).
- **v2 (task 008 ou separada)**: pg_cron diário marca `expirada` em massa.

## Pontos que ficam pra depois

- Integração ZapSign (task 008).
- Envio automático de email da proposta (parte da task 008 ou task própria).
- Cron de expiração em lote.
- Template de contrato por tipo de contratação — v1 pode ter 1 só.
- Métricas de conversão (quantos aceitam / quantos desistem).
- Auditoria detalhada (quem clicou em quê) — só o essencial na v1: `created_by` + `efetivada_por`.

## Como fica visualmente pro Antonio ler

Ao terminar a task, o cenário-teste é:

1. RH cria contratação pra "Fulano de Tal", cargo "Gerente de Projetos", salário R$ 10k, data admissão 2026-11-01, empresa California, regional SP, tipo CLT.
2. RH clica "Enviar proposta" → aparece link `https://.../proposta/xyz123` na tela pra copiar.
3. Abre o link em janela anônima → vê a proposta. Aceita.
4. Preenche CPF, telefone, nascimento, dados bancários.
5. Volta na tela do RH → status `dados_completos`. Clica **Gerar contrato** → baixa PDF preenchido.
6. Sobe manualmente pra ZapSign (fora do sistema). Fulano assina lá.
7. RH baixa o PDF assinado da ZapSign, volta ao sistema, clica **Anexar contrato assinado** → upload.
8. Clica **Efetivar** → Fulano vira colaborador ativo em `/rh/colaboradores/[novo_id]` com CPF/telefone/banco/salário/alocação todos preenchidos, **sem pendência crítica**.
