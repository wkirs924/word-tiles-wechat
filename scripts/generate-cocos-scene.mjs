import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const out=resolve('apps/client-cocos/assets/scenes');mkdirSync(out,{recursive:true});
const scriptUuid='40f7a64f-b1c4-4bdf-93f0-4e9251096b60';
const base64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function compressUuid(uuid){const raw=uuid.replaceAll('-','');let result=raw.slice(0,2);for(let i=2;i<32;i+=3){const n=parseInt(raw.slice(i,i+3),16);result+=base64[n>>6]+base64[n&63];}return result;}
const ref=n=>({__id__:n});
const vec3=(x=0,y=0,z=0)=>({__type__:'cc.Vec3',x,y,z});
const quat=()=>({__type__:'cc.Quat',x:0,y:0,z:0,w:1});
const node=(name,parent,children,components,position,layer,id)=>({__type__:'cc.Node',_name:name,_objFlags:0,__editorExtras__:{},_parent:ref(parent),_children:children.map(ref),_active:true,_components:components.map(ref),_prefab:null,_lpos:vec3(...position),_lrot:quat(),_lscale:vec3(1,1,1),_mobility:0,_layer:layer,_euler:vec3(),_id:id});
const base=(type,nodeId,id)=>({__type__:type,_name:'',_objFlags:0,__editorExtras__:{},node:ref(nodeId),_enabled:true,__prefab:null,_id:id});
const scene=[
  {__type__:'cc.SceneAsset',_name:'Table',_objFlags:0,__editorExtras__:{},_native:'',scene:ref(1)},
  {__type__:'cc.Scene',_name:'Table',_objFlags:0,__editorExtras__:{},_parent:null,_children:[ref(2),ref(6)],_active:true,_components:[],_prefab:null,_lpos:vec3(),_lrot:quat(),_lscale:vec3(1,1,1),_mobility:0,_layer:1073741824,_euler:vec3(),autoReleaseAssets:false,_globals:ref(8),_id:'62c599b2-46aa-48e5-98bc-681ecb45c8e4'},
  node('Canvas',1,[],[3,4,5],[0,0,0],8192,'4eed136d-62c5-4440-a11e-9a85e9ac7838'),
  {...base('cc.UITransform',2,'4880b788-ef49-424d-81e4-ea0663456af6'),_contentSize:{__type__:'cc.Size',width:1280,height:720},_anchorPoint:{__type__:'cc.Vec2',x:0.5,y:0.5}},
  {...base('cc.Canvas',2,'49df866e-9dd5-4865-84cd-6edf53cb3b12'),_cameraComponent:ref(7),_alignCanvasWithScreen:true},
  {...base(compressUuid(scriptUuid),2,'50b7cf22-cc7b-47e2-9a41-d66d28767994')},
  node('UICamera',1,[],[7],[0,0,1000],8192,'e0952019-50fd-4658-bd82-2c0b4c10eb3d'),
  {...base('cc.Camera',6,'14ff279b-d6b8-4681-9f31-b6cef67ecde2'),_projection:0,_priority:1073741824,_fov:45,_fovAxis:0,_orthoHeight:360,_near:1,_far:2000,_color:{__type__:'cc.Color',r:9,g:29,b:35,a:255},_depth:1,_stencil:0,_clearFlags:0,_rect:{__type__:'cc.Rect',x:0,y:0,width:1,height:1},_aperture:19,_shutter:7,_iso:0,_screenScale:1,_visibility:41951232,_targetTexture:null,_postProcess:null,_usePostProcess:false,_cameraType:-1,_trackingType:0},
  {__type__:'cc.SceneGlobals'}
];
writeFileSync(join(out,'Table.scene'),JSON.stringify(scene,null,2)+'\n');
writeFileSync(join(out,'Table.scene.meta'),JSON.stringify({ver:'1.1.27',importer:'scene',imported:true,uuid:'05c397cf-7657-4512-b1c0-9d38bab99d75',files:['.json'],subMetas:{},userData:{}},null,2)+'\n');
console.log('Generated Cocos Creator Table.scene with Canvas, UI camera, TableBootstrap component.');
