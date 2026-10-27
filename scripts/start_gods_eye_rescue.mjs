// Run the unmodified upstream app, adding only our local rescue handoff panel.
import {readFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const upstream=resolve(process.env.GODS_EYE_VIEW_ROOT || resolve(homedir(),'PROJECTS/gods-eye-view'));
const origin=new URL(process.env.DRONE_RESCUE_ORIGIN || 'http://127.0.0.1:8877');
if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.protocol!=='http:')throw Error('Rescue origin must be a local HTTP server.');
let ownedBackend=null,backendFailure='',backendOutput='';
async function backendReady(){
  let response;
  try{response=await fetch(origin.origin+'/api/vision',{signal:AbortSignal.timeout(2000)});}
  catch{return false;}
  const data=await response.json().catch(()=>null);
  if(!response.ok || !data || typeof data.status!=='string')throw Error('The rescue port belongs to a different service. Choose another RescuePort.');
  return true;
}
if(!await backendReady()){
  const venv=resolve(repo,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
  const command=existsSync(venv)?venv:process.platform==='win32'?'py':'python3';
  const args=[...(command==='py'?['-3']:[]),resolve(repo,'sim_server.py'),'--port',origin.port || '80','--page','earth_rescue.html','--no-browser'];
  ownedBackend=spawn(command,args,{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
  for(const pipe of [ownedBackend.stdout,ownedBackend.stderr])pipe.on('data',chunk=>{backendOutput=(backendOutput+chunk).slice(-4000);});
  ownedBackend.on('error',error=>{backendFailure=error.message;});
  ownedBackend.on('exit',code=>{backendFailure='backend exited ('+code+'): '+backendOutput;});
  const deadline=Date.now()+45000;
  while(!await backendReady()){
    if(backendFailure || Date.now()>deadline){ownedBackend.kill();throw Error('Rescue backend failed: '+(backendFailure || backendOutput));}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  console.log('Started local rescue backend at '+origin.origin);
}else console.log('Reusing local rescue backend at '+origin.origin);
process.on('exit',()=>ownedBackend?.kill());
// Upstream's Cesium static-assets plugin resolves node_modules from cwd.
process.chdir(upstream);
const {createServer}=await import(pathToFileURL(resolve(upstream,'node_modules/vite/dist/node/index.js')));
const {default:upstreamConfig}=await import(pathToFileURL(resolve(upstream,'vite.config.js')));
const config=typeof upstreamConfig==='function'?await upstreamConfig({command:'serve',mode:'development'}):upstreamConfig;
const panel=readFileSync(resolve(repo,'rescue_handoff.js'),'utf8')+'\n'+readFileSync(resolve(repo,'scripts/gods_eye_rescue_panel.js'),'utf8').replace('__RESCUE_ORIGIN__',JSON.stringify(origin.origin));
const nycConfig=JSON.parse(readFileSync(resolve(repo,'integrations/new_york_buildings.json'),'utf8'));
const existingPublicToken=readFileSync(resolve(repo,'earth_rescue.js'),'utf8').match(/const DEFAULT_CESIUM_TOKEN = '([^']+)'/)?.[1] || '';
const nycToken=process.env.CESIUM_ION_TOKEN || existingPublicToken;
const plugin={name:'drone-rescue-handoff',
  resolveId(id){if(id==='/__rescue/panel.js')return '\0drone-rescue-panel';if(id==='/__rescue/nyc.js')return '\0drone-rescue-nyc';if(id==='/__rescue/city-flight.js')return '\0drone-rescue-city-flight';if(id==='/__rescue/city-route.mjs')return '\0drone-rescue-city-route';},
  load(id){if(id==='\0drone-rescue-panel')return panel;if(id==='\0drone-rescue-nyc')return readFileSync(resolve(repo,'scripts/gods_eye_nyc.js'),'utf8');if(id==='\0drone-rescue-city-flight')return readFileSync(resolve(repo,'scripts/gods_eye_city_flight.js'),'utf8');if(id==='\0drone-rescue-city-route')return readFileSync(resolve(repo,'scripts/city_route_math.mjs'),'utf8');},
  configureServer(server){server.middlewares.use((request,response,next)=>{
    if(request.url?.split('?')[0]!=='/__rescue/nyc-config')return next();
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    response.end(JSON.stringify({...nycConfig,access_token:nycToken}));
  });},
  transformIndexHtml(){return [{tag:'script',attrs:{type:'module',src:'/__rescue/panel.js'},injectTo:'body'}];}};
const server=await createServer({...config,configFile:false,root:upstream,plugins:[...(config.plugins || []),plugin],
  server:{...config.server,host:'127.0.0.1',port:Number(process.env.GODS_EYE_VIEW_PORT || 4173),strictPort:true,
    proxy:{...config.server?.proxy,'/__rescue/backend':{target:origin.origin,changeOrigin:true,rewrite:path=>path.replace(/^\/__rescue\/backend/,'')}}}});
await server.listen();server.printUrls();
console.log('Rescue bridge enabled. All training and payload deliveries are simulated.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();ownedBackend?.kill();process.exit(0);});
