// Run the unmodified upstream app, adding only our local rescue handoff panel.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const upstream=resolve(process.env.GODS_EYE_VIEW_ROOT || resolve(homedir(),'PROJECTS/gods-eye-view'));
const origin=new URL(process.env.DRONE_RESCUE_ORIGIN || 'http://127.0.0.1:8877');
if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.protocol!=='http:')throw Error('Rescue origin must be a local HTTP server.');
// Upstream's Cesium static-assets plugin resolves node_modules from cwd.
process.chdir(upstream);
const {createServer}=await import(pathToFileURL(resolve(upstream,'node_modules/vite/dist/node/index.js')));
const {default:upstreamConfig}=await import(pathToFileURL(resolve(upstream,'vite.config.js')));
const config=typeof upstreamConfig==='function'?await upstreamConfig({command:'serve',mode:'development'}):upstreamConfig;
const panel=readFileSync(resolve(repo,'rescue_handoff.js'),'utf8')+'\n'+readFileSync(resolve(repo,'scripts/gods_eye_rescue_panel.js'),'utf8').replace('__RESCUE_ORIGIN__',JSON.stringify(origin.origin));
const plugin={name:'drone-rescue-handoff',
  resolveId(id){if(id==='/__rescue/panel.js')return '\0drone-rescue-panel';},
  load(id){if(id==='\0drone-rescue-panel')return panel;},
  transformIndexHtml(){return [{tag:'script',attrs:{type:'module',src:'/__rescue/panel.js'},injectTo:'body'}];}};
const server=await createServer({...config,configFile:false,root:upstream,plugins:[...(config.plugins || []),plugin],
  server:{...config.server,host:'127.0.0.1',port:Number(process.env.GODS_EYE_VIEW_PORT || 4173),strictPort:true}});
await server.listen();server.printUrls();
console.log('Rescue bridge enabled. All training and payload deliveries are simulated.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
