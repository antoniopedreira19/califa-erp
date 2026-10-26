-- Decisão 212, complemento (26/10/2026): o tipo das chaves PIX que já
-- estavam no cadastro de freelas e não se deduziam pela regra da 193.
--
-- A 20261026500001 deu o tipo a 136 chaves e deixou 45 sem tipo (13 de
-- freelas ativos), para o RH escolher no editar. O Tiago pediu para o banco
-- preencher o que a chave já diz, sem trabalho retroativo. Cada uma das 45
-- tem uma só leitura possível, conferida contra o próprio cadastro:
--   - CNPJ: os números são o CNPJ do próprio freela (7, todos com texto
--     junto da chave, como "CNPJ" — por isso a 193 não deduzia).
--   - CPF: os números são o CPF do próprio freela e o CPF é válido (4, com
--     texto junto da chave).
--   - Telefone: 11 números com DDD e 9 na frente, que NÃO formam um CPF
--     válido — então não podem ser chave de CPF (34; 31 são o celular do
--     próprio cadastro; os 3 que não batem com o celular são de freelas
--     encerrados, 1 deles com "tel" escrito na chave).
-- Uma chave que fosse ao mesmo tempo CPF válido e celular, e não fosse o
-- CPF da pessoa, ficaria sem tipo (não há nenhuma em 26/10).
--
-- Só preenche coluna vazia: nenhuma chave é reescrita (a função
-- `pix_do_cadastro_do_freelancer` tira o texto e normaliza ao ler). O
-- "atualizado em" não muda: o gatilho fica desligado durante o update.
-- Resultado esperado: os 59 freelas ativos com chave (de 64) vão
-- automáticos para a PP de verba (eram 46); os outros 5 não têm PIX.

alter table public.freelancers disable trigger trg_freelancers_updated_at;

with b as (
  select f.id,
         regexp_replace(f.pix_chave, '\D', '', 'g') as d,
         regexp_replace(coalesce(f.cpf, ''), '\D', '', 'g') as cpf,
         regexp_replace(coalesce(f.cnpj, ''), '\D', '', 'g') as cnpj
    from public.freelancers f
   where f.pix_tipo is null
     and nullif(btrim(f.pix_chave), '') is not null
),
c as (
  select b.*,
         case
           when length(b.d) = 11 and b.d !~ '^(\d)\1{10}$' then
             ((select sum(substr(b.d, i, 1)::int * (11 - i)) from generate_series(1, 9) i) * 10 % 11 % 10)
               = substr(b.d, 10, 1)::int
             and ((select sum(substr(b.d, i, 1)::int * (12 - i)) from generate_series(1, 10) i) * 10 % 11 % 10)
               = substr(b.d, 11, 1)::int
           else false
         end as cpf_valido
    from b
),
t as (
  select c.id,
         case
           when c.cnpj ~ '^\d{14}$' and c.d = c.cnpj then 'cnpj'
           when c.cpf ~ '^\d{11}$' and c.d = c.cpf and c.cpf_valido then 'cpf'
           when c.d ~ '^[1-9]{2}9\d{8}$' and not c.cpf_valido then 'telefone'
         end as tipo
    from c
)
update public.freelancers f
   set pix_tipo = t.tipo::public.pix_tipo_chave
  from t
 where t.id = f.id
   and t.tipo is not null
   and f.pix_tipo is null;

alter table public.freelancers enable trigger trg_freelancers_updated_at;
