-- Decisão 204: regressão isolada, sem dados pessoais ou alterações persistentes.
begin;
create temporary table versoes_orcamento as select * from public.versoes_orcamento with no data;
create temporary table versoes_orcamento_itens as select * from public.versoes_orcamento_itens with no data;
create temporary table orcamentos as select * from public.orcamentos with no data;
create temporary table categorias_dominio as select * from public.categorias_dominio with no data;
create temporary table jobs_itens_realizado as select * from public.jobs_itens_realizado with no data;
create temporary table jobs_itens_orcado as select * from public.jobs_itens_orcado with no data;
create temporary table pedidos_compra as select * from public.pedidos_compra with no data;
create temporary table pp_verba_prestacoes as select * from public.pp_verba_prestacoes with no data;
-- Exercita os corpos instalados sem tocar em registros operacionais.
-- Execute após as migrations 20261021850001/2. Tudo é revertido no fim.
do $test$
declare f text; t text; fonte text;
begin
  foreach f in array array['versao_confere_limites_na_aprovacao','pp_confere_orcado_na_geracao'] loop
    fonte := pg_get_functiondef(('public.' || f || '()')::regprocedure);
    foreach t in array array['versoes_orcamento_itens','versoes_orcamento','orcamentos','categorias_dominio','jobs_itens_realizado','jobs_itens_orcado','pedidos_compra','pp_verba_prestacoes'] loop
      fonte := replace(fonte, 'public.' || t, 'pg_temp.' || t);
    end loop;
    fonte := replace(fonte, 'public.' || f, 'pg_temp.' || f);
    execute fonte;
  end loop;
end;$test$;
create trigger teste_aprovacao before update of status on pg_temp.versoes_orcamento
for each row execute function pg_temp.versao_confere_limites_na_aprovacao();
create trigger teste_geracao before insert or update of valor,item_realizado_id,tenant_id on pg_temp.pedidos_compra
for each row execute function pg_temp.pp_confere_orcado_na_geracao();
create trigger teste_reativacao before update of status on pg_temp.pedidos_compra
for each row when (old.status='cancelada' and new.status<>'cancelada')
execute function pg_temp.pp_confere_orcado_na_geracao();
create temporary table verificacoes (caso text, passou boolean);
create temporary table contexto as
  select tm.tenant_id, tm.user_id from public.tenant_members tm
  join public.profiles p on p.id=tm.user_id
  where tm.role='administrador' and tm.status='ativo' and p.ativo limit 1;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
insert into pg_temp.categorias_dominio(id,modelo_planilha) values ('00000000-0000-0000-0000-000000000001','nacional');
insert into pg_temp.orcamentos(id,tenant_id,categoria_id)
 select '00000000-0000-0000-0000-000000000002',tenant_id,'00000000-0000-0000-0000-000000000001' from contexto;
insert into pg_temp.versoes_orcamento(id,tenant_id,orcamento_id,status,percentual_honorarios,percentual_imposto)
 select '00000000-0000-0000-0000-000000000003',tenant_id,'00000000-0000-0000-0000-000000000002','rascunho',0,0 from contexto;
insert into pg_temp.versoes_orcamento_itens(id,tenant_id,versao_orcamento_id,tipo_custo,total_orcado,total_planejado,em_save)
 select '00000000-0000-0000-0000-000000000004',tenant_id,'00000000-0000-0000-0000-000000000003','B',100,70,false from contexto;
create function pg_temp.testa_aprovacao(caso text, deve_barrar boolean) returns void language plpgsql as $$
declare barrado boolean:=false;
begin
 begin
  update pg_temp.versoes_orcamento set status='aprovada';
 exception when insufficient_privilege then barrado:=true;
 end;
 if barrado <> deve_barrar then raise exception 'Falhou: % (barrado=%)',caso,barrado; end if;
 insert into verificacoes values(caso,true);
 update pg_temp.versoes_orcamento set status='rascunho';
end;$$;
select pg_temp.testa_aprovacao('GP: margem 30%',false);
update pg_temp.versoes_orcamento_itens set total_planejado=80;
select pg_temp.testa_aprovacao('GP: margem 20% exatos',false);
update pg_temp.versoes_orcamento_itens set total_planejado=80.01;
select pg_temp.testa_aprovacao('GP: margem 19,99%',true);
update pg_temp.versoes_orcamento_itens set total_planejado=101;
select pg_temp.testa_aprovacao('GP: planejado acima do orçado',true);
update pg_temp.versoes_orcamento_itens set total_planejado=0;
select pg_temp.testa_aprovacao('GP: sem planejado',false);
update pg_temp.versoes_orcamento_itens set total_planejado=90;
insert into pg_temp.versoes_orcamento_itens(id,tenant_id,versao_orcamento_id,tipo_custo,total_orcado,total_planejado,em_save)
 select '00000000-0000-0000-0000-000000000005',tenant_id,'00000000-0000-0000-0000-000000000003','B',900,0,true from contexto;
select pg_temp.testa_aprovacao('GP: save não infla margem',true);
delete from pg_temp.versoes_orcamento_itens where em_save;
update pg_temp.categorias_dominio set modelo_planilha='internacional';
update pg_temp.versoes_orcamento set percentual_honorarios=20,percentual_imposto=10,percentual_int_taxes=10,int_transaction_costs=15;
update pg_temp.versoes_orcamento_itens set total_planejado=100;
select pg_temp.testa_aprovacao('GP: internacional deduz int taxes e transação',true);
update pg_temp.versoes_orcamento_itens set total_planejado=60;
select pg_temp.testa_aprovacao('GP: internacional com margem suficiente',false);
update pg_temp.categorias_dominio set modelo_planilha='midia_off';
update pg_temp.versoes_orcamento set percentual_honorarios=20,percentual_imposto=0,base_honorarios='negociado',percentual_veiculo=80;
update pg_temp.versoes_orcamento_itens set total_planejado=0,tipo_custo='A';
select pg_temp.testa_aprovacao('GP: mídia off 20% exatos',false);
update pg_temp.versoes_orcamento set percentual_honorarios=19;
select pg_temp.testa_aprovacao('GP: mídia off abaixo de 20%',true);
update pg_temp.versoes_orcamento set percentual_honorarios=25,base_honorarios='liquido';
select pg_temp.testa_aprovacao('GP: mídia off honorários sobre líquido',false);
select set_config('request.jwt.claim.sub',(select user_id::text from contexto),true);
update pg_temp.versoes_orcamento_itens set total_planejado=999;
select pg_temp.testa_aprovacao('Admin: aceita exceções',false);
-- PP: âncora e planilha; o acumulado inclui a gerada uma única vez.
insert into pg_temp.jobs_itens_orcado(id,tenant_id,total_orcado)
 select '00000000-0000-0000-0000-000000000010',tenant_id,100 from contexto;
insert into pg_temp.jobs_itens_realizado(id,tenant_id,job_item_orcado_id,total_realizado)
 select '00000000-0000-0000-0000-000000000011',tenant_id,'00000000-0000-0000-0000-000000000010',0 from contexto;
insert into pg_temp.pedidos_compra(id,tenant_id,item_realizado_id,valor,status)
 select '00000000-0000-0000-0000-000000000012',tenant_id,'00000000-0000-0000-0000-000000000011',60,'pago' from contexto;
insert into pg_temp.pedidos_compra(id,tenant_id,item_realizado_id,valor,status)
 select '00000000-0000-0000-0000-000000000013',tenant_id,'00000000-0000-0000-0000-000000000011',41,'gerada' from contexto;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
create function pg_temp.testa_edicao(caso text, novo_valor numeric, deve_barrar boolean) returns void language plpgsql as $$
declare barrado boolean:=false;
begin
 begin
  update pg_temp.pedidos_compra set valor=novo_valor where id='00000000-0000-0000-0000-000000000013';
 exception when insufficient_privilege then barrado:=true;
 end;
 if barrado <> deve_barrar then raise exception 'Falhou: % (barrado=%)',caso,barrado; end if;
 insert into verificacoes values(caso,true);
end;$$;
select pg_temp.testa_edicao('GP: edição de 41 soma 101 com PP de 60',41,true);
select pg_temp.testa_edicao('GP: igualdade no acumulado permite',40,false);
insert into pg_temp.pedidos_compra(id,tenant_id,item_realizado_id,valor,status)
 select '00000000-0000-0000-0000-000000000014',tenant_id,'00000000-0000-0000-0000-000000000011',1000,'cancelada' from contexto;
select pg_temp.testa_edicao('GP: cancelada fora',40,false);
update pg_temp.pedidos_compra set status='rejeitada' where id='00000000-0000-0000-0000-000000000012';
select pg_temp.testa_edicao('GP: rejeitada conta',41,true);
insert into pg_temp.pp_verba_prestacoes(pedido_compra_id,valor_devolvido,status)
 values('00000000-0000-0000-0000-000000000012',1,'aprovada');
select pg_temp.testa_edicao('GP: devolução aprovada desconta',41,false);
update pg_temp.pp_verba_prestacoes set status='em_avaliacao';
select pg_temp.testa_edicao('GP: devolução pendente não desconta',41,true);
select set_config('request.jwt.claim.sub',(select user_id::text from contexto),true);
select pg_temp.testa_edicao('Admin: edição permite exceção',80,false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
update pg_temp.pedidos_compra set status='em_avaliacao' where id='00000000-0000-0000-0000-000000000013';
insert into verificacoes values('GP: envio preserva autorização da geração',true);
do $$ begin
 begin
  insert into pg_temp.pedidos_compra(id,tenant_id,item_realizado_id,valor,status)
  select '00000000-0000-0000-0000-000000000015',tenant_id,'00000000-0000-0000-0000-000000000011',1,'gerada' from contexto;
  raise exception 'Geração excedente não foi bloqueada';
 exception when insufficient_privilege then insert into verificacoes values('GP: INSERT soma todas as PPs',true);
 end;
end;$$;
select set_config('request.jwt.claim.sub',(select user_id::text from contexto),true);
insert into pg_temp.pedidos_compra(id,tenant_id,item_realizado_id,valor,status)
 select '00000000-0000-0000-0000-000000000015',tenant_id,'00000000-0000-0000-0000-000000000011',1,'gerada' from contexto;
insert into verificacoes values('Admin: INSERT acima do acumulado permitido',true);
select count(*) as verificacoes_aprovadas from verificacoes;
rollback;
