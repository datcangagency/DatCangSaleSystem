// Kiem thu o ngay mac dinh = ngay chuyen giai doan, va chuc nang xoa tai khoan. Chay SAU api.test.mjs.
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url); const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const BASE = process.env.BASE || 'http://localhost:8799';
const raw = async (fn, d = {}, tok) => fetch(`${BASE}/api/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(d) });
const api = async (fn, d, tok) => { const r = await raw(fn, d, tok); const j = await r.json(); j._st = r.status; return j; };
let pass = 0, failn = 0; const ok = (c, n) => { c ? pass++ : failn++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const nay = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const adm = (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token;
const stamp = Date.now().toString(36); const PW = 'MatKhauNx2026xx';
const mk = async (un, ten, role) => { const tmp = (await api('taoTaiKhoan', { username: un, ten, role }, adm)).matKhauTam; const t = (await api('login', { username: un, password: tmp })).token; await api('doiMatKhau', { cu: tmp, moi: PW }, t); return (await api('login', { username: un, password: PW })).token; };
const SALE = 'Linh'; const un = 'nx_' + stamp; const tok = await mk(un, SALE, 'Sale');
let so = Number(String(Date.now()).slice(-7));
const them = async (ten, ngay, t = tok) => (await api('themLead', { ngayNhan: '2020-01-01', nguon: 'Được giới thiệu', ten, sdt: '093' + String(so++).padStart(7, '0').slice(-7), cachSdt: 'Khách cho', sale: SALE, loaiViec: 'Gọi lại', ngayHanhDong: ngay }, t)).ma;
const QUA = await them('NgayQua ' + stamp, '2020-01-02'), TOI = await them('NgayToi ' + stamp, '2099-03-04'), FORM = await them('NgayForm ' + stamp, '2099-05-06');
ok(QUA && TOI && FORM, 'tao 3 lead mau');

// ---------- giao dien: o ngay
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const mo = async (user, pw) => { const dom = new JSDOM(html, { runScripts: 'dangerously', url: BASE + '/', beforeParse(w) { w.fetch = (u, o) => fetch(BASE + u, o); w.alert = (m) => { throw new Error('alert: ' + m) }; } }); const w = dom.window, d = w.document, $ = (i) => d.getElementById(i); $('lu').value = user; $('lp').value = pw; w.doLogin(); await wait(600); return { w, d, $ }; };
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
let { w, d, $ } = await mo(un, PW);
ok($('aNgayHd').value === nay, 'Them lead: ngay viec tiep theo mac dinh hom nay: ' + $('aNgayHd').value);
$('aNguon').value = 'Được giới thiệu'; $('aTen').value = 'NgayAdd ' + stamp; $('aSdt').value = '094' + String(so++).padStart(7, '0').slice(-7); w.srcChange(); $('aCach').value = 'Khách cho'; $('aLoai').value = 'Gọi lại'; $('aNgayHd').value = '2099-07-07';
w.doAdd(); await wait(600); ok(/Đã lưu/.test($('am').textContent) && $('aNgayHd').value === nay, 'luu xong o ngay ve lai hom nay');
w.show('list'); await wait(500); w.chonTab(''); await wait(300);
const idx = (ma) => w.eval('LEADS').findIndex((l) => l.ma === ma);
const L = (ma) => w.eval('LEADS')[idx(ma)];
const srv = async (ma) => (await api('chiTietLead', { ma }, adm)).lead;
// doi nhanh
w.doiGd(idx(QUA), 'Đã liên hệ'); await wait(600);
ok((await srv(QUA)).ngayHd === nay && L(QUA).ngayHd === nay && /đổi sang hôm nay/.test($('lmsg').textContent), 'doi nhanh, ngay cu da qua: thanh hom nay');
w.doiGd(idx(TOI), 'Đã liên hệ'); await wait(600);
ok((await srv(TOI)).ngayHd === '2099-03-04' && /giữ nguyên/.test($('lmsg').textContent), 'doi nhanh, hen tuong lai: giu nguyen');
// phieu Khach cho Proposal: thieu QLDA/Brief nen mo phieu, ngay = hom nay
w.doiGd(idx(FORM), 'Khách chờ Proposal'); await wait(200);
ok($('pNgay') && $('pNgay').value === nay, 'phieu Khach cho Proposal dien san hom nay (khong lay hen cu)');
$('pNgay').value = '2099-08-08'; $('pNgay').dispatchEvent(new w.Event('change')); w.renderList();
ok($('pNgay').value === '2099-08-08', 'sua ngay trong phieu duoc giu');
w.guiPhieu(); await wait(600); let s = await srv(FORM); ok(s.giaiDoan === 'Khách chờ Proposal' && s.ngayHd === '2099-08-08', 'luu dung ngay da sua');
w.moPhieu(idx(FORM), true); ok($('pNgay').value === nay, 'phieu Gui link dien san hom nay'); w.dongPhieu();
// hop thoai doi giai doan
w.openGd(idx(TOI), 'Hẹn tư vấn'); ok($('gNgay').value === nay, 'hop thoai chuyen giai doan dien san hom nay');
$('gGd').value = 'Đã liên hệ'; w.gdChange(); ok($('gNgay').value === '2099-03-04', 'chon lai giai doan hien tai: giu ngay dang co');
$('gGd').value = 'Hẹn tư vấn'; w.gdChange(); ok($('gNgay').value === nay, 'chon giai doan khac: lai la hom nay');
$('gNgay').value = '2099-09-09'; $('gNgay').dispatchEvent(new w.Event('input')); $('gGd').value = 'Đàm phán'; w.gdChange(); ok($('gNgay').value === '2099-09-09', 'ngay Sale tu go khong bi ghi de');
w.cancelGd(); await wait(200); w.openGd(idx(TOI)); ok($('gNgay').value === '2099-03-04', 'mo sua viec tiep theo (khong doi giai doan): giu ngay cu, co go truoc do cung da xoa co'); w.cancelGd(); await wait(300);
w.openDetail(TOI); await wait(600); w.dGd(); await wait(300); ok($('gNgay').value === '2099-03-04', 'trang chi tiet: chua doi giai doan thi giu ngay');
$('gGd').value = 'Hẹn tư vấn'; w.gdChange(); ok($('gNgay').value === nay, 'trang chi tiet: chon giai doan moi thi hom nay');
$('gGd').value = 'Hẹn tư vấn'; w.doGd(); await wait(600); s = await srv(TOI); ok(s.giaiDoan === 'Hẹn tư vấn' && s.ngayHd === nay, 'luu tu hop thoai: ngay hom nay');

// ---------- xoa tai khoan (may chu)
const del = 'nxdel_' + stamp; const tDel = await mk(del, SALE, 'Sale');
const cuaDel = await them('CuaDel ' + stamp, '2099-01-01', tDel);
await api('suaNhanh', { ma: cuaDel, truong: 'sao', giaTri: 3 }, tDel);
const truoc = (await api('danhSachLead', {}, adm)).leads.length;
let r = await api('xoaTaiKhoan', { username: del }, tok); ok(!r.ok && r._st === 403, 'Sale khong xoa duoc tai khoan');
r = await api('xoaTaiKhoan', { username: del }); ok(!r.ok, 'chua dang nhap khong xoa duoc');
r = await api('xoaTaiKhoan', { username: 'admin' }, adm); ok(!r.ok && /chính mình/.test(r.msg), 'khong tu xoa minh');
r = await api('xoaTaiKhoan', { username: ' ADMIN ' }, adm); ok(!r.ok, 'viet hoa/khoang trang cung khong tu xoa duoc');
r = await api('xoaTaiKhoan', { username: 'khong_co_ai' }, adm); ok(!r.ok && /Không có tài khoản/.test(r.msg), 'tai khoan khong ton tai');
r = await api('xoaTaiKhoan', { username: del }, adm); ok(r.ok, 'admin xoa duoc: ' + r.msg);
ok(!(await api('danhSachTaiKhoan', {}, adm)).users.some((u) => u.username === del), 'khong con trong danh sach');
r = await api('danhSachLead', {}, tDel); ok(!r.ok, 'phien dang nhap bi huy ngay');
r = await api('login', { username: del, password: PW }); ok(!r.ok, 'khong dang nhap lai duoc');
const sau = (await api('danhSachLead', {}, adm)).leads; ok(sau.length === truoc && sau.find((l) => l.ma === cuaDel).sale === SALE, 'lead giu nguyen');
const ct = await api('chiTietLead', { ma: cuaDel }, adm); ok(ct.ev.length >= 2 && ct.ev.every((e) => e.boi !== del) && ct.ev.some((e) => e.boi === SALE), 'lich su van hien ho ten nguoi da xoa');
r = await api('taoTaiKhoan', { username: del, ten: 'Người khác', role: 'Sale' }, adm); ok(!r.ok && /đã xóa/.test(r.msg), 'khong dung lai ten dang nhap da xoa');
r = await api('taoTaiKhoan', { username: del + '2', ten: SALE, role: 'Sale' }, adm); ok(r.ok, 'tao tai khoan moi cung ho ten duoc');
const tat = 'nxoff_' + stamp; await mk(tat, SALE, 'Sale'); await api('tatTaiKhoan', { username: tat, bat: 0 }, adm); r = await api('xoaTaiKhoan', { username: tat }, adm); ok(r.ok, 'xoa duoc tai khoan dang tat');
const ad2 = 'nxad_' + stamp; const tAd2 = await mk(ad2, 'Quản trị phụ', 'Admin'); r = await api('xoaTaiKhoan', { username: ad2 }, adm); ok(r.ok && !(await api('danhSachTaiKhoan', {}, tAd2)).ok, 'xoa duoc Admin khac, phien bi huy');

// ---------- xoa tai khoan (giao dien)
const ui = 'nxui_' + stamp; await mk(ui, SALE, 'Sale');
({ w, d, $ } = await mo('admin', 'MatKhauAdmin2026'));
w.show('users'); await wait(600);
const hang = (u) => [...$('ub').children].find((tr) => tr.children[0].textContent === u);
ok(hang('admin') && !hang('admin').querySelector('button.xoa'), 'dong cua chinh minh khong co nut Xoa');
ok(hang(ui) && hang(ui).querySelector('button.xoa').textContent === 'Xóa', 'dong tai khoan khac co nut Xoa');
let hoi = ''; w.confirm = (m) => { hoi = m; return false; };
hang(ui).querySelector('button.xoa').click(); await wait(400);
ok(hoi.includes(ui) && /Không khôi phục được/.test(hoi) && /giữ nguyên/.test(hoi) && hang(ui), 'hoi xac nhan; bam Huy thi khong xoa');
w.confirm = () => true; hang(ui).querySelector('button.xoa').click(); await wait(800);
ok(!hang(ui) && $('umsg').textContent === 'Đã xóa tài khoản ' + ui + '.', 'dong y: xoa, bao ket qua: ' + $('umsg').textContent);

console.log(`\n${pass} dat, ${failn} loi`); process.exit(failn ? 1 : 0);
