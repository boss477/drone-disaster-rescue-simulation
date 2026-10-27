// Check both directions without PowerShell treating an expected Git stderr as fatal.
const {spawnSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const [root,patch]=process.argv.slice(2);
// Git's Windows checkout may convert .patch files to CRLF. Feed canonical LF.
const input=readFileSync(patch,'utf8').replace(/\r\n/g,'\n');
const git=args=>spawnSync('git',['-C',root,'apply',...args,'-'],{encoding:'utf8',input,windowsHide:true});
if(git(['--reverse','--check']).status!==0){
  const check=git(['--check']);
  if(check.status!==0){process.stderr.write(check.stderr || 'Cannot check upstream compatibility patch.');process.exit(1);}
  const result=git([]);
  if(result.status!==0){process.stderr.write(result.stderr || 'Cannot apply upstream compatibility patch.');process.exit(1);}
}
