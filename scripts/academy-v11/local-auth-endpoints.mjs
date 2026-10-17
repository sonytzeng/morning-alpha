import assert from 'node:assert/strict';
const port=(name,fallback)=>{const value=process.env[name]===undefined?fallback:Number(process.env[name]);assert(Number.isSafeInteger(value)&&value>=1024&&value<=65535,'ISOLATED_LOOPBACK_PORT_INVALID');return value;};
export const localAuthPort=port('MA_ISOLATED_AUTH_PORT',55632);
export const localRestPort=port('MA_ISOLATED_REST_PORT',55633);
assert.notEqual(localAuthPort,localRestPort,'ISOLATED_PORT_COLLISION');
export const localAuthBase='http://127.0.0.1:'+localAuthPort;
export const localRestBase='http://127.0.0.1:'+localRestPort;
