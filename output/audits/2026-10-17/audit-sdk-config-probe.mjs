import { query } from "@anthropic-ai/claude-agent-sdk";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 只启动本地模拟服务，不使用真实 API 凭据或用户 Claude 配置。
const root=await mkdtemp(join(tmpdir(),"codexly-audit-sdk-"));
const user=join(root,"user"); await mkdir(user);
const seen=[];
function makeServer(label){ return createServer(async(req,res)=>{
 let raw=""; for await(const c of req) raw+=c;
 res.setHeader("content-type","application/json");
 if(!req.url.includes("messages")){res.end("{}"); return;}
 if(req.url.includes("count_tokens")){res.end('{"input_tokens":10}');return;}
 seen.push({server:label,key:req.headers["x-api-key"]});
 const body=JSON.parse(raw),msg={id:`msg-${seen.length}`,type:"message",role:"assistant",model:body.model,content:[{type:"text",text:"OK"}],stop_reason:"end_turn",stop_sequence:null,usage:{input_tokens:10,output_tokens:1}};
 if(!body.stream){res.end(JSON.stringify(msg));return;}
 res.setHeader("content-type","text/event-stream");
 for(const e of [{type:"message_start",message:{...msg,content:[],stop_reason:null}},{type:"content_block_start",index:0,content_block:{type:"text",text:""}},{type:"content_block_delta",index:0,delta:{type:"text_delta",text:"OK"}},{type:"content_block_stop",index:0},{type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}},{type:"message_stop"}])res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
 res.end();
 });}
const a=makeServer("A"),b=makeServer("B");
await Promise.all([a,b].map(s=>new Promise(r=>s.listen(0,"127.0.0.1",r))));
const configure=async(s,key)=>writeFile(join(user,"settings.json"),JSON.stringify({env:{ANTHROPIC_API_KEY:key,ANTHROPIC_BASE_URL:`http://127.0.0.1:${s.address().port}`}}));
await configure(a,"audit-A");
const next=Promise.withResolvers(),keep=Promise.withResolvers();
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!(/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/.test(k))));
Object.assign(env,{CLAUDE_CONFIG_DIR:user,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:"1"});
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),25000);
let stream;
try {
stream=query({prompt:(async function*(){yield {type:"user",message:{role:"user",content:"hello"},parent_tool_use_id:null,session_id:""};await next.promise;yield {type:"user",message:{role:"user",content:"hello again"},parent_tool_use_id:null,session_id:""};await keep.promise;})(),options:{cwd:root,env,model:"claude-sonnet-4-6",settingSources:["user"],systemPrompt:{type:"preset",preset:"claude_code"},abortController:controller,canUseTool:async()=>({behavior:"deny",message:"audit"})}});
let results=0; for await(const m of stream){if(m.type==="result"){if(++results===1){await configure(b,"audit-B");next.resolve();}else break;}}
await writeFile(new URL("./audit-sdk-config-result.json",import.meta.url),JSON.stringify({results,seen}));
console.log(JSON.stringify({results,seen}));
} finally {clearTimeout(timer);next.resolve();keep.resolve();stream?.close();await Promise.all([a,b].map(s=>new Promise(r=>s.close(r))));await rm(root,{recursive:true,force:true});}
