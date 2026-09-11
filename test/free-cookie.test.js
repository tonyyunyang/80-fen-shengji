import test from 'node:test';
import assert from 'node:assert/strict';
import {mintSession,readSession,cookieName,cookieHeader,SESSION_TTL} from '../cloudflare/session-cookie.js';
const secret='fixture-cookie-signing-key-at-least-32-characters';
test('a signed table cookie cannot select another table or another origin',async()=>{
  const now=Date.UTC(2026,8,11),scope='https://game.example.com';
  const a=await mintSession(secret,now,scope),b=await mintSession(secret,now,scope);
  assert.notEqual(a.id,b.id);
  assert.equal(await readSession(a.value,secret,now,scope),a.id);
  assert.equal(await readSession(a.value.replace(a.id,b.id),secret,now,scope),null);
  assert.equal(await readSession(a.value,secret,now,'https://other.example.com'),null);
  assert.equal(await readSession(a.value,'wrong-key-that-is-long-enough-for-testing',now,scope),null);
  assert.equal(await readSession(a.id,secret,now,scope),null);
});
test('cookie lifetime is bounded and hosted cookies are host-only, Secure and HttpOnly',async()=>{
  const now=Date.UTC(2026,8,11),a=await mintSession(secret,now);
  assert.equal(await readSession(a.value,secret,now+SESSION_TTL+1),null);
  assert.equal(await readSession(a.value,secret,now-120000),null);
  const header=cookieHeader(new URL('https://game.example.com/'),a.value);
  assert.match(header,/^__Host-eighty-free=/);assert.match(header,/HttpOnly; SameSite=Strict; Path=\//);assert.match(header,/; Secure$/);
  assert.equal(header.includes('Domain='),false);
  assert.notEqual(cookieName(new URL('http://127.0.0.1:8231')),cookieName(new URL('http://127.0.0.1:8235')));
});
