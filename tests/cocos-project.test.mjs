import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';

const root=resolve('apps/client-cocos');
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));

test('Cocos project has a linked entry scene, Canvas, UI camera and bootstrap component',()=>{
  const pkg=readJson(join(root,'package.json'));
  assert.equal(typeof pkg.name,'string');
  const scene=readJson(join(root,'assets/scenes/Table.scene'));
  const scriptMeta=readJson(join(root,'assets/scripts/TableBootstrap.ts.meta'));
  const sceneMeta=readJson(join(root,'assets/scenes/Table.scene.meta'));
  assert.equal(scene[0].__type__,'cc.SceneAsset');assert.equal(scene[1].__type__,'cc.Scene');
  assert.equal(sceneMeta.importer,'scene');assert.equal(scene[5].__type__,compressUuid(scriptMeta.uuid));
  assert.equal(scene[4].__type__,'cc.Canvas');assert.equal(scene[7].__type__,'cc.Camera');
  for(const entity of scene)walk(entity,x=>{if(x&&typeof x==='object'&&Object.keys(x).length===1&&Number.isInteger(x.__id__))assert.ok(x.__id__>=0&&x.__id__<scene.length);});
  assert.equal(scene[4]._cameraComponent.__id__,7);
  assert.equal(scene[5].node.__id__,2);
  assert.deepEqual(scene[1]._children.map(x=>x.__id__),[2,6]);
});
function walk(value,visit){visit(value);if(Array.isArray(value))for(const v of value)walk(v,visit);else if(value&&typeof value==='object')for(const v of Object.values(value))walk(v,visit);}
function compressUuid(uuid){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',raw=uuid.replaceAll('-','');let result=raw.slice(0,2);for(let i=2;i<32;i+=3){const n=parseInt(raw.slice(i,i+3),16);result+=alphabet[n>>6]+alphabet[n&63];}return result;}

test('generated Cocos core exactly follows M1 source and every local import resolves',()=>{
  const hashes=readJson(join(root,'generated-hashes.json'));
  for(const [name,want] of Object.entries(hashes.core)){
    const source=readFileSync(resolve('packages/core/src',`${name}.ts`),'utf8');
    assert.equal(createHash('sha256').update(source).digest('hex'),want,`${name} sync stale`);
  }
  const scripts=join(root,'assets/scripts');
  const preview=readFileSync(resolve('packages/preview/src/local-table.ts'),'utf8');
  const expectedTable=preview.replaceAll("'../../core/src/session.ts'","'./core/session'")
    .replaceAll("'../../core/src/projection.ts'","'./core/projection'")
    .replaceAll("'../../core/src/setup.ts'","'./core/setup'")
    .replaceAll("'../../core/src/rules.ts'","'./core/rules'");
  assert.equal(readFileSync(join(scripts,'generated/LocalTable.ts'),'utf8'),
    `// Generated from packages/preview/src/local-table.ts. Do not edit.\n${expectedTable}`,
    'Cocos local table must keep current random deals and one-round default');
  const files=[];const collect=d=>{for(const entry of readdirSync(d,{withFileTypes:true})){const path=join(d,entry.name);if(entry.isDirectory())collect(path);else if(path.endsWith('.ts'))files.push(path);}};collect(scripts);
  for(const file of files){
    const body=readFileSync(file,'utf8');
    for(const [,target] of body.matchAll(/from\s+['"](\.[^'"]+)['"]/g)){
      assert.equal(existsSync(resolve(dirname(file),`${target}.ts`)),true,`${file} imports missing ${target}`);
    }
  }
  assert.equal(files.length,10);
});
