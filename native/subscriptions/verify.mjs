// Compare the shipped runtime to a pinned reference using only synthetic accounts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [nativeBinary, pluginDirectory, referenceBinary] = process.argv.slice(2);
if (!nativeBinary || (referenceBinary && !pluginDirectory)) throw new Error("usage: node verify.mjs <native binary> [reference plugin directory] [reference binary]");
const seen = [];
const output = { id: "resp_fixture", object: "response", status: "completed", model: "fixture", output: [{ id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "fixture ok", annotations: [] }] }], usage: { input_tokens: 13, output_tokens: 2, total_tokens: 15 } };
const events = [
	{ type: "response.created", response: { ...output, status: "in_progress", output: [] } },
	{ type: "response.output_item.added", output_index: 0, item: { ...output.output[0], content: [] } },
	{ type: "response.content_part.added", item_id: "msg_fixture", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
	{ type: "response.output_text.delta", item_id: "msg_fixture", output_index: 0, content_index: 0, delta: "fixture ok" },
	{ type: "response.output_text.done", item_id: "msg_fixture", output_index: 0, content_index: 0, text: "fixture ok" },
	{ type: "response.output_item.done", output_index: 0, item: output.output[0] },
	{ type: "response.completed", response: output },
];
const remote = createServer(async (req, res) => {
	const chunks = [];
	for await (const data of req) chunks.push(data);
	const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
	const path = (req.url ?? "").slice(1).split("/");
	const source = path[0], operation = path.at(-1);
	const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
	if (operation === "models") {
		return json({ data: source === "cc" ? [{ id: "vendor/fixture" }, { id: "anthropic/claude-sonnet-4-6" }] : [{ id: "gpt-fixture" }] });
	}
	assert(!Object.hasOwn(body,"_litellm_subscription"), "private routing metadata leaked to upstream");
	seen.push({ source, operation, model: body.model, tools: body.tools, session: Boolean(req.headers["x-commandcode-session"] || req.headers["x-opencode-session"]) });
	if (operation === "responses") {
		if (!body.stream) return json(output);
		res.setHeader("Content-Type", "text/event-stream");
		return res.end(events.map((e, i) => "event: " + e.type + "\ndata: " + JSON.stringify({ ...e, sequence_number: i }) + "\n\n").join(""));
	}
	if (operation === "compact") {
		return json({ id: "cmp_fixture", object: "response.compaction", output: [{ type: "compaction", encrypted_content: "synthetic" }], usage: output.usage });
	}
	if (operation === "messages") {
		const msg = { id: "msg_fixture", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "fixture ok" }], stop_reason: "end_turn", usage: { input_tokens: 13, output_tokens: 2 } };
		if (!body.stream) return json(msg);
		const frames = [
			{type:"message_start", message:{...msg, content:[], stop_reason:null,usage:{input_tokens:13,output_tokens:0}}},
			{type:"content_block_start",index:0,content_block:{type:"text",text:""}},
			{type:"content_block_delta",index:0,delta:{type:"text_delta",text:"fixture ok"}},
			{type:"content_block_stop",index:0},
			{type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:2}},
			{type:"message_stop"}
		];
		res.setHeader("Content-Type","text/event-stream");
		return res.end(frames.map(f=>"event: "+f.type+"\ndata: "+JSON.stringify(f)+"\n\n").join(""));
	}
	if (operation === "completions") {
		const data={id:"chat_fixture",object:"chat.completion",model:body.model,choices:[{index:0,message:{role:"assistant",content:"fixture ok"},finish_reason:"stop"}],usage:{prompt_tokens:13,completion_tokens:2,total_tokens:15}};
		if(!body.stream) return json(data);
		const chunk=(delta,finish_reason)=>({id:data.id,object:"chat.completion.chunk",model:body.model,choices:[{index:0,delta,finish_reason}]});
		res.setHeader("Content-Type","text/event-stream");
		return res.end([chunk({role:"assistant",content:"fixture ok"},null),chunk({},"stop")].map(x=>"data: "+JSON.stringify(x)+"\n\n").join("")+"data: [DONE]\n\n");
	}
	res.writeHead(400); res.end('{"error":{"message":"unexpected fixture endpoint"}}');
});
async function listen(server) {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return server.address().port;
}
const remotePort = await listen(remote);
const origin = "http://127.0.0.1:" + remotePort;
const ingress = randomBytes(24).toString("hex");
const tool = { type: "namespace", name: "demo", tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }] };
async function exercise(binary, scoped, plugins) {
	const dir = await mkdtemp(join(tmpdir(), "litellm-subscriptions-test-"));
	const authDir = join(dir, "accounts");
	const empty = join(dir, "empty-plugins");
	await mkdir(authDir); await mkdir(empty);
	const socket = createServer();
	const port = await listen(socket); await new Promise(r => socket.close(r));
	const cfg = { host: "127.0.0.1", port, "auth-dir": authDir, "api-keys": [ingress], "request-retry": 0,
		"remote-management": { "disable-control-panel": true, "disable-auto-update-panel": true },
		"codex-api-key": [{ "api-key": "fixture-codex", "base-url": origin + "/codex", models: [{ name: "gpt-fixture", alias: "fixture-codex-model" }] }],
		plugins: { enabled: true, dir: plugins || empty, configs: {} } };
	for (const [slug, id, plugin] of [["cc","commandcode","commandcode-go-cliproxyapi"],["oc","opencode-go","opencode-go-cliproxyapi"]]) {
		cfg.plugins.configs[plugin] = { enabled: true, "allow-http": true, "base-url": origin + "/" + slug, "catalog-url": origin + "/" + slug + "/models", "model-prefix": { enabled: true, value: id } };
	}
	cfg.plugins.configs["opencode-go-cliproxyapi"]["api-keys"] = [{value:"fixture-opencode-key", name:"Fixture"}];
	await writeFile(join(authDir, "commandcode-fixture.json"), JSON.stringify({ type:"commandcode", api_key:"fixture-commandcode-key", label:"Fixture" }), {mode:0o600});
	const file = join(dir, "config.yaml");
	await writeFile(file, JSON.stringify(cfg), {mode:0o600});
	const base = "http://127.0.0.1:" + port;
	const child = spawn(resolve(binary), ["-config", file], { cwd:dir, stdio:["ignore","pipe","pipe"], env:{ PATH:process.env.PATH, HOME:dir, GIN_MODE:"release", MANAGEMENT_PASSWORD:ingress, HTTP_PROXY:"http://127.0.0.1:1", HTTPS_PROXY:"http://127.0.0.1:1", NO_PROXY:"127.0.0.1,localhost" }});
	let logs = "";
	for (const stream of [child.stdout,child.stderr]) stream.on("data", b => { logs = (logs + b).slice(-8192); });
	const done = once(child, "exit");
	async function send(path, body) {
		return fetch(base + path, {method:body ? "POST":"GET", headers:{Authorization:"Bearer " + ingress,"Content-Type":"application/json"}, signal:AbortSignal.timeout(5000), body:body ? JSON.stringify(body):undefined});
	}
	try {
		let ids = [];
		for(let i=0; i<120; i++) {
			if(child.exitCode !== null) throw new Error("runtime exited during startup");
			try { const r = await send("/v1/models"); ids = ((await r.json()).data || []).map(m=>m.id); } catch {}
			if(["commandcode/vendor/fixture","opencode-go/gpt-fixture","fixture-codex-model"].every(m=>ids.includes(m))) break;
			await delay(100);
		}
		assert(ids.includes("commandcode/vendor/fixture") && ids.includes("opencode-go/gpt-fixture") && ids.includes("fixture-codex-model"), "source catalogs did not warm: " + ids.filter(id=>id.includes("fixture")).join(","));
		const results=[];
		if(scoped) {
			const attempts=seen.length;
			assert.equal((await send("/v1/responses",{model:"fixture-codex-model",input:"unscoped"})).status,404);
			assert.equal(seen.length,attempts);
			for(const [slug,id] of [["codex-subscription","fixture-codex-model"],["commandcode","commandcode/vendor/fixture"],["opencode-go","opencode-go/gpt-fixture"]]) {
				assert((await (await send("/subscriptions/"+slug+"/v1/models")).json()).data.some(m=>m.id===id.replace(new RegExp("^"+slug+"/"),"")));
			}
			assert.equal((await fetch(base+"/subscriptions/commandcode/v1/models")).status,401);
		}
		for(const [slug,model,source] of [["commandcode","commandcode/vendor/fixture","cc"],["opencode-go","opencode-go/gpt-fixture","oc"],["codex-subscription","fixture-codex-model","codex"]]) {
			const path=(scoped?"/subscriptions/"+slug:"")+"/v1/responses";
			for(const stream of [false,true]) {
				const start=seen.length;
				const apiModel = scoped ? model.replace(new RegExp("^"+slug+"/"),"") : model;
				const r=await send(path,{model:apiModel,input:"synthetic fixture",tools:[tool],stream});
				const raw=await r.text();
				assert.equal(r.status,200,slug+" "+r.status+" "+raw.slice(0,180));
				const attempts=seen.slice(start);
				assert.equal(attempts.length,1); assert.equal(attempts[0].source,source);
				if(slug==="commandcode") assert.equal(attempts[0].tools?.[0]?.type,"namespace");
				if(stream) {
					const types=raw.split("\n").filter(x=>x.startsWith("data:")).map(x=>x.slice(5).trim()).filter(x=>x && x!=="[DONE]").map(x=>JSON.parse(x).type);
					assert.equal(types.at(-1),"response.completed"); results.push([slug,stream,types]);
				} else {
					const b=JSON.parse(raw);assert.equal(b.status,"completed");results.push([slug,stream,b.output,b.usage]);
				}
			}
		}
		for(const [slug,model,source] of [["commandcode","commandcode/vendor/fixture","cc"],["commandcode","commandcode/anthropic/claude-sonnet-4-6","cc"],["opencode-go","opencode-go/gpt-fixture","oc"],["codex-subscription","fixture-codex-model","codex"]]) {
			const prefix=scoped?"/subscriptions/"+slug:"";
			for(const endpoint of ["chat/completions", "messages"]) {
				const start=seen.length;
				const apiModel = scoped ? model.replace(new RegExp("^"+slug+"/"),"") : model;
				const r=await send(prefix+"/v1/"+endpoint,{model:apiModel,messages:[{role:"user",content:"synthetic fixture"}], max_tokens:32});
				const raw=await r.text();
				assert.equal(r.status,200,slug+" "+endpoint+" "+r.status+" "+raw.slice(0,160));
				const message=JSON.parse(raw);
				const text=endpoint==="messages"?message.content.map(x=>x.text).join(""):message.choices[0].message.content;
				assert.equal(text,"fixture ok",slug+" "+endpoint);
				const attempts=seen.slice(start);
				assert.deepEqual(attempts.map(a=>a.source),[source]);
				results.push([slug,model,endpoint,attempts[0].operation,text,message.usage]);
			}
		}
		const start=seen.length;
		const compact=await send((scoped?"/subscriptions/codex-subscription":"")+"/v1/responses/compact",{model:"fixture-codex-model",input:[{role:"user",content:"fixture"}]});
		const compactBody=await compact.json();
		assert.equal(compact.status,200,JSON.stringify(compactBody).slice(0,160));
		assert.equal(compactBody.object,"response.compaction");
		assert.deepEqual(seen.slice(start).map(a=>[a.source,a.operation]),[["codex","compact"]]);
		results.push(["compact",compactBody.output,compactBody.usage]);

		const wsStart=seen.length;
		const ws=new WebSocket(base.replace("http:", "ws:")+(scoped?"/_litellm/ws":"")+"/v1/responses",{headers:{Authorization:"Bearer "+ingress}});
		const received=[];
		await new Promise((resolve,reject)=>{
			const timer=setTimeout(()=>{ws.terminate();reject(new Error("websocket turn timed out"));},8000);
			ws.once("open",()=>ws.send(JSON.stringify({type:"response.create",model:"fixture-codex-model",...(scoped?{_litellm_subscription:"codex-subscription"}:{}),input:[{role:"user",content:"fixture"}]})));
			ws.once("error",err=>{clearTimeout(timer);reject(err);});
			ws.on("message",raw=>{
				const frame=JSON.parse(raw.toString());received.push(frame.type);
				if(frame.type==="error"||frame.type==="response.failed"){clearTimeout(timer);ws.close();reject(new Error("websocket turn failed: "+JSON.stringify(frame).slice(0,180)));}
				if(frame.type==="response.completed"){clearTimeout(timer);ws.close();resolve();}
			});
		});
		assert.deepEqual(seen.slice(wsStart).map(a=>a.source),["codex"]);
		results.push(["websocket",received]);
		return results;
	} catch(error) {
		if (process.env.SUBSCRIPTIONS_FIXTURE_DEBUG) process.stderr.write(logs.replaceAll(ingress,"[fixture key]"));
		throw error;
	} finally {
		child.kill("SIGTERM");
		await Promise.race([done,delay(1200,undefined,{ref:false})]);
		if (child.exitCode===null && child.signalCode===null) child.kill("SIGKILL");
		await done;
		await rm(dir,{recursive:true,force:true});
	}
}
try {
	const pluginPath=pluginDirectory ? resolve(pluginDirectory) : undefined;
	const baseline=referenceBinary ? await exercise(referenceBinary,false,pluginPath) : undefined;
	const actual=await exercise(nativeBinary,true,process.env.SUBSCRIPTIONS_FIXTURE_DYNAMIC ? pluginPath : undefined);
	if(baseline) assert.deepEqual(actual,baseline);
	console.log("Subscription routing, catalogs, Chat, Messages, Responses, compact, WebSocket, tools and usage passed.");
} finally {remote.closeAllConnections(); await new Promise(r=>remote.close(r));}
