/**
 * Read-only diagnostic reproducer for the bugs listed in ../upstream-alignment.md.
 * Run inside the existing JL3 dev container. Uses synthetic providers, fake secrets,
 * in-memory DB mocks and loopback HTTP; never reads credentials or connects to production.
 * Assertions confirm the recorded current state: BUG-01/02/03/04/05/08/09 are fixed,
 * BUG-06/07 are retained pending separate scope. Never run on production.
 */
process.env.NODE_ENV='test';
const reviewRoot = process.env.LITELLM_TS_REVIEW_ROOT || require('node:path').resolve(__dirname, '../..');
process.chdir(reviewRoot);
require(process.cwd()+'/node_modules/ts-node').register({transpileOnly:true,project:process.cwd()+'/tsconfig.json'});
const assert=require('node:assert/strict');
const path=require('node:path');
const load=(f)=>require(path.join(process.cwd(),'src',f));
const {Router}=load('router/Router.ts');
const {buildStreamWithTtft}=load('router/RouterStreamWrapper.ts');
const {mapToApiError}=load('core/api/ErrorResponseMapper.ts');
const {checkBudget}=load('auth/AuthChecks.ts');
const {AuthorizationGuard}=load('auth/AuthorizationGuard.ts');
const {createKeyManagementRoutes}=load('management/KeyManagementEndpoint.ts');
const express=require(process.cwd()+'/node_modules/express');
const request=require(process.cwd()+'/node_modules/supertest');
const out=[];
const dep=(group,id=group,extra={})=>({model_name:group,model_info:{id},litellm_params:{model:'openai/gpt-4',api_key:'synthetic-test-placeholder',...extra}});
const opts=(ds,extra={})=>({model_list:ds,routing_strategy:"simple-shuffle",num_retries:0,disable_cooldowns:true,...extra});
const msg=[{role:'user',content:'hi'}];
const ok=(usage={completion_tokens:10,total_tokens:12})=>({response:new Response('{}'),body:{choices:[],usage},ttft:100,upstreamUrl:'https://example.invalid'});
const probe=(id,observed)=>out.push({id,...observed});
(async()=>{
 // BUG-01 fixed: an unconsumed stream retains its active slot.
 const r1=new Router(opts([dep('a')]));let consumed=0;
 r1._executeRequest=async()=>({...ok(),body:undefined,stream:(async function*(){consumed++;yield {choices:[{delta:{content:'token'}}]};})()});
 const result=await r1.completion('a',msg,{stream:true});
 assert.equal(consumed,0);assert.equal(r1._activeRequests.get('a'),1);
 probe('BUG-01',{active_before_stream_consumption:r1._activeRequests.get('a'),consumed_chunks:consumed});await result.stream.return();
 // BUG-02 fixed: explicit zero overrides deployment defaults.
 const r2=new Router(opts([dep('a','a',{num_retries:2}),dep('a','a2',{num_retries:2})],{retry_after:0}));let calls=0;
 r2._executeRequest=async()=>{calls++;return calls<3?{...ok(),response:new Response('{}',{status:503}),body:{error:'synthetic unavailable'}}:ok();};
 let retryError;try{await r2.completion('a',msg,{num_retries:0});}catch(e){retryError=e;}assert(retryError);assert.equal(calls,1);
 probe('BUG-02',{request_num_retries:0,actual_attempts:calls});
 // BUG-03 fixed: lazy first-chunk TTFT and no output-token division.
 const oldNow=Date.now;let clock=1000;Date.now=()=>clock;
 const wrapped=buildStreamWithTtft(new Response(''),clock,{streamResponse:()=> (async function*(){clock=1400;yield {choices:[{delta:{content:'x'}}]};})()});
 await wrapped.stream.next();await wrapped.stream.return();Date.now=oldNow;assert.equal(wrapped.ttft,400);
 const r3=new Router(opts([dep('a')]));r3._executeRequest=async()=>({...ok(),stream:(async function*(){yield {};})()});
 const t=await r3.completion('a',msg,{stream:true});await t.stream.next();assert.equal(r3._ttft.get('a'),100);await t.stream.return();
 probe('BUG-03',{actual_first_chunk_ms:400,wrapper_reported_ms:wrapped.ttft,provided_ttft_ms:100,output_tokens:10,router_metric_ms:r3._ttft.get('a')});
 // BUG-04 fixed: tool schemas participate in pre-call context checks.
 const d4=dep('a');d4.model_info.max_input_tokens=100;
 const r4=new Router(opts([d4],{pre_call_checks:true}));let providerCalls=0;
 r4._executeRequest=async()=>{providerCalls++;return ok();};
 const tools=[{type:'function',function:{name:'synthetic_tool',description:'x'.repeat(20000),parameters:{type:'object'}}}];
 let contextError;try{await r4.completion('a',msg,{tools});}catch(e){contextError=e;}assert(contextError);assert.equal(providerCalls,0);
 probe('BUG-04',{max_input_tokens:100,tool_schema_characters:JSON.stringify(tools).length,estimated_messages_only:r4._estimateInputTokens(msg),provider_called:providerCalls});
 // BUG-05 fixed: no embedded configured credential in public errors.
 const fake='sk-synthetic-never-a-real-key';const r5=new Router(opts([dep('a','a',{api_key:fake})]));
 r5._executeRequest=async()=>({...ok(),response:new Response('{}',{status:401}),body:{error:{message:'Invalid api_key='+fake}}});
 let caught;try{await r5.completion('a',msg);}catch(e){caught=e;}
 assert(caught);const mapped=mapToApiError(caught);assert(!mapped.message.includes(fake));
 probe('BUG-05',{synthetic_secret_survives_router_and_response_mapper:mapped.message.includes(fake)});
 // BUG-06 existing mock request parameters change routing without an enable flag.
 const r6=new Router(opts([dep('a'),dep('b')],{fallbacks:[{a:['b']}]}));const models=[];
 r6._executeRequest=async(_p,d)=>{models.push(d.model_name);return ok();};
 let mockError;try{await r6.completion('a',msg,{mock_testing_rate_limit_error:true});}catch(e){mockError=e;}assert.equal(mockError.name,'RateLimitError');
 probe('BUG-06',{mock_switch_configured:false,client_test_parameter_executed:true,error_name:mockError.name});
 // BUG-07 existing budget checker produces rate-limit status/type for a permanent budget exhaustion.
 let budget;try{checkBudget(10,10);}catch(e){budget=e;}assert.equal(budget.statusCode,429);
 probe('BUG-07',{exhausted_budget_status:budget.statusCode,error_type:budget.type});
 // BUG-08 fixed: privileged field write is denied before DB mutation.
 let row={token:'synthetic-hashed-id',userId:'synthetic-member',teamId:null,budgetId:null,permissions:{},maxBudget:10};let written;
 const db={select:()=>({from:()=>({where:()=>({limit:async()=>[row]})})}),update:()=>({set:(values)=>{written=values;return {where:async()=>{row={...row,...values};}};}})};
 const guard=new AuthorizationGuard({findTeamById:async()=>null});const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.auth={user_id:'synthetic-member',user_role:'internal_user',token:row.token,max_budget:10};next();});
 const er=express.Router();er.use(guard.middleware('management'));createKeyManagementRoutes(er,db,guard);app.use(er);
 const server=app.listen(0,'127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));
 const response=await request(server).post('/key/update').send({token:row.token,permissions:{get_spend_routes:true}});
 await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 assert.equal(response.status,403);assert.equal(written,undefined);
 probe('BUG-08',{caller_role:'internal_user',http_status:response.status,privileged_permissions_written:written!==undefined});
 // BUG-09 fixed: sibling fallback continues before first semantic output.
 const r9=new Router(opts([dep('primary'),dep('fb1'),dep('fb2')],{fallbacks:[{primary:['fb1','fb2']}]}));const seen=[];
 r9._executeRequest=async(_p,d)=>{seen.push(d.model_name);if(d.model_name==='primary')return {...ok(),response:new Response('{}',{status:503}),body:{error:'synthetic primary failure'}};return {...ok(),...buildStreamWithTtft(new Response(''),Date.now(),{streamResponse:()=> (async function*(){if(d.model_name==='fb1')throw new Error('synthetic pre-output stream failure');yield {choices:[{delta:{content:'recovered'}}]};})()})};};
 const sr=await r9.completion('primary',msg,{stream:true});let streamError=false;try{for await(const chunk of sr.stream){if(chunk.error)streamError=true;}}catch(e){streamError=true;}
 assert.deepEqual(seen,['primary','fb1','fb2']);assert(!streamError);
 probe('BUG-09',{configured_fallbacks:['fb1','fb2'],attempted_groups:seen,unrecovered_error_before_first_output:streamError});
 const tsHead=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:process.cwd(),encoding:'utf8'}).trim();console.log(JSON.stringify({ts_head:tsHead,implementation_state:"working-tree",results:out},null,2));
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
