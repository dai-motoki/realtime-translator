/**
 * 匿名アクセスログのビーコン。zentou-ops の集約ダッシュボード
 * （https://zentou-ops.vercel.app/admin/site-log）にこのサイトの閲覧を記録する。
 *
 * - 送信先は zentou-ops の共通受信API（site を body で指定）。中継せずブラウザから
 *   直接送る（訪問者の国・都市は zentou-ops 側が訪問者IPから取得するため）。
 * - PII は送らない（匿名 localStorage ID・パス・言語・参照元ホストのみ）。
 * - zentou-ops 側は site と Origin の対応を検証する。本番ドメイン
 *   （airealtimetranslate.com / www / realtime-translator.vercel.app）は許可リスト登録済み。
 *   localhost からは送らない（dev のノイズを混ぜない）。
 */
const ENDPOINT = "https://zentou-ops.vercel.app/api/site-log";
const SITE = "realtime-translator";

export const SITE_LOG_BEACON_JS = `(function(){
try{
var h=location.hostname;
if(h==='localhost'||h==='127.0.0.1')return;
var EP='${ENDPOINT}';
function vid(){try{var v=localStorage.getItem('rt_translate_vid');if(!v){v=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);localStorage.setItem('rt_translate_vid',v);}return v;}catch(e){return '';}}
function ref(){try{var r=document.referrer;if(!r)return '';var u=new URL(r);return (u.origin+u.pathname).slice(0,300);}catch(e){return '';}}
function srcp(){try{var s=new URLSearchParams(location.search).get('utm_source');return s?s.slice(0,32):'';}catch(e){return '';}}
var last='';
function log(){
var p=location.pathname||'/';
if(p===last)return;
last=p;
var d=JSON.stringify({site:'${SITE}',event:'view',path:p.slice(0,300),lang:(document.documentElement.getAttribute('lang')||'').slice(0,16),visitor:vid(),referrer:ref(),source:srcp()});
try{if(navigator.sendBeacon&&navigator.sendBeacon(EP,d))return;}catch(e){}
try{fetch(EP,{method:'POST',body:d,keepalive:true,headers:{'content-type':'text/plain'}}).catch(function(){});}catch(e){}
}
log();
var ps=history.pushState;history.pushState=function(){var r=ps.apply(this,arguments);setTimeout(log,0);return r;};
var rs=history.replaceState;history.replaceState=function(){var r=rs.apply(this,arguments);setTimeout(log,0);return r;};
addEventListener('popstate',function(){setTimeout(log,0);});
}catch(e){}
})();`;
