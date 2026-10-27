const esbuild = require('esbuild');
esbuild.buildSync({entryPoints:['world/fictional_rescue.js'],outfile:'vendor/fictional-rescue.js',
  bundle:true,minify:true,format:'esm',target:'es2022',legalComments:'linked'});
