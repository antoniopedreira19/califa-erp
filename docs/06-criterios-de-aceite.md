# Critérios de Aceite do MVP Inicial

## Fundação e login

- Aplicação roda localmente.
- Projeto está versionado no GitHub quando o repositório for inicializado.
- Login com Supabase Auth funciona.
- Existe tenant inicial Agência California.
- Usuário administrador está vinculado ao tenant inicial.
- Rotas privadas bloqueiam usuário sem sessão.
- Usuário inativo não acessa o sistema.
- Administrador tem MFA obrigatório.
- `SUPABASE_SERVICE_ROLE_KEY` não aparece no bundle client-side.
- Eventos de login e logout são auditados.
- RLS impede acesso a dados de tenant sem vínculo.
- Existe documentação de permissões por perfil.
- Nenhuma tabela operacional nova existe sem RLS.

## Clientes

- Usuário cria cliente.
- Cliente é gravado com `tenant_id`.
- Cliente referencia o tenant por FK.
- Usuário edita cliente.
- Usuário inativa cliente.
- Listagem possui busca.
- Sistema evita duplicidade evidente por CNPJ.

## Fornecedores

- Usuário cria fornecedor.
- Fornecedor é gravado com `tenant_id`.
- Fornecedor referencia o tenant por FK.
- Usuário edita fornecedor.
- Usuário inativa fornecedor.
- Listagem possui busca.
- Sistema evita duplicidade evidente por CPF/CNPJ.

## Orçamentos

- Usuário cria orçamento vinculado a cliente.
- Orçamento é gravado com `tenant_id`.
- Orçamento referencia tenant, cliente e GP por FK.
- Orçamento possui status.
- Orçamento lista suas versões.
- Orçamento mostra qual versão está aprovada, quando existir.
- Enquanto o orçamento não tiver versão aprovada, nenhum job é criado.
- Banco usa `orcamentos` como etapa anterior ao job, não tabela `pre_jobs`.

## Versões de orçamento

- Usuário cria versão v1.
- Versão e itens são gravados com `tenant_id`.
- Versão referencia tenant e orçamento por FK.
- Item de versão referencia tenant, versão e fornecedor quando houver.
- Usuário cria v2, v3 etc.
- Sistema não permite duas versões aprovadas para o mesmo orçamento.
- Usuário adiciona itens manualmente.
- Usuário importa planilha padrão.
- Sistema preserva arquivo original importado.
- Usuário exporta uma versão do orçamento em planilha.
- Planilha exportada pode ser enviada ao cliente fora do sistema.
- Sistema calcula totais a partir dos itens.
- Sistema permite aprovar uma versão.
- Aprovação atualiza `orcamentos.versao_aprovada_id`.
- Aprovação gera evento de auditoria.

## Criação do job

- Ao aprovar uma versão, o sistema exige criação do job.
- Job só é criado a partir de orçamento aprovado.
- Job é gravado com `tenant_id`.
- Job referencia tenant, orçamento, versão aprovada, cliente e GP por FK.
- `jobs.orcamento_id` é obrigatório.
- `jobs.versao_orcamento_aprovada_id` é obrigatório.
- Banco impede dois jobs para o mesmo orçamento.
- Criação do job grava `jobs.orcamento_id`.
- Criação do job atualiza `orcamentos.status` para `job_criado`.
- Criação do job gera evento de auditoria.

## GitHub e Vercel

- `.env.local` não está versionado.
- `.env.example` existe sem secrets reais.
- Build da Vercel está configurado.
- Variáveis de ambiente necessárias estão documentadas.
- Migrations do Supabase estão versionadas.
- Deploy de produção vem de branch controlada.

## Fora de escopo validado

- Planejado.
- Realizado.
- Contas a pagar.
- Contas a receber.
- DRE.
- Rentabilidade final.
