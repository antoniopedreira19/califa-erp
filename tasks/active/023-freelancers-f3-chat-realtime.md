# Task 023 — Freelancers (Fase 3, bônus): chat realtime no popover

## Objetivo

Adicionar o chat realtime GP ↔ RH no popover de solicitação criado na Task 021. Esta é a última peça da Fase 3.

Entrega:
1. Server actions `enviarMensagemSolicitacao` e `marcarMensagensComoLidas`.
2. Componente `ChatSolicitacao` client que carrega mensagens iniciais, assina Realtime pra receber novas e marca como lida ao abrir.
3. Badge de "não lidas" na tabela de solicitações consumindo a RPC `get_freelancer_solicitacao_mensagens_nao_lidas`.
4. Integração no `PopoverSolicitacao` como uma seção adicional.

## Fora de escopo

- Notificação sonora ou push — fica pra depois.
- Editar/deletar mensagem — não existe no AgCaliforniaRH, não adicionar.
- Chat na rota pública do freelancer — Fase 3 cobre só o chat interno.

## Decisões travadas

- **Realtime via `supabase.channel(...).on("postgres_changes")`** — mesmo padrão de `job-chat-section.tsx`.
- **Mensagens iniciais** vêm do server component (já que popover é client, as mensagens vêm como prop vinda da page).
  - Alternativa: client faz fetch inicial. Mais simples; vou de client fetch inicial pra evitar cascata de props server→client.
- **Marcar como lida ao abrir popover**: `upsert` em `freelancer_solicitacao_mensagens_leituras` com `last_read_at=now()`. Server action chamada no `useEffect` quando o popover abre.
- **Badge de não lidas**: busca total via RPC no server component da lista; renderiza badge pequeno antes do nome na linha. Clique = abre popover + reseta.
- **Atualização otimista do envio**: mostra a mensagem imediatamente no array local; se realtime devolver duplicada, dedup pelo `id`.
- **Autor "você" vs outros**: alinhamento à direita quando `autor_id === userId`, à esquerda quando outro.

## Contexto do ponto de partida

- Tabela `freelancer_solicitacao_mensagens` com realtime habilitado (Task 020).
- Tabela `freelancer_solicitacao_mensagens_leituras` (Task 020).
- RPC `get_freelancer_solicitacao_mensagens_nao_lidas` (Task 020).
- Popover de solicitação já renderiza dados e ações (Task 021).

## Escopo

### 1. Arquivos novos

```
app/(app)/freelancers/solicitacoes/_components/
└── chat-solicitacao.tsx            # Client: lista + input + realtime + leitura
```

### 2. Arquivos modificados

- `app/(app)/freelancers/solicitacoes/actions.ts` — adicionar `enviarMensagem` e `marcarComoLida`.
- `app/(app)/freelancers/solicitacoes/_components/popover-solicitacao.tsx` — renderizar `<ChatSolicitacao />`.
- `app/(app)/freelancers/solicitacoes/_components/solicitacoes-tabela.tsx` — recebe `naoLidasPorSolicitacao` como prop e renderiza badge.
- `app/(app)/freelancers/solicitacoes/page.tsx` — chama a RPC e passa o map pro componente.

## Critérios de pronto

- [ ] Chat aparece no popover das solicitações.
- [ ] Envio de mensagem via Enter ou botão; aparece imediatamente (otimista) e para os outros via realtime.
- [ ] Marcar como lida acontece ao abrir o popover.
- [ ] Badge de não lidas aparece na tabela, some depois de abrir.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.
