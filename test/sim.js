const fs=require('fs'),crypto=require('crypto'),vm=require('vm');
const tabs={'Tài khoản':[['Tên đăng nhập','Họ tên','Vai trò','Salt','Hash','Phải đổi MK','Số lần sai','Khóa đến','Hoạt động']],
'Lead':[['Mã lead','Ngày nhận','Tên khách','SĐT','Nguồn','Sale','Giai đoạn','Ngày đổi GĐ','Tóm lược','Hành động','Ngày HĐ','Giá trị','Lý do mất','Ghi chú','Tạo lúc','Người sửa','Sửa lúc']],
'Nhật ký':[['t','u','a','o','d']],'Bộ đếm':[['Khóa','Giá trị']],
'Danh mục':[['Giai đoạn','Nguồn','Sale','QLDA'],['Mới','Khách cho số','Trung','Thảo'],['Đã liên hệ','Tự tìm','An','Nhung'],['Hẹn tư vấn','','Linh',''],['Đã ký','','Dương',''],['Mất'],['Không tiềm năng']]};
function mkSheet(n){const g=()=>tabs[n];return{
 getDataRange:()=>({getValues:()=>g().map(r=>r.slice())}),
 appendRow:r=>g().push(r.slice()),
 getLastRow:()=>g().length,
 getRange:(r,c,nr=1,nc=1)=>({setValues:v=>{for(let i=0;i<nr;i++)for(let j=0;j<nc;j++){while(g().length<r+i)g().push([]);g()[r-1+i][c-1+j]=v[i][j]}},
  setValue:function(v){g()[r-1][c-1]=v;return this},setNumberFormat:function(){return this}})}}
const store={};
const ctx={Logger:{log:()=>{}},
 SpreadsheetApp:{openById:()=>({getSheetByName:n=>tabs[n]?mkSheet(n):null})},
 Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:(d,tz,f)=>{const p=n=>('0'+n).slice(-2),y=d.getFullYear(),m=p(d.getMonth()+1),dd=p(d.getDate());
   return f==='yyMM'?String(y).slice(2)+m:f==='HH:mm'?p(d.getHours())+':'+p(d.getMinutes()):f==='dd/MM/yyyy'?dd+'/'+m+'/'+y:dd+'/'+m+'/'+y+' '+p(d.getHours())+':'+p(d.getMinutes())},
  computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()].map(x=>x>127?x-256:x),
  base64Encode:b=>Buffer.from(b.map(x=>x&255)).toString('base64'),
  DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1}},
 CacheService:{getScriptCache:()=>({get:k=>store[k]||null,put:(k,v)=>{store[k]=v},remove:k=>{delete store[k]}})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 HtmlService:{}, Date, Number, String, JSON, Error, parseInt, isNaN};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../Code.gs','utf8').replace('__DB_ID__','x'),ctx);
let pass=0,fail=0;const ok=(c,n)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n)};
const R=e=>vm.runInContext(e,ctx);
ctx.__pw=null;
R("var __logs=[];Logger.log=function(s){__logs.push(s)}");
R("khoiTaoThu()");
const logs=R("__logs");
const pw=(logs.find(l=>l.includes('sale_thu'))||'').split('mật khẩu tạm: ')[1].split(' ')[0];
ok(!!pw,'tạo tài khoản thử, có mật khẩu tạm');
ok(!JSON.stringify(tabs['Tài khoản']).includes(pw),'mật khẩu không lưu dạng rõ');
let r=R(`login('sale_thu','sai')`);ok(!r.ok,'sai mật khẩu bị từ chối');
for(let i=0;i<4;i++)R(`login('sale_thu','sai')`);
r=R(`login('sale_thu','${pw}')`);ok(!r.ok&&/khóa/.test(r.msg),'khóa sau 5 lần sai, đúng mật khẩu vẫn bị khóa: '+r.msg);
tabs['Tài khoản'][2][7]='';tabs['Tài khoản'][2][6]=0;
r=R(`login('sale_thu','${pw}')`);ok(r.ok&&r.user.doiMK,'đăng nhập đúng, buộc đổi mật khẩu');
const tk=r.token;
const lead={ngayNhan:'2026-11-27',nguon:'Khách cho số',ten:'Khách thử',sdt:'0912 345 678',sale:'Trung',giaTri:'5000000',tomLuoc:'Nhà hàng, fanpage x',hanhDong:'Gọi tư vấn',ngayHanhDong:'2026-11-28'};
r=R(`themLead('${tk}',${JSON.stringify(lead)})`);ok(!r.ok&&/Đổi mật khẩu/.test(r.msg),'chưa đổi MK thì chưa thêm được lead');
r=R(`doiMatKhau('${tk}','${pw}','abc')`);ok(!r.ok,'mật khẩu mới quá ngắn bị từ chối');
r=R(`doiMatKhau('${tk}','${pw}','MatKhauMoi2026')`);ok(r.ok,'đổi mật khẩu thành công');
r=R(`login('sale_thu','MatKhauMoi2026')`);ok(r.ok&&!r.user.doiMK,'đăng nhập mật khẩu mới');
const t2=r.token;
r=R(`themLead('${t2}',${JSON.stringify(lead)})`);ok(r.ok&&/^L-\d{4}-001$/.test(r.ma),'thêm lead, mã tự sinh: '+r.ma);
const ma1=r.ma;
r=R(`themLead('${t2}',${JSON.stringify(lead)})`);ok(!r.ok&&/đã có/.test(r.msg),'trùng SĐT bị chặn');
r=R(`themLead('${t2}',${JSON.stringify({...lead,sdt:'0987654321',ten:'=HYPERLINK("x")'})})`);ok(r.ok&&/002$/.test(r.ma),'lead 2 mã tăng: '+r.ma);
ok(String(tabs['Lead'][2][2]).startsWith("'="),'chống chèn công thức');
r=R(`themLead('${t2}',${JSON.stringify({...lead,sdt:'0911111111',sale:'An'})})`);ok(r.ok&&tabs['Lead'][3][5]==='Trung','Sale chỉ tạo lead cho chính mình (sale bị ép về Trung)');
r=R(`themLead('${t2}',${JSON.stringify({...lead,sdt:'12',nguon:'x',ngayHanhDong:'2026-11-01'})})`);ok(!r.ok,'dữ liệu sai bị từ chối nhiều lỗi: '+r.msg);
const before=tabs['Lead'][1][7];
r=R(`doiGiaiDoan('${t2}','${ma1}','Mất','','','')`);ok(!r.ok,'Mất bắt buộc lý do');
r=R(`doiGiaiDoan('${t2}','${ma1}','Đã liên hệ','','Gửi báo giá','2026-11-30')`);ok(r.ok,'đổi giai đoạn');
ok(tabs['Lead'][1][6]==='Đã liên hệ','giai đoạn cập nhật');
ok(tabs['Lead'][1][7]>=before,'ngày đổi giai đoạn tự cập nhật');
r=R(`danhSachLead('${t2}')`);ok(r.ok&&r.leads.length===3,'Sale thấy 3 lead của mình');
r=R(`logout('${t2}')`);r=R(`danhSachLead('${t2}')`);ok(r.expired===true,'đăng xuất xong, token hết hiệu lực');
ok(tabs['Nhật ký'].length>8,'có nhật ký thao tác');
console.log(`\n${pass} pass, ${fail} fail`);
