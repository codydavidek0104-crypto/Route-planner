/* Local spreadsheet parsing; file contents are never uploaded by this module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.D7Import = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_ROWS = 5000, MAX_COLUMNS = 100;
  const aliases = {
    address: ['fulladdress','completeaddress','mailingaddress','locationaddress','storeaddress','siteaddress','serviceaddress','address'],
    street: ['street','streetaddress','address1','addressline1','street1'],
    city: ['city','town','municipality'], state: ['state','province','region','st'],
    postal: ['zip','zipcode','postal','postalcode','postcode'], country: ['country'],
    label: ['store','storename','location','locationname','business','businessname','customer','customername','name','storeid','storenumber'],
    first: ['first','mustdofirst','priority','dofirst']
  };
  function parseDelimited(text) {
    text = text.replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/,1)[0];
    const score = delimiter => {
      let quoted = false, count = 0;
      for (let i=0;i<firstLine.length;i++) {
        if (firstLine[i] === '"') { if (quoted && firstLine[i+1] === '"') i++; else quoted=!quoted; }
        else if (!quoted && firstLine[i] === delimiter) count++;
      }
      return count;
    };
    const delimiter = [',','\t',';'].sort((a,b)=>score(b)-score(a))[0];
    const rows = []; let row=[], field='', quoted=false, closed=false;
    function cell() { row.push(field); field=''; closed=false; if(row.length>MAX_COLUMNS) throw new Error('Use a sheet with at most 100 columns.'); }
    function endRow() { cell(); rows.push(row); row=[]; if(rows.length>MAX_ROWS+50) throw new Error('Use a sheet with at most 5,000 data rows.'); }
    for(let i=0;i<text.length;i++) {
      const c=text[i];
      if(quoted) {
        if(c==='"') { if(text[i+1]==='"') { field+='"';i++; } else { quoted=false;closed=true; } }
        else field+=c;
      } else if(c==='"' && !field && !closed) quoted=true;
      else if(c===delimiter) cell();
      else if(c==='\n' || c==='\r') { if(c==='\r' && text[i+1]==='\n')i++; endRow(); }
      else { if(closed && c.trim()) throw new Error('CSV contains text after a closing quote.'); if(!closed)field+=c; }
    }
    if(quoted) throw new Error('CSV has an unclosed quoted field.');
    if(field || row.length || closed) endRow();
    return rows;
  }
  function checkZip(buffer) {
    const data = new DataView(buffer); let end=-1;
    for(let i=data.byteLength-22;i>=Math.max(0,data.byteLength-65557);i--) {
      if(data.getUint32(i,true)===0x06054b50 && i+22+data.getUint16(i+20,true)===data.byteLength) { end=i;break; }
    }
    if(end<0) throw new Error('This is not a readable XLSX workbook. Encrypted files and old XLS files are not supported.');
    const entries=data.getUint16(end+10,true), offset=data.getUint32(end+16,true);
    if(entries===65535 || entries>10000) throw new Error('This workbook is too complex. Save just the address sheet as CSV.');
    let pos=offset,total=0;
    for(let i=0;i<entries;i++) {
      if(pos+46>buffer.byteLength || data.getUint32(pos,true)!==0x02014b50) throw new Error('The workbook ZIP directory is damaged.');
      const size=data.getUint32(pos+24,true); total+=size;
      if(size===0xffffffff || total>64*1024*1024) throw new Error('This workbook expands beyond 64 MB. Save the address sheet as CSV.');
      pos+=46+data.getUint16(pos+28,true)+data.getUint16(pos+30,true)+data.getUint16(pos+32,true);
    }
  }
  function cellText(cell) {
    let value=cell.value;
    if(value==null) return '';
    if(typeof value==='object') {
      if(value.error) return value.error;
      if(value.formula || value.sharedFormula) value=value.result;
      else if(value.richText) value=value.richText.map(p=>p.text||'').join('');
      else if(value.text!=null) value=value.text;
      else return ''; // Dates and unsupported cell objects are not addresses.
    }
    if(value==null) return '';
    if(typeof value==='number' && /^0{1,10}$/.test(cell.numFmt||'')) return String(value).padStart(cell.numFmt.length,'0');
    return String(value).trim();
  }
  async function readFile(file, Excel) {
    if(!file || file.size>MAX_FILE_BYTES) throw new Error('Choose a CSV, TSV or XLSX file under 5 MB.');
    if(/\.(csv|tsv)$/i.test(file.name)) return [{name:file.name,rows:parseDelimited(await file.text())}];
    if(!/\.xlsx$/i.test(file.name)) throw new Error('Use XLSX, CSV or TSV. Save older XLS files as XLSX first.');
    if(!Excel || !Excel.Workbook) throw new Error('The XLSX reader did not load. Reload the app or save the sheet as CSV.');
    const buffer=await file.arrayBuffer();checkZip(buffer);
    const workbook=new Excel.Workbook();
    await workbook.xlsx.load(buffer,{ignoreNodes:['drawing','picture','extLst']});
    if(workbook.worksheets.length>100) throw new Error('Use a workbook with at most 100 sheets.');
    return workbook.worksheets.filter(sheet=>sheet.state!=='veryHidden').map(sheet=>{
      if(sheet.rowCount>MAX_ROWS+50 || sheet.columnCount>MAX_COLUMNS) throw new Error('Use a sheet with at most 5,000 data rows and 100 columns.');
      const rows=[];
      for(let i=1;i<=sheet.rowCount;i++) {
        const row=[];
        for(let j=1;j<=sheet.columnCount;j++)row.push(cellText(sheet.getRow(i).getCell(j)));
        rows.push(row);
      }
      return {name:sheet.name,rows};
    });
  }
  const key=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  function mapping(headers) {
    const fields={};
    for(const [field,names] of Object.entries(aliases)) {
      const found=headers.findIndex(header=>names.includes(key(header)));
      fields[field]=found;
    }
    // Address + locality columns means the address cell is a street component.
    if(fields.address>=0 && (fields.city>=0 || fields.state>=0 || fields.postal>=0) && fields.street<0) {
      fields.street=fields.address;fields.address=-1;
    }
    return fields;
  }
  function detect(rows) {
    let best={row:0,fields:mapping(rows[0]||[]),score:-1};
    rows.slice(0,20).forEach((headers,row)=>{
      const fields=mapping(headers);
      const score=(fields.address>=0 || fields.street>=0 ? 5:0)+Object.values(fields).filter(i=>i>=0).length;
      if(score>best.score)best={row,fields,score};
    });
    // Headerless single-column lists are a common simple input.
    const hasHeaders=best.score>=5;
    if(!hasHeaders) return {row:0,hasHeaders:false,fields:{...mapping([]),address:0}};
    return {...best,hasHeaders:true};
  }
  function preview(rows, headerRow, hasHeaders, fields) {
    const start=headerRow+(hasHeaders?1:0), records=[], seen=new Set();
    const value=(row,field)=>fields[field]>=0 ? String(row[fields[field]]||'').trim() : '';
    for(let i=start;i<rows.length;i++) {
      const row=rows[i];
      if(!row.some(v=>String(v||'').trim()))continue;
      let address=value(row,fields.address>=0?'address':'street');
      if(fields.address<0)for(const field of ['city','state','postal','country']) {
        const component=value(row,field);
        const escaped=component.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        if(component && !new RegExp('(^|\\W)'+escaped+'(?=\\W|$)','i').test(address))address+=(address?', ':'')+component;
      }
      const label=value(row,'label').slice(0,128);
      let issue='';
      if(!(fields.address>=0 ? value(row,'address') : value(row,'street')))issue='Missing address/street';
      else if(!/[A-Za-z\u00C0-\uFFFF]/.test(address) || address.length>512 || /^=/.test(address) || /^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!)$/i.test(address))issue='Unusable address';
      const firstValue=value(row,'first');
      if(!issue && firstValue && !/^(yes|y|true|1|first|high|no|n|false|0|normal|low)$/i.test(firstValue))issue='Unrecognized First value; choose a yes/no column or Not used';
      const duplicate=seen.has(address.toLowerCase());seen.add(address.toLowerCase());
      records.push({row:i+1,address,label,first:/^(yes|y|true|1|first|high)$/i.test(firstValue),valid:!issue,issue:issue||(duplicate?'Repeated address; kept as a separate stop':'')});
    }
    return records;
  }
  function instructions(text, count = 500) {
    const parsed={priority:'efficiency',cutoff:40,first:[]};
    if(typeof text!=='string' || text.length>512)throw new Error('Use at most 512 characters of route instructions.');
    for(const raw of text.split(/[;\n]+/).map(s=>s.trim()).filter(Boolean)) {
      const clause=raw.toLowerCase();
      if(/^(reduce driving|efficiency|efficient route)$/.test(clause)) {
        if(parsed.priority!=='efficiency')throw new Error('Choose one directional instruction.');
      } else if(/^(north|south)(ern stops)? first$/.test(clause)) {
        const priority=clause.startsWith('north')?'north':'south';
        if(parsed.priority!=='efficiency' && parsed.priority!==priority)throw new Error('North first and south first cannot both apply.');
        parsed.priority=priority;
      } else if(/^north cutoff\s*:\s*-?\d+(\.\d+)?$/.test(clause)) {
        parsed.cutoff=Number(clause.split(':')[1]);
        if(parsed.cutoff < -90 || parsed.cutoff>90)throw new Error('North cutoff must be a latitude between -90 and 90.');
      } else if(/^first stops\s*:\s*\d+(\s*,\s*\d+)*$/.test(clause)) {
        parsed.first.push(...clause.split(':')[1].split(',').map(Number));
        if(parsed.first.some(n=>n<1 || n>count))throw new Error(`First-stop numbers must refer to the current ${count} stops.`);
      } else throw new Error(`Instruction not understood: “${raw}”. Use the supported patterns shown below.`);
    }
    parsed.first=[...new Set(parsed.first)];return parsed;
  }
  function instructionText(parsed) {
    const clauses=[];
    if(parsed.priority!=='efficiency')clauses.push(parsed.priority+' first');
    if(parsed.cutoff!==40)clauses.push('north cutoff: '+parsed.cutoff);
    if(parsed.first.length)clauses.push('first stops: '+parsed.first.join(', '));
    return clauses.join('; ');
  }
  return {readFile,parseDelimited,mapping,detect,preview,checkZip,instructions,instructionText,MAX_FILE_BYTES};
});
