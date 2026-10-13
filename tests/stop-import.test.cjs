const {test}=require('node:test');
const assert=require('node:assert/strict');
const Import=require('../stop-import.js');
const Excel=require('../vendor/exceljs.min.js');

test('CSV parser preserves quoted commas/newlines, BOM, empty rows and semicolon/TSV input',()=>{
  assert.deepEqual(Import.parseDelimited('\uFEFFName,Address\r\n"Store, One","12 Oak St\nSuite 4"\r\n\r\n'),[['Name','Address'],['Store, One','12 Oak St\nSuite 4'],['']]);
  assert.deepEqual(Import.parseDelimited('Store;Address\nA;12 Oak St'),[['Store','Address'],['A','12 Oak St']]);
  assert.deepEqual(Import.parseDelimited('Store\tAddress\nA\t12 Oak St'),[['Store','Address'],['A','12 Oak St']]);
  assert.throws(()=>Import.parseDelimited('Name,Address\nA,"open'),/unclosed/);
});
test('mixed complete/street-only reference format joins locality once and preserves store IDs',()=>{
  const rows=[['Stop #','Address','Store #','City','State','ZIP'],
    ['1','120 Example Rd, Example Town, FL 33026','669','Example Town','FL','33026'],
    ['4','3122-9 Example Drive','112','Sample Town','FL','32308'],
    ['5','','113','Sample City','FL','33618'],[],['6','12345','114','','',''],
    ['7','120 Example Rd, Example Town, FL 33026','670','Example Town','FL','33026']];
  const detected=Import.detect(rows), records=Import.preview(rows,detected.row,detected.hasHeaders,detected.fields);
  assert.equal(records[0].address,'120 Example Rd, Example Town, FL 33026');
  assert.equal(records[0].label,'669');
  assert.equal(records[1].address,'3122-9 Example Drive, Sample Town, FL, 32308');
  assert.equal(records[2].valid,false);assert.equal(records[3].valid,false);
  assert.equal(records[4].valid,true);assert.match(records[4].issue,/Repeated/);
});
test('header detection handles a title row and headerless lists without discarding the first stop',()=>{
  const detected=Import.detect([['Job 101'],[],['Store name','Street','City','State','Postal code']]);
  assert.equal(detected.row,2);assert.equal(detected.fields.street,1);
  const rows=[['12 Oak St'],['40 Main St']];const simple=Import.detect(rows);
  assert.equal(simple.hasHeaders,false);assert.equal(Import.preview(rows,0,false,simple.fields).length,2);
});
test('instructions are explicit, optional, bounded and reject unknown or conflicting requests',()=>{
  assert.deepEqual(Import.instructions('',100),{priority:'efficiency',cutoff:40,first:[]});
  assert.deepEqual(Import.instructions('north first; first stops: 2, 5; north cutoff: 42',100),{priority:'north',cutoff:42,first:[2,5]});
  assert.throws(()=>Import.instructions('avoid snow and visit the red stores',100),/not understood/);
  assert.throws(()=>Import.instructions('north first; south first',100),/cannot both/);
  assert.throws(()=>Import.instructions('first stops: 101',100),/current 100/);
});
for(const count of [92,100,125])test(`real XLSX encoding/reading supports ${count} synthetic address rows`,async()=>{
  const workbook=new Excel.Workbook();workbook.addWorksheet('Cover').addRow(['Job summary']);
  const sheet=workbook.addWorksheet('Job stops');sheet.addRow(['Store #','Street','City','State','ZIP','Must do first']);
  for(let i=0;i<count;i++){
    const row=sheet.addRow([i+1,`${i+1} Oak St`,'Boston','MA',2108,i===1?'yes':'']);
    row.getCell(5).numFmt='00000';
  }
  const bytes=await workbook.xlsx.writeBuffer();
  const file={name:'job.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  const sheets=await Import.readFile(file,Excel);assert.equal(sheets.length,2);
  const actual=sheets.find(s=>s.name==='Job stops');const detected=Import.detect(actual.rows);
  const records=Import.preview(actual.rows,detected.row,detected.hasHeaders,detected.fields);
  assert.equal(records.length,count);assert.equal(records.every(r=>r.valid),true);
  assert.match(records[0].address,/02108$/);assert.equal(records[1].first,true);
});
test('file size, file types and archive expansion are checked before workbook parsing',async()=>{
  await assert.rejects(Import.readFile({name:'job.xlsx',size:5*1024*1024+1},Excel),/under 5 MB/);
  await assert.rejects(Import.readFile({name:'job.xls',size:1},Excel),/older XLS/);
  assert.throws(()=>Import.checkZip(new ArrayBuffer(32)),/not a readable/);
  const bytes=new ArrayBuffer(68),view=new DataView(bytes);
  view.setUint32(0,0x02014b50,true);view.setUint32(24,65*1024*1024,true);
  view.setUint32(46,0x06054b50,true);view.setUint16(56,1,true);
  assert.throws(()=>Import.checkZip(bytes),/64 MB/);
});
