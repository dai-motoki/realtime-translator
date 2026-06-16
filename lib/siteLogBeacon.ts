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
 *
 * 1行=1閲覧。発火するのは「URLパスの変化」と「マイページ言語の切替」の両方。
 * 言語は i18n プロバイダ（lib/i18n.tsx）が <html lang> を更新するので、その属性変化を
 * MutationObserver で監視して再送する。path と lang の組が前回と同じ送信はスキップする
 * （重複防止）。送信は短いデバウンスでまとめ、初回ロード時の en→保存言語の遷移は
 * 1行に集約する（途中の en だけのノイズ行を残さない）。
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
var timer=null;
function send(){
timer=null;
var p=location.pathname||'/';
var lang=(document.documentElement.getAttribute('lang')||'').slice(0,16);
var key=p+'|'+lang;
if(key===last)return;
last=key;
var d=JSON.stringify({site:'${SITE}',event:'view',path:p.slice(0,300),lang:lang,visitor:vid(),referrer:ref(),source:srcp()});
try{if(navigator.sendBeacon&&navigator.sendBeacon(EP,d))return;}catch(e){}
try{fetch(EP,{method:'POST',body:d,keepalive:true,headers:{'content-type':'text/plain'}}).catch(function(){});}catch(e){}
}
function log(){if(timer)clearTimeout(timer);timer=setTimeout(send,60);}
log();
var ps=history.pushState;history.pushState=function(){var r=ps.apply(this,arguments);setTimeout(log,0);return r;};
var rs=history.replaceState;history.replaceState=function(){var r=rs.apply(this,arguments);setTimeout(log,0);return r;};
addEventListener('popstate',function(){setTimeout(log,0);});
try{var mo=new MutationObserver(function(){log();});mo.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});}catch(e){}
}catch(e){}
})();`;
