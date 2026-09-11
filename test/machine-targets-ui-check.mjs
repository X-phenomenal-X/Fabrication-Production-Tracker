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
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button',{name:'Write handover',exact:true}).click();
  await page.locator('.mobile-su-step[title="Multi Punch"]').click();
  await page.getByRole('button',{name:'Add target plan',exact:true}).click();
  assert.equal(await page.getByLabel('Approved standard (windows/hour)',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'Apply to draft',exact:true}).click();
  assert.match(await page.locator('dialog [role=alert]').innerText(),/Enter hourly standard/);
  await page.getByLabel('Approved standard (windows/hour)',{exact:true}).fill('60');
  await page.getByLabel('Available minutes after breaks',{exact:true}).fill('420');
  await page.getByLabel('Planned setup minutes',{exact:true}).fill('30');
  await page.getByRole('button',{name:'Apply to draft',exact:true}).click();
  await page.getByText(/Target 390 windows/).waitFor();
  await page.getByRole('button',{name:/^Save & next/}).click();
  await page.locator('.mobile-su-step[title="Multi Punch"]').click();
  await page.getByRole('button',{name:'Edit target plan',exact:true}).click();
  await page.getByLabel('Good output (windows, optional)',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Apply to draft',exact:true}).click();
  const savedActual=await page.evaluate(async()=>{
    const {state}=await import('/js/store.js');return Object.values(state.shiftLogs).find(l=>l.rows.multipunch)?.rows.multipunch.targetPlan.actual;
  });
  assert.equal(savedActual,null,'applying a draft does not mutate a saved shift');
  await page.getByRole('button',{name:/^Save & next/}).click();
  await page.getByRole('button',{name:'Read',exact:true}).click();
  await page.getByText(/Target 390 windows.*0% of plan/).waitFor();
  await page.reload();
  assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('bv.cutting.v1')).shiftLogs).find(l=>l.rows.multipunch).rows.multipunch.targetPlan.actual),0);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await page.getByRole('button',{name:'Write handover',exact:true}).click();
  await page.getByRole('button',{name:'Write',exact:true}).click();
  await page.locator('#su-saw').getByRole('button',{name:'Add target plan',exact:true}).click();
  await page.getByLabel('Approved standard (pieces/hour)',{exact:true}).fill('60');
  await page.getByLabel('Available minutes after breaks',{exact:true}).fill('420');
  await page.getByLabel('Planned setup minutes',{exact:true}).fill('30');
  await page.getByLabel('Planned bandsaw minutes',{exact:true}).fill('90');
  await page.getByRole('button',{name:'Apply to draft',exact:true}).click();
  await page.locator('#su-saw').getByText(/Target 300 pieces/).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Target UI: phone units, validation, saving, draft isolation, reload and desktop saw allowances OK');
} finally {await browser.close();await new Promise(r=>server.close(r));}
