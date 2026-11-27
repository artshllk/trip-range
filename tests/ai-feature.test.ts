import { test } from "node:test";
import assert from "node:assert/strict";
import { CHILD_INPUT, renderInChild } from "./child-render";
import { validateEnvironment } from "../src/config/environment";

const secret = "synthetic-private-openai-credential";
test("AI is explicit server opt-in; absent, false and malformed values cannot expose the key or enable capability", () => {
  for (const flag of [
    undefined,
    "",
    "false",
    "TRUE",
    "1",
    "yes",
    "malformed",
  ]) {
    const config = validateEnvironment({
      OPENAI_API_KEY: secret,
      GOEKSPLO_AI_ENABLED: flag,
    });
    assert.equal(config.ai.enabled, false);
    assert.equal(config.capabilities.ai, false);
    assert.equal(config.ai.apiKey, undefined);
  }
  const enabled = validateEnvironment({
    OPENAI_API_KEY: secret,
    GOEKSPLO_AI_ENABLED: "true",
  });
  assert.equal(enabled.ai.enabled, true);
  assert.equal(enabled.capabilities.ai, true);
  assert.equal(
    validateEnvironment({ GOEKSPLO_AI_ENABLED: "true" }).capabilities.ai,
    false,
  );
});

function routeCase(
  flag: string | undefined,
  options: {
    deny?: boolean;
    outage?: boolean;
    origin?: string;
    method?: string;
    type?: string;
    explanations?: boolean;
  } = {},
) {
  return JSON.parse(
    renderInChild(
      `
    const {buildSync}=require('esbuild');const Module=require('node:module');const path=require('node:path');
    const options=${CHILD_INPUT};const calls=[];
    const load=Module._load;Module._load=function(id,...args){if(id==='next/navigation')return {notFound(){throw Error('not-found')}};return load.call(this,id,...args)};
    global.fetch=async(url)=>{const host=new URL(url).hostname;
      if(host==='fixture.upstash.io'){calls.push('redis');return options.outage?new Response(null,{status:503}):Response.json({result:options.deny?0:1});}
      if(host==='api.openai.com'){calls.push('openai');return new Response(null,{status:503});}
      throw Error('Unexpected network call');
    };
    const file=path.resolve(options.explanations?'src/services/ai/app-explanations.ts':'src/app/api/ai/intent/route.ts');
    const code=buildSync({entryPoints:[file],bundle:true,platform:'node',packages:'external',write:false}).outputFiles[0].text;
    const mod=new Module(file);mod.paths=module.paths;mod._compile(code,file);
    (async()=>{
      if(options.explanations){const result=await mod.exports.appExplanations(true,[{}],'en');process.stdout.write(JSON.stringify({result,calls}));return;}
      const response=await mod.exports.POST(new Request('https://site.test/api/ai/intent',{method:options.method||'POST',headers:{origin:options.origin||'https://site.test','content-type':options.type||'application/json'},...((options.method||'POST')==='GET'?{}:{body:JSON.stringify({text:'A quiet weekend',locale:'en',draft:{origin:'zurich'}})})}));
      process.stdout.write(JSON.stringify({status:response.status,cache:response.headers.get('cache-control'),body:await response.json(),calls}));
    })().catch(()=>process.exit(1));
  `,
      options,
      {
        nodeArgs: ["--conditions=react-server"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: "test",
          GOEKSPLO_LOG_LEVEL: "off",
          VERCEL: "1",
          VERCEL_ENV: "production",
          OPENAI_API_KEY: secret,
          RATE_LIMIT_REDIS_REST_URL: "https://fixture.upstash.io",
          RATE_LIMIT_REDIS_REST_TOKEN: "synthetic-redis-token",
          ...(flag === undefined ? {} : { GOEKSPLO_AI_ENABLED: flag }),
        },
      },
    ),
  );
}
for (const flag of [undefined, "false", "malformed"])
  test(`actual AI route rejects disabled flag ${String(flag)} before Redis/OpenAI`, () => {
    const r = routeCase(flag);
    assert.equal(r.status, 503);
    assert.equal(r.cache, "no-store");
    assert.deepEqual(r.body, { status: "unavailable" });
    assert.deepEqual(r.calls, []);
  });
test("disabled trip explanations ignore even an explicit AI query before Redis/provider work", () => {
  const r = routeCase("false", { explanations: true });
  assert.deepEqual(r, { result: {}, calls: [] });
});
test("origin, method and content-type protections still run when AI is off or on", () => {
  for (const flag of ["false", "true"])
    for (const options of [
      { origin: "https://other.test" },
      { method: "GET" },
      { type: "text/plain" },
    ]) {
      const r = routeCase(flag, options);
      assert.equal(r.status, 400);
      assert.deepEqual(r.calls, []);
    }
});
test("enabled AI reaches shared Redis before the real provider adapter; denial and outage never reach OpenAI", () => {
  const allowed = routeCase("true");
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body, { status: "unavailable" });
  assert.deepEqual(allowed.calls, ["redis", "openai"]);
  for (const options of [{ deny: true }, { outage: true }]) {
    const r = routeCase("true", options);
    assert.equal(r.status, 429);
    assert.deepEqual(r.calls, ["redis"]);
  }
});

test("actual SearchBar hides every AI control by default and exposes the existing trigger only when server context enables it", () => {
  const html = (enabled: boolean) =>
    renderInChild(
      `
    const {buildSync}=require('esbuild');const Module=require('node:module');const path=require('node:path');
    const code=buildSync({stdin:{contents:'export {AiFeature} from "./src/components/layout/AiFeature"; export {SearchBar} from "./src/components/travel/SearchBar"; export {Results} from "./src/components/travel/Results";',resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',packages:'external',write:false}).outputFiles[0].text;
    const filename=path.resolve('ai-ui-test.cjs');const mod=new Module(filename);mod.paths=module.paths;mod._compile(code,filename);
    const {createElement:h}=require('react');const {renderToStaticMarkup}=require('react-dom/server');
    const {AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
    const request=require('./.test-build/src/domain/request').defaultRequest;
    const t=require('./src/i18n/en.json');
    global.fetch=()=>{throw Error('No UI render network calls')};
    process.stdout.write(renderToStaticMarkup(h(AppRouterContext.Provider,{value:{push(){},replace(){},prefetch(){}}},h(mod.exports.AiFeature,{enabled:${enabled}},h(mod.exports.SearchBar,{initial:request,today:'2026-10-22',locale:'en',t,home:true}),h(mod.exports.Results,{bases:[],request,locale:'en',t,issues:[],today:'2026-10-22',unsupported:['other']})))));
  `,
      undefined,
    );
  assert.doesNotMatch(
    html(false),
    /ai-trigger|ai-search-panel|Plan with AI|not used in trip ranking yet/,
  );
  assert.match(html(true), /Plan with AI/);
  assert.match(html(true), /not used in trip ranking yet/);
});
