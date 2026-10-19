// Test process only. Do not claim this JavaScript preload is an OS sandbox.
const {syncBuiltinESMExports}=require('node:module');
const deny=()=>{throw Error('C_WORKER_TEST_NETWORK_DENIED');};
globalThis.fetch=deny;
for(const name of ['node:http','node:https']){
 const port=require(name);port.request=deny;port.get=deny;
}
const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;
const tls=require('node:tls');tls.connect=deny;
const dns=require('node:dns');for(const name of ['lookup','resolve','resolve4','resolve6','resolveAny','reverse'])dns[name]=deny;
for(const name of ['lookup','resolve','resolve4','resolve6','resolveAny','reverse'])dns.promises[name]=async()=>deny();
syncBuiltinESMExports();
