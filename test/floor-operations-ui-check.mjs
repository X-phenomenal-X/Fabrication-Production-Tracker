import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, chromiumOptions } from './env.mjs';
import { makeFixture } from './fixture.mjs';
const server=http.createServer((req,res)=>{
  const file=path.join(ROOT,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(chromiumOptions());
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=makeFixture();fixture.todos={};
  await page.addInitScript(data=>{if(!localStorage.getItem('bv.cutting.v1'))localStorage.setItem('bv.cutting.v1',JSON.stringify(data));},fixture);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button',{name:'Quick entry',exact:true}).click();
  await page.getByRole('button',{name:'Downtime',exact:true}).click();
  await page.getByLabel('Report details').fill('V22 timed stoppage');await page.getByLabel('Affected machine').selectOption('fom2');
  await page.getByLabel('Downtime reason').selectOption('Equipment');await page.getByLabel('Maintenance status').selectOption('Notified');
  await page.getByRole('button',{name:'Save report',exact:true}).click();
  const report=page.locator('.command-report').filter({hasText:'V22 timed stoppage'});
  await report.getByRole('button',{name:'Start timer',exact:true}).click();await page.reload();
  await report.getByRole('button',{name:'Stop timer',exact:true}).click();assert.match(await report.textContent(),/Notified/);
  await page.getByRole('button',{name:'Quick entry',exact:true}).click();await page.getByRole('button',{name:'Quality',exact:true}).click();
  await page.getByLabel('Report details').fill('V22 quality hold');await page.getByLabel('containment',{exact:true}).fill('Quarantine labelled bundle');
  await page.getByLabel('rejected',{exact:true}).fill('3');await page.getByLabel('Quality stage').selectOption('Contained');
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
  await page.getByLabel('Quality evidence photo').setInputFiles({name:'evidence.png',mimeType:'image/png',buffer:pixel});
  await page.getByRole('button',{name:'Remove photo 1'}).waitFor();await page.getByRole('button',{name:'Save report',exact:true}).click();
  await page.reload();const quality=page.locator('.command-report').filter({hasText:'V22 quality hold'});
  assert.match(await quality.textContent(),/Quarantine labelled bundle/);await quality.getByRole('button',{name:'View 1 evidence photo'}).click();
  assert.equal(await page.locator('dialog img').count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Supervisor report',exact:true}).click();assert.equal(await page.locator('dialog table').count(),2);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();assert.match((await downloadPromise).suggestedFilename(),/supervisor-report/);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('V2.2 UI: phone quick entry, timer reload/stop, quality photo persistence and report export OK');
} finally {await browser.close();await new Promise(r=>server.close(r));}
