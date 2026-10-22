const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/settings.js'), 'utf8');
const nodes = new Map();
const fields=['account-visibility','comment-privacy','show-activity-status','message-privacy','content-visibility'];
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {value:'',disabled:false,innerHTML:'',handlers:{},addEventListener(type,callback){this.handlers[type]=callback;},querySelectorAll(){return id==='privacy-form'?[...fields.map(node),node('save-button')]:[];}});
  return nodes.get(id);
}
const stored={account_visibility:'private',comment_privacy:'nobody',show_activity_status:false,message_privacy:'following',content_visibility:'followers'};
const calls=[];
let failSettings=false;
const context={console,URL,URLSearchParams,Date,
 document:{addEventListener(){},getElementById:node,querySelectorAll(){return [];},querySelector(){return null;},createElement(){return {set textContent(value){this.text=String(value);},get innerHTML(){return this.text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}};}},
 window:{location:{origin:'http://localhost'}},showToast(){},
 Api:{async get(url){if(url==='/api/account/settings'){if(failSettings)throw new Error('offline');return {...stored};}if(url==='/api/account/status')return {is_active:true};return [];},async patch(url,body){calls.push(JSON.parse(JSON.stringify({url,body})));return {...body};}}
};
vm.createContext(context);
vm.runInContext(source+'\nthis.__setup=setupExpandedSettings; this.__load=loadAccountSettings; this.__apply=applyAccountSettings;',context);
(async()=>{
 context.__setup(); await new Promise(setImmediate);
 assert.equal(node('account-visibility').value,'private');
 assert.equal(node('show-activity-status').value,'false');
 assert.equal(node('message-privacy').disabled,false);
 context.__apply({message_privacy:'nobody'});
 assert.equal(node('account-visibility').value,'private');
 node('comment-privacy').value='followers';
 await node('privacy-form').handlers.submit({preventDefault(){}});
 assert.deepEqual(calls[0],{url:'/api/account/settings',body:{account_visibility:'private',comment_privacy:'followers',show_activity_status:false,message_privacy:'nobody',content_visibility:'followers'}});
 assert.equal(node('save-button').disabled,false);
 failSettings=true; await context.__load();
 assert.equal(node('save-button').disabled,true);
 await node('privacy-form').handlers.submit({preventDefault(){}});
 assert.equal(calls.length,1,'failed reads must never overwrite saved privacy with defaults');
 console.log('PRIVACY_SETTINGS_BEHAVIOR_OK: actual submit payload, false preservation, partial apply, and fail-closed loading');
})().catch(error=>{console.error(error);process.exitCode=1;});
