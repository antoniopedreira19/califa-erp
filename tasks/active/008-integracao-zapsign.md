# Task 008 — Integração com ZapSign no fluxo de contratação

## Objetivo

Automatizar o pedaço do fluxo de Contratação (task 007) que hoje é manual: envio do contrato pra assinatura + recebimento do PDF assinado. Com esta task, o RH clica "Enviar pra assinatura" no sistema, o ZapSign é acionado via API, o candidato recebe o email direto da ZapSign, assina, e o sistema é notificado por webhook — status muda automaticamente e o PDF assinado entra sozinho no storage.

Dependência: **task 007 concluída** (o modelo de contratação e o fluxo manual já em produção).

## Contexto do ponto de partida

Assumindo a task 007 fechada:
- Existe tabela `contratacoes` com todos os estados.
- Botão "Gerar contrato" gera o PDF no storage.
- Botão "Anexar contrato assinado" é upload manual.
- Botão "Efetivar" converte em colaborador.

Esta task substitui os dois botões do meio por um único **"Enviar pra ZapSign"**, e adiciona webhook que fecha o loop.

## Decisões pendentes (travar no início da task)

- **Conta ZapSign do tenant** — cadastrada em `.env` global ou por-tenant no banco? Se for por-tenant, precisa tabela `integracoes_zapsign` (empresa_id, api_token). Se global, uma env server-only basta.
- **Plano ZapSign suporta webhook?** Free geralmente não; PRO+ sim. Confirmar antes de investir.
- **Template do contrato no sistema ou no ZapSign?**
  - Se no sistema: continua gerando PDF via `gerarContrato` e mandando o binário pra ZapSign como documento novo.
  - Se no ZapSign: cria template lá com placeholders, sistema só manda os valores.
  - Recomendação: **manter no sistema** — versionamento do template fica no repo.

## Entregas previstas

### Banco

- Adicionar colunas em `contratacoes`:
  - `zapsign_documento_id text` — id do doc na plataforma.
  - `zapsign_signer_token text` — token do assinante (pra rastreio).
  - `zapsign_url_assinatura text` — URL pra o candidato assinar (mostrada no `/proposta/[token]` do candidato).
  - `zapsign_webhook_recebido_em timestamptz`.
- Status novo no enum: `enviado_pra_assinatura` (entre `contrato_gerado` e `contrato_assinado`).

### Env

- `ZAPSIGN_API_TOKEN` (ou por-tenant, ver decisão pendente).
- `ZAPSIGN_WEBHOOK_SECRET` — pra validar HMAC do webhook.

### Server actions

- `enviarParaAssinatura(contratacaoId)` — pega o PDF de `contrato_gerado_path`, POST na ZapSign, grava `zapsign_documento_id` + `zapsign_url_assinatura`, status vira `enviado_pra_assinatura`.
- `sincronizarStatusZapsign(contratacaoId)` — poll manual pra caso o webhook não chegue (botão de fallback pro RH).

### Endpoint público

- `POST /api/webhooks/zapsign` — valida HMAC com `ZAPSIGN_WEBHOOK_SECRET`, encontra a contratação pelo `zapsign_documento_id`, baixa o PDF assinado, salva em `contrato_assinado_path`, status vira `contrato_assinado`, grava `zapsign_webhook_recebido_em`.

### UI

- Detalhe da contratação: substitui os botões manuais por **Enviar pra assinatura** (após gerar contrato) e um card mostrando status ZapSign + link de acompanhamento.
- Página pública `/proposta/[token]` no status `enviado_pra_assinatura`: mostra botão "Assinar contrato" que redireciona pra `zapsign_url_assinatura`.

### Envio de email da proposta (bônus)

Se o SMTP provider (Resend/SendGrid) for configurado nesta task, aproveitar pra também enviar o email da carta proposta automaticamente ao criar (substitui o "copiar link" manual da v1).

## Pontos que ficam pra depois

- Templates ZapSign nativos (se a decisão pendente virar "manter no ZapSign").
- Múltiplos assinantes (avalista, testemunha, etc.).
- Reenvio programado quando candidato não assina em X dias.
