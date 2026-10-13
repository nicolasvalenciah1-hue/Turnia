// Checks real XLSX ZIP structure, numeric amounts, and injection-safe text.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
(async()=>{
  const dom=new JSDOM('<html><body></body></html>',{url:'https://turnia.test/',runScripts:'outside-only'});
  const w=dom.window;
  w.TextEncoder=TextEncoder;
  w.eval(fs.readFileSync(__dirname+'/../dist/weekly-excel.js','utf8'));
  assert.equal(typeof w.TurniaXlsx.build,'function');
  const book=w.TurniaXlsx.build([
    {name:'Cierre semanal',title:'TURNIA · CIERRE SEMANAL',subtitle:'Semana 5 al 11 de octubre de 2026',
      headers:['Trabajador','Área','Monto CLP'],rows:[['=MALICIOUS','Garzones',30000],['Francisca González','Cocina',20000]],
      total:['TOTAL','',50000],money:[2],widths:[25,25,18]},
    {name:'Transferencias',title:'CONTROL DE TRANSFERENCIAS',subtitle:'Sin pagos confirmados',
      headers:['Persona','Monto CLP','Banco'],rows:[['Francisca González',30000,'']],money:[1]}
  ]);
  assert.equal(book.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const bytes=new Uint8Array(await new Promise((resolve,reject)=>{
    const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(book);
  }));
  const data=Buffer.from(bytes);
  assert.equal(data.readUInt32LE(0),0x04034b50,'Standard XLSX ZIP local header');
  let offset=0;const files=new Map();
  while(offset+30<data.length&&data.readUInt32LE(offset)===0x04034b50){
    const size=data.readUInt32LE(offset+18);
    const length=data.readUInt16LE(offset+26);
    const extra=data.readUInt16LE(offset+28);
    const filename=data.subarray(offset+30,offset+30+length).toString('utf8');
    const contentStart=offset+30+length+extra;
    files.set(filename,data.subarray(contentStart,contentStart+size).toString('utf8'));
    offset=contentStart+size;
  }
  for(const required of ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/styles.xml','xl/_rels/workbook.xml.rels','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml'])assert(files.has(required),required);
  for(const [filename,content] of files){
    const doc=new w.DOMParser().parseFromString(content,'application/xml');
    assert.equal(doc.getElementsByTagName('parsererror').length,0,'Valid Excel XML: '+filename);
  }
  const statement=files.get('xl/worksheets/sheet1.xml');
  assert(statement.includes("'=MALICIOUS"),'Cell data never executes formulas');
  assert(statement.includes('Francisca González'),'Unicode names preserved');
  assert(statement.includes('<v>30000</v>'),'Currency stored as numeric CLP');
  assert(statement.includes('<v>50000</v>'),'Workbook has correct weekly total');
  assert(statement.includes('autoFilter'),'Closing sheet is filterable');
  assert(statement.includes('mergeCell'),'Sheet title uses merged cells');
  assert(files.get('xl/workbook.xml').includes('Transferencias'));
  assert(data.readUInt32LE(offset)===0x02014b50,'Valid ZIP central directory follows file entries');
  dom.window.close();
  console.log('Weekly XLSX export validated');
})().catch(error=>{console.error(error);process.exitCode=1;});
