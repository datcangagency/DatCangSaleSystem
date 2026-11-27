// Kiem thu giao dien bang jsdom: dang nhap -> man Them lead hien -> luu lead -> danh sach
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');const fs=require('fs');
const html=fs.readFileSync(__dirname+'/../Index.html','utf8');
const calls=[];
const server={
 login:()=>({ok:true,token:'t',user:{username:'u',ten:'Trung',role:'Sale',doiMK:false}}),
 layDanhMuc:()=>({ok:true,dm:{giaiDoan:['Mới','Đã liên hệ','Đã ký','Mất'],nguon:['Khách cho số','Tự tìm'],sale:['Trung','An'],qlda:['Thảo']}}),
 themLead:(t,d)=>{calls.push(d);return {ok:true,ma:'L-2611-009'}},
 danhSachLead:()=>({ok:true,leads:[{ma:'L-2611-009',ngayNhan:'27/11/2026',ten:'A',sdt:'0912345678',nguon:'Tự tìm',sale:'Trung',giaiDoan:'Mới',ngayDoiGd:'27/11/2026',hanhDong:'Gọi',ngayHd:'28/11/2026'}]}),
 phien:()=>({expired:true}),logout:()=>({ok:true})};
const dom=new JSDOM(html,{runScripts:'dangerously',beforeParse(w){
 const mk=(sh,fh)=>({withSuccessHandler(f){return mk(f,fh)},withFailureHandler(f){return mk(sh,f)}});
 w.google={script:{run:new Proxy({},{get:(_,fn)=>fn==='withSuccessHandler'||fn==='withFailureHandler'?undefined:undefined})}};
 w.google.script.run=(function(){let sh;const o={withSuccessHandler(f){sh=f;return o},withFailureHandler(){return o}};
  ['login','layDanhMuc','themLead','danhSachLead','phien','logout','doiMatKhau','doiGiaiDoan'].forEach(n=>o[n]=(...a)=>{setTimeout(()=>sh&&sh(server[n]?server[n](...a):{ok:true}),0)});return o})();
}});
const d=dom.window.document,$=i=>d.getElementById(i),vis=i=>!$(i).classList.contains('hidden');
const wait=()=>new Promise(r=>setTimeout(r,20));
let pass=0,fail=0;const ok=(c,n)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n)};
(async()=>{
 ok(vis('vLogin'),'hien man dang nhap');
 $('lu').value='u';$('lp').value='p';dom.window.doLogin();await wait();await wait();
 ok(vis('vApp')&&!vis('vLogin'),'dang nhap xong vao ung dung');
 ok(vis('pAdd'),'man Them lead hien sau dang nhap');
 dom.window.show('list');await wait();await wait();
 ok(vis('pList')&&!vis('pAdd')&&$('tb').children.length===1,'bam Danh sach: hien bang 1 lead');
 dom.window.show('add');ok(vis('pAdd')&&!vis('pList'),'bam + Them lead: hien form');
 ok($('aSale').value==='Trung'&&$('aSale').disabled,'Sale tu chon chinh minh, khong sua duoc');
 $('aNguon').value='Tự tìm';$('aTen').value='A';$('aSdt').value='0912345678';$('aHd').value='Goi';$('aNgayHd').value='2026-11-28';
 dom.window.doAdd();await wait();
 ok(calls.length===1&&calls[0].sdt==='0912345678'&&/Đã lưu/.test($('am').textContent),'luu lead, hien ma: '+$('am').textContent);
 console.log(pass+' pass, '+fail+' fail');process.exit(fail?1:0)})();
