import { describe,it,expect } from 'vitest';
import { extractAnalysisRecord } from './record';
const url='https://www.nhl.com/gamecenter/mtl-vs-chi/2026/10/23/2026020166';
const key='nhl:2026-10-23:mtl@chi:id-2026020166';
const make=()=>({version:1,sport:'nhl',events:[{event_key:key,label:'Montreal at Chicago',starts_at:null,source_url:url,analysis_status:'WAIT'}],recommendations:[{item_key:'chi_tt_1023',event_key:'nhl:2026-10-2026020166',market:'Team total',selection:'Chicago',decision:'WAIT',suggested_units:0,price_gate:null}]});
const wrap=(r:unknown)=>`Montreal at Chicago [Gamecenter](${url})\n\n\`\`\`analysis-record\n${JSON.stringify(r)}\n\`\`\``;
describe('bounded NHL key recovery',()=>{
 it('corrects only an orphan with exact official ID and visible identity',()=>{const x=extractAnalysisRecord(wrap(make()),'nhl',[{url,title:'NHL'}]);expect(x.record?.recommendations[0].event_key).toBe(key);expect(x.recommendation_key_corrections).toHaveLength(1);});
 it.each(['nhl:2026-11-2026020166','nhl:2026-10-2026020167','nhl:2026-10-23:bos@chi:id-2026020166'])('rejects unmatched or valid other key %s',bad=>{const r=make();r.recommendations[0].event_key=bad;expect(extractAnalysisRecord(wrap(r),'nhl',[{url,title:'NHL'}]).record).toBeNull();});
 it('rejects positive units during correction',()=>{const r=make();r.recommendations[0].suggested_units=1;expect(extractAnalysisRecord(wrap(r),'nhl',[{url,title:'NHL'}]).record).toBeNull();});
 it.each(['japanopentennis.com','www.japanopentennis.com','protennislive.com','www.protennislive.com'])('accepts searched exact tennis host %s',host=>{const u=`https://${host}/op.pdf`;const r={version:1,sport:'tennis',events:[{...make().events[0],event_key:'tennis:2026-10-23:alice@betty:src',source_url:u}],recommendations:[]};const text=`[PDF](${u})\n\n\`\`\`analysis-record\n${JSON.stringify(r)}\n\`\`\``;expect(extractAnalysisRecord(text,'tennis',[{url:u,title:'PDF'}]).record).not.toBeNull();expect(extractAnalysisRecord(text,'tennis',[]).failure?.code).toBe('unverified_source');});
 it('requires the expected scope date, visible label, searched URL and exact URL game ID',()=>{
  const r=make();
  expect(extractAnalysisRecord(wrap(r),'nhl',[{url,title:'NHL'}],new Date(),{scopeDate:'2026-10-24'}).record).toBeNull();
  expect(extractAnalysisRecord(wrap(r).replace('Montreal at Chicago [','Other game ['),'nhl',[{url,title:'NHL'}]).record).toBeNull();
  expect(extractAnalysisRecord(wrap(r),'nhl',[]).record).toBeNull();
  const changed=make();changed.events[0].source_url=url.replace('2026020166','2026020167');
  expect(extractAnalysisRecord(wrap(changed).replace(url,changed.events[0].source_url),'nhl',[{url:changed.events[0].source_url,title:'NHL'}]).record).toBeNull();
 });
 it('rejects ambiguous IDs and event or recommendation BET decisions',()=>{
  const r=make();r.events.push({...r.events[0],event_key:key.replace('mtl@chi','bos@chi')});
  expect(extractAnalysisRecord(wrap(r),'nhl',[{url,title:'NHL'}]).record).toBeNull();
  for(const kind of ['event','recommendation']){const x=make();if(kind==='event')x.events[0].analysis_status='BET';else x.recommendations[0].decision='BET';expect(extractAnalysisRecord(wrap(x),'nhl',[{url,title:'NHL'}]).record).toBeNull();}
 });

 it('rejects an official URL whose explicit date differs',()=>{const r=make();r.events[0].source_url=url.replace('/10/23/','/10/24/');const text=wrap(r).replace(url,r.events[0].source_url);expect(extractAnalysisRecord(text,'nhl',[{url:r.events[0].source_url,title:'NHL'}]).record).toBeNull();});

 it.each([
  'https://www.nhl.com/2026020166/gamecenter/2026020999',
  'https://www.nhl.com/gamecenter/2026020166/2026020999',
  'https://www.nhl.com/gamecenter/2026020999?game=2026020166',
  'https://www.nhl.com/gamecenter/2026020166/2026020166',
 ])('rejects a Gamecenter URL whose game ID path is ambiguous or wrong: %s',sourceUrl=>{
  const r=make();r.events[0].source_url=sourceUrl;
  expect(extractAnalysisRecord(wrap(r).replace(url,sourceUrl),'nhl',[{url:sourceUrl,title:'NHL'}]).record).toBeNull();
 });
 it('accepts the deliberate short Gamecenter ID path',()=>{
  const sourceUrl='https://www.nhl.com/gamecenter/2026020166';const r=make();r.events[0].source_url=sourceUrl;
  expect(extractAnalysisRecord(wrap(r).replace(url,sourceUrl),'nhl',[{url:sourceUrl,title:'NHL'}]).record?.recommendations[0].event_key).toBe(key);
 });

});
