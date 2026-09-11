import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, chromiumOptions } from './env.mjs';

const server=http.createServer((req,res)=>{
  const file=path.join(ROOT,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(chromiumOptions());
try {
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Toronto'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const steps=page.locator('.command-panel').filter({has:page.getByRole('heading',{name:'Suggested next steps',exact:true})});
  await steps.getByRole('button',{name:'Open Setup',exact:true}).click();
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  assert.equal(await page.locator('.overview-schedule-progress').count(),0,'empty schedules do not expose 0% progress');
  await page.getByRole('button',{name:'Supervisor report',exact:true}).click();
  assert.match(await page.locator('dialog').innerText(),/These zeros do not confirm/);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Report downtime',exact:true}).click();
  await page.getByLabel('Report details').fill('Guidance timer check');
  await page.getByLabel('Affected machine').selectOption('fom2');
  await page.getByRole('button',{name:'Save report',exact:true}).click();
  const report=page.locator('.command-report').filter({hasText:'Guidance timer check'});
  await report.getByRole('button',{name:'Start timer',exact:true}).click();
  await steps.getByText('Check running downtime timers',{exact:true}).waitFor();
  await report.getByRole('button',{name:'Stop timer',exact:true}).click();
  await steps.getByText('Verify machine recovery',{exact:true}).waitFor();
  await steps.getByRole('button',{name:'Review report',exact:true}).first().click();
  assert.equal(await page.getByLabel('Report details').inputValue(),'Guidance timer check');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('Guidance UI: empty-state meaning, setup link, running/stopped suggestions, report review and phone reflow OK');
} finally {await browser.close();await new Promise(r=>server.close(r));}
