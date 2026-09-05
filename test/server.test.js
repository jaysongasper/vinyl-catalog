const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgres://localhost/test';
const{norm,artistNorm,scoreArtworkCandidate}=require('../server');
test('normalization supports conservative matching',()=>{assert.equal(norm('Björk — Post'),'bjork post');assert.equal(artistNorm('The Beatles'),'beatles')});
test('exact artist title and year is a confident artwork match',()=>{const score=scoreArtworkCandidate({artist:'The Beatles',album:'Abbey Road',year:1969},{title:'Abbey Road','first-release-date':'1969-09-26','artist-credit':[{name:'The Beatles'}]});assert.equal(score,140)});
test('wrong artist and title are not automatically selected',()=>{const score=scoreArtworkCandidate({artist:'Miles Davis',album:'Kind of Blue',year:1959},{title:'Blue','first-release-date':'2004','artist-credit':[{name:'Joni Mitchell'}]});assert.ok(score<115)});
test('startup script does not run artwork or legacy metadata backfills',()=>{const pkg=require('../package.json');assert.equal(pkg.scripts.start,'node server.js');assert.ok(!pkg.scripts.start.includes('resolve'));assert.ok(!pkg.scripts.start.includes('artwork'))});
