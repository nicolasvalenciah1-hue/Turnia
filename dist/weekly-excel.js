'use strict';
// Offline-friendly XLSX writer for Turnia's weekly statement. No external CDN,
// credentials, or payment API. Stores standard OOXML parts in an uncompressed ZIP.
(function(root){
  const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const encoder=new TextEncoder();
  const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const safeText=v=>{const s=String(v??'');return /^[\s]*[=+@-]/.test(s)?"'"+s:s;};
  const col=n=>{let s='';for(let x=n+1;x>0;x=Math.floor((x-1)/26))s=String.fromCharCode(65+(x-1)%26)+s;return s;};
  const crcTable=(()=>{const list=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;list.push(c>>>0);}return list;})();
  const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const join=parts=>{const total=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(total);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;};
  const zip=files=>{
    const chunks=[],directory=[];let pos=0;
    for(const [filename,text] of files){
      const name=encoder.encode(filename),bytes=encoder.encode(text),crc=crc32(bytes);
      if(name.length>65535)throw Error('Nombre XLSX inválido.');
      const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
      l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);
      l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);
      l.setUint16(26,name.length,true);local.set(name,30);
      chunks.push(local,bytes);
      const central=new Uint8Array(46+name.length),d=new DataView(central.buffer);
      d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);
      d.setUint16(8,0x0800,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);
      d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,pos,true);
      central.set(name,46);directory.push(central);pos+=local.length+bytes.length;
    }
    const dir=join(directory),end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,directory.length,true);v.setUint16(10,directory.length,true);
    v.setUint32(12,dir.length,true);v.setUint32(16,pos,true);
    return new Blob([...chunks,dir,end],{type:MIME});
  };
  const formats=['<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0;[Red](&quot;$&quot;#,##0)"/>'];
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<numFmts count="1">'+formats.join('')+'</numFmts>'+
    '<fonts count="5"><font><sz val="11"/><name val="Aptos"/></font>'+
    '<font><b/><sz val="17"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>'+
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>'+
    '<font><b/><sz val="11"/><color rgb="FF14283F"/></font>'+
    '<font><sz val="10"/><color rgb="FF637180"/></font></fonts>'+
    '<fills count="4"><fill><patternFill patternType="none"/></fill>'+
    '<fill><patternFill patternType="gray125"/></fill>'+
    '<fill><patternFill patternType="solid"><fgColor rgb="FF14283F"/><bgColor indexed="64"/></patternFill></fill>'+
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE7F3F1"/><bgColor indexed="64"/></patternFill></fill></fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="7">'+
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>'+
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>'+
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1"/>'+
    '<xf numFmtId="164" fontId="3" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyNumberFormat="1"/>'+
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>'+
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function sheetXml(spec){
    const headers=spec.headers,rows=spec.rows||[],widths=spec.widths||[];
    const money=new Set(spec.money||[]),count=headers.length;
    if(!count||count>80)throw Error('Columnas XLSX inválidas.');
    const cells=(values,index,kind)=>{
      const result=[];
      for(let i=0;i<Math.min(count,values.length);i++){
        const value=values[i];if(value===null||value===undefined||value==='')continue;
        const ref=col(i)+index,isNumber=typeof value==='number'&&Number.isFinite(value);
        const style=kind==='title'?1:kind==='header'?2:kind==='total'?(isNumber&&money.has(i)?5:4):
          kind==='meta'?6:isNumber&&money.has(i)?3:0;
        if(isNumber)result.push('<c r="'+ref+'" s="'+style+'"><v>'+value+'</v></c>');
        else result.push('<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(safeText(value))+'</t></is></c>');
      }
      return '<row r="'+index+'"'+(kind==='title'?' ht="35" customHeight="1"':'')+'>'+result.join('')+'</row>';
    };
    const content=[
      cells([spec.title],1,'title'),cells([spec.subtitle],2,'meta'),
      cells([spec.note||'Montos expresados en pesos chilenos (CLP).'],3,'meta'),
      '<row r="4"/>',cells(headers,5,'header'),
      ...rows.map((v,i)=>cells(v,i+6,'data'))
    ];
    if(spec.total)content.push(cells(spec.total,rows.length+6,'total'));
    const cols=headers.map((h,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+(widths[i]||Math.max(14,Math.min(27,String(h).length+7)))+'" customWidth="1"/>').join('');
    const bottom=5+rows.length;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<dimension ref="A1:'+col(count-1)+(bottom+(spec.total?1:0))+'"/>'+
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="16"/><cols>'+cols+'</cols><sheetData>'+content.join('')+'</sheetData>'+
      (rows.length?'<autoFilter ref="A5:'+col(count-1)+bottom+'"/>':'')+
      '<mergeCells count="2"><mergeCell ref="A1:'+col(count-1)+'1"/><mergeCell ref="A2:'+col(count-1)+'2"/></mergeCells></worksheet>';
  }
  function build(sheets){
    if(!Array.isArray(sheets)||!sheets.length||sheets.length>20)throw Error('Hojas XLSX inválidas.');
    const files=[
      ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/styles.xml',styles]
    ];
    const overrides=['<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>','<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
    const nodes=[],rels=[];
    for(let i=0;i<sheets.length;i++){
      const sheet=sheets[i],name=sheet.name||'Hoja '+(i+1);
      if(name.length>31||/[\\\/?*\[\]:]/.test(name))throw Error('Nombre de hoja XLSX inválido.');
      nodes.push('<sheet name="'+xml(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>');
      rels.push('<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>');
      files.push(['xl/worksheets/sheet'+(i+1)+'.xml',sheetXml(sheet)]);
      overrides.push('<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    }
    rels.push('<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    files.push(['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>'+nodes.join('')+'</sheets></workbook>']);
    files.push(['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>']);
    files.push(['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+overrides.join('')+'</Types>']);
    return zip(files);
  }
  function download(sheets,filename){
    const blob=build(sheets),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return blob;
  }
  root.TurniaXlsx={build,download};
})(typeof window!=='undefined'?window:globalThis);
