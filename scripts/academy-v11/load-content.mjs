/** Candidate-only original-content SQL generator, no database connection.
 * Optional PDF directory is a locally QA-approved build, never an arbitrary URL.
 * Generated SQL requires a SEPARATE future publication approval to apply. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const version='ACADEMY_MEMBER_V11';
const manifestUrl=new URL('../../docs/academy/v11/content-manifest.json',import.meta.url);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
export function loadReviewedCourse(path){
 const bytes=readFileSync(path), m=JSON.parse(readFileSync(manifestUrl));
 if(createHash('sha256').update(bytes).digest('hex')!==m.curriculum_sha256)throw Error('UNREVIEWED_CONTENT');
 return JSON.parse(bytes);
}
export function contentSql(curriculum,pdfDir){
 let sql='begin;\n';
 for(const r of curriculum) sql+=`insert into public.academy_lessons_v11(id,version,position,tier,title,content,rights) values(${[r.id,version].map(quote)},${r.position},${[r.tier,r.title,JSON.stringify(r.content),'ORIGINAL_MEMBER_EDUCATION'].map(quote)});\n`;
 if(pdfDir) for(const edition of ['free','premium']){
  const filename=`Morning_Alpha_Academy_${edition}_V11.pdf`, bytes=readFileSync(pdfDir+'/'+filename);
  if(bytes.subarray(0,5).toString()!=='%PDF-'||bytes.length>4000000)throw Error('INVALID_PDF');
  const m=JSON.parse(readFileSync(manifestUrl));
  if(createHash('sha256').update(bytes).digest('hex')!==m.pdf_sha256[edition])throw Error('UNREVIEWED_PDF');
  sql+=`insert into public.academy_pdf_v11(edition,filename,body,rights) values(${quote(edition)},${quote(filename)},decode(${quote(bytes.toString('base64'))},'base64'),'ORIGINAL_MEMBER_EDUCATION');\n`;
 }
 return sql+'commit;\n';
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='--manifest'&&process.argv[3]&&process.argv[4]){
  const bytes=readFileSync(process.argv[3]), rows=JSON.parse(bytes),pdf_sha256={};
  for(const edition of ['free','premium'])pdf_sha256[edition]=createHash('sha256').update(readFileSync(process.argv[4]+`/Morning_Alpha_Academy_${edition}_V11.pdf`)).digest('hex');
  writeFileSync(manifestUrl,JSON.stringify({version,rights:'ORIGINAL_MEMBER_EDUCATION',curriculum_sha256:createHash('sha256').update(bytes).digest('hex'),pdf_sha256,chapters:rows.map(({id,tier,title,position,content})=>({id,tier,title,position,questions:content.questions.length,sha256:createHash('sha256').update(JSON.stringify(content)).digest('hex')}))},null,2)+'\n');
 }else if(process.argv[2]==='--sql'&&process.argv[3]&&process.argv[4])writeFileSync(process.argv[3],contentSql(loadReviewedCourse(process.argv[4]),process.argv[5]),{mode:0o600});
 else throw Error('Use --manifest reviewed-course.json reviewed-pdf-directory, or --sql output-file reviewed-course.json [reviewed-pdf-directory]');
}
