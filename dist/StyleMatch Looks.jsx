#target photoshop
// StyleMatch Looks - pick a look, set its colours/depth/intensity, Apply. Works on the selected text layer(s).
// Keep this file next to StyleMatch.psjs. It writes your choice into the layer name (#preset ...) and runs StyleMatch.
var LOOKS = [['neon','Neon / 80s sign'],['cartoon3D','3D cartoon / game title'],['glitch','Glitch / VHS / RGB split'],['comicVintage','Vintage comic / pop art'],['retroLayered','Retro layered / 70s'],
  ['retroChrome80s','80s retro chrome'],['rainbow','Rainbow / pride'],['holographic','Holographic / foil'],['chrome','Chrome metal'],['goldMetal','Gold / heavy metal'],['stone','Stone / ruby / cinematic'],
  ['fire','Lava / fire'],['ice','Ice / underwater / glass'],['horror','Horror / dark magic'],['cosmicBlur','Cosmic / soft blur'],['grungePrint','Grunge / dirty print'],['ink','Ink / smudge'],
  ['halftone','Halftone print'],['broken','Broken / cracked'],['sketch','Pencil / outline / graffiti'],['glitter','Glitter / sparkle'],['elegant','Elegant / gold line']];
if (!app.documents.length) alert('Open a page and select your text layer first.'); else {
  var w = new Window('dialog', 'StyleMatch Looks');
  w.orientation = 'column'; w.alignChildren = 'fill';
  var dd = w.add('dropdownlist', undefined, (function () { var a = []; for (var i = 0; i < LOOKS.length; i++) a.push(LOOKS[i][1]); return a; })()); dd.selection = 0;
  function row(label, val, tip) { var g = w.add('group'); g.add('statictext', undefined, label).preferredSize.width = 120; var e = g.add('edittext', undefined, val); e.characters = 10; e.helpTip = tip; return e; }
  var cMain = row('Main colour', '', 'empty = the look\'s own colours, or a hex like #FF3355');
  var cGlow = row('Glow colour', '', 'empty = the look\'s own glow colour');
  var cDep = row('Depth (px per 100 px text)', '', 'empty = default; for 3D and stacked looks');
  var cInt = row('Intensity', '1', '1 = normal, 0.5 = softer, 1.5 = stronger glow/shadow');
  var b = w.add('group'); b.alignment = 'right'; b.add('button', undefined, 'Cancel', { name: 'cancel' }); var ok = b.add('button', undefined, 'Apply', { name: 'ok' });
  if (w.show() == 1) {
    var tag = '#preset ' + LOOKS[dd.selection.index][0], hx = function (v) { v = v.replace(/\s/g, ''); return /^#?[0-9a-fA-F]{6}$/.test(v) ? (v.charAt(0) == '#' ? v : '#' + v) : ''; };
    if (hx(cMain.text)) tag += ' color=' + hx(cMain.text); if (hx(cGlow.text)) tag += ' glow=' + hx(cGlow.text);
    if (cDep.text && !isNaN(parseFloat(cDep.text))) tag += ' depth=' + parseFloat(cDep.text); if (cInt.text && !isNaN(parseFloat(cInt.text)) && parseFloat(cInt.text) != 1) tag += ' intensity=' + parseFloat(cInt.text);
    // the selected layers (Action Manager: works with several selected)
    var ids = [], r = new ActionReference(); r.putProperty(stringIDToTypeID('property'), stringIDToTypeID('targetLayersIDs')); r.putEnumerated(charIDToTypeID('Dcmn'), charIDToTypeID('Ordn'), charIDToTypeID('Trgt'));
    var dl = executeActionGet(r).getList(stringIDToTypeID('targetLayersIDs')); for (var i = 0; i < dl.count; i++) ids.push(dl.getReference(i).getIdentifier());
    for (var j = 0; j < ids.length; j++) { var ref = new ActionReference(); ref.putIdentifier(charIDToTypeID('Lyr '), ids[j]); var nm = executeActionGet(ref).getString(charIDToTypeID('Nm  '));
      nm = nm.replace(/\s*#preset\b.*$/i, '') + ' ' + tag; var d = new ActionDescriptor(), lr = new ActionReference(); lr.putIdentifier(charIDToTypeID('Lyr '), ids[j]); d.putReference(charIDToTypeID('null'), lr);
      var ld = new ActionDescriptor(); ld.putString(charIDToTypeID('Nm  '), nm); d.putObject(charIDToTypeID('T   '), charIDToTypeID('Lyr '), ld); executeAction(charIDToTypeID('setd'), d, DialogModes.NO); }
    // select them again and run StyleMatch on them
    var sr = new ActionReference(); for (var k = 0; k < ids.length; k++) sr.putIdentifier(charIDToTypeID('Lyr '), ids[k]); var sd = new ActionDescriptor(); sd.putReference(charIDToTypeID('null'), sr); executeAction(charIDToTypeID('slct'), sd, DialogModes.NO);
    var sm = File(File($.fileName).parent + '/StyleMatch.psjs'); if (sm.exists) sm.execute(); else alert('Put StyleMatch.psjs in the same folder as this script.');
  }
}
