import sys
core=open('src/fx_core.js').read(); kb=open('src/fx_kb.js').read()+'\n'+open('src/fx_presets.js').read(); ref=open('src/fx_ref.js').read(); main=open('src/sm_ps_main.js').read()
hdr="// StyleMatch.psjs  -  gives your translated text the look of the original text (English + Arabic)\n// v%s  -  run from File > Scripts. One Ctrl+Z undoes it.\n" % sys.argv[1]
open('dist/StyleMatch.psjs','w',encoding='utf-8').write(hdr+core.replace("if (typeof module !== 'undefined') module.exports = FX;","")+"\n"+kb+"\n"+ref+"\n"+main)
print('built')
