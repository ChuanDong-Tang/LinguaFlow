import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup() {
  const effects=[], changes=[], statuses=[], calls={stop:0,close:0};
  let options, stateIndex=0;
  const session={sendFrame(){},stop(){calls.stop++;},close(){calls.close++;}};
  const imports={
    react:{useRef:current=>({current}),useState:value=>{const i=stateIndex++;return [value,next=>{if(i===0)statuses.push(next);}];},useEffect:fn=>effects.push(fn),useCallback:fn=>fn},
    '@react-native-community/netinfo':{useNetInfo:()=>({isConnected:true})},
    'react-native':{Alert:{alert(){}}},
    '../i18n':{getLanguage:()=> 'zh-CN',t:k=>k},
    '../services/api/meApi':{getUserPreference:async()=>({})},
    '../services/api/sttRealtimeApi':{STT_INPUT_MAX_RECORDING_MS:50000,openRealtimeSttSession:async o=>{options=o;return session;}},
    '../services/stt/picovoiceRealtimeAudioSource':{createPicovoiceRealtimeAudioSource:()=>({requestPermission:async()=>true,start:async()=>{},stop:async()=>{}})},
    '../services/tts/ttsPlayback':{stopTtsAudio(){}},
    '../services/stt/pcmAudioLevel':{calculatePcmAudioLevel:()=>0},
  };
  const code=ts.transpileModule(fs.readFileSync(new URL('./useRealtimeSttInput.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,require:id=>{assert.ok(imports[id],id);return imports[id];},Date});
  const hook=exports.useRealtimeSttInput({value:'已有文字',onChangeText:t=>changes.push(t),languageCode:'zh-CN',postRefinement:true});
  effects.forEach(fn=>fn());
  return {hook,calls,changes,statuses,options:()=>options,emit:e=>options.onEvent(e)};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('idle typing and deletion do not flash recording status',async()=>{
  const f=setup();f.hook.onChangeText('已有文字a');f.hook.onChangeText('已有文');await flush();
  assert.deepEqual(f.statuses,[]);assert.equal(f.calls.close,0);
});
test('Chinese homepage opts into refinement without automatic language detection',async()=>{
  const f=setup();await f.hook.toggle();
  assert.deepEqual(Array.from(f.options().candidateLanguages),['zh-CN']);
  assert.equal(f.options().languageIdMode,'at_start');assert.equal(f.options().postRefinement,true);
  assert.equal(f.options().developmentBaseUrl,undefined);
});
test('manual stop accepts final tail without prematurely closing recognition',async()=>{
  const f=setup();await f.hook.toggle();f.emit({type:'partial',text:'明天'});
  await f.hook.toggle();assert.equal(f.calls.stop,1);assert.equal(f.calls.close,0);
  f.emit({type:'done',text:'明天去公园。'});assert.equal(f.changes.at(-1),'已有文字 明天去公园。');
});
test('manual edit rejects late final recognition',async()=>{
  const f=setup();await f.hook.toggle();f.hook.onChangeText('手动改了');
  f.emit({type:'done',text:'过期结果'});await flush();
  assert.equal(f.changes.at(-1),'手动改了');assert.equal(f.calls.close,1);
});
test('editing after done remains idle',async()=>{
  const f=setup();await f.hook.toggle();f.emit({type:'done',text:'明天去公园。'});
  f.statuses.length=0;f.hook.onChangeText('修改');await flush();assert.deepEqual(f.statuses,[]);
});
