// Giao dien Hop dong / Doanh thu bang jsdom. Chay SAU contracts.test.mjs. JSDOM_PATH=... node test/contracts_ui.test.mjs
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url); const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const BASE = process.env.BASE || 'http://localhost:8799';
const api = async (fn, d = {}, tok) => (await fetch(`${BASE}/api/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(d) })).json();
let pass = 0, failn = 0; const ok = (c, n) => { c ? pass++ : failn++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const hom = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const open = async (un, pw) => { const dom = new JSDOM(html, { runScripts: 'dangerously', url: BASE + '/', beforeParse(w) { w.fetch = (u, o) => fetch(BASE + u, o); w.alert = (m) => { throw new Error('alert: ' + m) }; w.confirm = () => true; } });
  const w = dom.window, $ = (i) => w.document.getElementById(i); $('lu').value = un; $('lp').value = pw; w.doLogin(); await wait(600); return { w, $, vis: (i) => !$(i).classList.contains('hidden') }; };
// Admin
let { w, $, vis } = await open('admin', 'MatKhauAdmin2026');
ok(vis('bRev'), 'Admin thay nut Doanh thu');
w.show('hd'); await wait(500);
ok(vis('pHd') && $('hdTb').querySelectorAll('tbody tr').length >= 3, 'danh sach hop dong hien ' + $('hdTb').querySelectorAll('tbody tr').length + ' dong');
ok($('hdKpi').children.length === 4 && /đ/.test($('hdKpi').textContent), 'the tong hop co tien');
ok(/Cảnh báo/.test($('hdCb').textContent) && $('hdCb').querySelectorAll('.nx').length >= 1, 'hien canh bao');
w.hdNew(); $('nKhach').value = 'Khach UI HD'; $('nLoai').value = 'Theo gói'; w.hdChange('n');
ok(!$('ndCk').classList.contains('hidden') && !$('ndDv').classList.contains('hidden'), 'loai goi: hien so luong cam ket va don vi');
$('nCk').value = '5'; $('nDv').value = 'video'; $('nGia').value = '10.000.000'; $('nKy').value = hom; w.hdCreate(); await wait(700);
ok(/Đã tạo hợp đồng HD-/.test($('hdmsg').textContent), 'tao hop dong tu giao dien: ' + $('hdmsg').textContent);
$('hdQ').value = 'Khach UI HD'; w.renderHd(); ok($('hdTb').querySelectorAll('tbody tr').length === 1, 'tim kiem theo ten');
const ma = $('hdTb').querySelector('a').textContent; w.openHd(ma); await wait(600);
ok(vis('pHdDetail') && /Khach UI HD/.test($('hddTitle').textContent) && vis('hddThuF') && vis('hddTtF'), 'chi tiet: Admin co form thu tien + thuc thi');
$('tTien').value = '4.000.000'; w.hdThu(); await wait(800);
ok(/4\.000\.000/.test($('hddThu').textContent) && /6\.000\.000/.test($('hddBadges').textContent), 'ghi thu tien -> con phai thu giam');
$('xLoai').value = 'Giao sản phẩm'; w.xChange(); $('xSoLuong').value = '2'; $('xNd').value = 'Giao 2 video dau'; w.hdTt(); await wait(800);
ok(/Đã giao 2\/5 video/.test($('hddTt').textContent), 'ghi thuc thi -> tien do giao 2/5');
// doanh thu
w.show('rev'); await wait(700);
ok(vis('pRev') && $('rvKpi').children.length === 4 && /Thực thu/.test($('rvKpi').textContent), 'trang doanh thu co 4 the');
ok($('rvTr').querySelectorAll('.bar').length === 24, 'xu huong 12 thang x 2 thanh');
ok($('rvNx').children.length >= 1, 'co nhan xet doanh thu');
// chuyen Da ky tu man doi giai doan -> bat buoc form hop dong
const lead = (await api('themLead', { ten: 'UI Ky', sdt: '0911000777', cachSdt: 'Khách cho', nguon: 'Được giới thiệu', sale: 'Trung', ngayNhan: hom, ngayHanhDong: hom, loaiViec: 'Gọi lại' }, (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token)).ma;
w.openDetail(lead); await wait(600); w.dGd(); await wait(400);
$('gGd').value = 'Đã ký'; w.gdChange(); ok(vis('gHD') && !vis('gOpen'), 'chon Da ky: hien form hop dong, an viec tiep theo');
w.doGd(); await wait(500); ok(/hợp đồng/i.test($('gm').textContent), 'luu khong co gia tri bi chan: ' + $('gm').textContent);
$('hgGia').value = '3000000'; w.doGd(); await wait(1500); ok(vis('pDetail') && /HD-/.test($('dHd').textContent), 'luu xong: chi tiet lead lien ket hop dong: ' + $('dHd').textContent.slice(0, 40) + ' | gm=' + $('gm').textContent + ' | gGia=' + $('hgGia').value);
// Sale khong thay Doanh thu
const un = 'hdui_' + Date.now().toString(36); const adm = (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token;
const tmp = (await api('taoTaiKhoan', { username: un, ten: 'Trung', role: 'Sale' }, adm)).matKhauTam; const t1 = (await api('login', { username: un, password: tmp })).token; await api('doiMatKhau', { cu: tmp, moi: 'MatKhauUi2026xx' }, t1);
({ w, $, vis } = await open(un, 'MatKhauUi2026xx'));
ok(!vis('bRev'), 'Sale khong thay nut Doanh thu');
w.show('hd'); await wait(500); ok($('hdTb').querySelectorAll('tbody tr').length >= 1, 'Sale thay hop dong cua minh');
w.openHd($('hdTb').querySelector('a').textContent); await wait(600); ok(!vis('hddThuF') && !vis('hddTtF'), 'Sale khong co form thu tien / thuc thi');
console.log(`\n${pass} pass, ${failn} fail`); process.exit(failn ? 1 : 0);
