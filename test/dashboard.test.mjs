// Dashboard (thongKe) + giao dien. Chay SAU demo.test.mjs. JSDOM_PATH=... BASE=... node test/dashboard.test.mjs
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire(import.meta.url); const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const BASE = process.env.BASE || 'http://localhost:8799';
const api = async (fn, d = {}, tok) => (await fetch(`${BASE}/api/${fn}`, { method: 'POST', headers: { authorization: tok ? 'Bearer ' + tok : '' }, body: JSON.stringify(d) })).json();
let pass = 0, failn = 0; const ok = (c, n) => { c ? pass++ : failn++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const adm = (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token;
const ls = (await api('danhSachLead', {}, adm)).leads; const hom = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
ok((await api('thongKe', {})).expired, 'chua dang nhap bi tu choi');
for (const k of ['ngay', 'tuan', 'thang']) {
  const r = await api('thongKe', { kieu: k, den: hom }, adm);
  ok(r.ok && r.xuHuong.length === (k === 'ngay' ? 14 : 12), k + ': so moc xu huong');
  ok(r.ky.t <= hom && hom <= r.ky.e, k + ': ky chua ngay chon (' + r.ky.t + '..' + r.ky.e + ')');
  const dem = ls.filter((l) => l.ngayNhan >= r.ky.t && l.ngayNhan <= r.ky.e).length;
  ok(r.tong.nhan === dem && r.giaiDoan.reduce((s, x) => s + x.c, 0) === dem, k + ': nhan trong ky khop danh sach & phan theo giai doan (' + dem + ')');
  ok(r.nguon.reduce((s, x) => s + x.nhan, 0) === dem && r.sale.reduce((s, x) => s + x.nhan, 0) === dem, k + ': tong theo nguon/sale = nhan');
  ok(r.tongMo === ls.filter((l) => !['Đã ký', 'Mất', 'Không tiềm năng'].includes(l.giaiDoan)).length, k + ': lead mo khop');
  ok(Array.isArray(r.nhanXet) && r.nhanXet.length >= 1, k + ': co nhan xet (' + r.nhanXet.length + ')');
  ok(r.xuHuong.at(-1).nhan === r.tong.nhan && r.xuHuong.at(-2).nhan === r.truoc.nhan, k + ': moc cuoi = ky nay, ke cuoi = ky truoc');
}
const t = await api('thongKe', { kieu: 'tuan', den: '2026-11-25' }, adm);
ok(t.ky.t === '2026-11-23' && t.ky.e === '2026-11-29', 'tuan tinh tu thu Hai (25/11/2026 -> 23..29/11)');
const m = await api('thongKe', { kieu: 'thang', den: '2026-02-10' }, adm); ok(m.ky.t === '2026-02-01' && m.ky.e === '2026-02-28', 'thang 2 -> 01..28');
ok((await api('thongKe', { kieu: 'xx', den: 'bad' }, adm)).kieu === 'tuan', 'tham so sai -> mac dinh tuan, khong loi');
// giao dien
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: BASE + '/', beforeParse(w) { w.fetch = (u, o) => fetch(BASE + u, o); w.alert = (x) => { throw new Error('alert: ' + x) }; } });
const w = dom.window, d = w.document, $ = (i) => d.getElementById(i), wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
$('lu').value = 'admin'; $('lp').value = 'MatKhauAdmin2026'; w.doLogin(); await wait(600);
w.show('dash'); await wait(700);
ok(!$('pDash').classList.contains('hidden') && $('dKpi').children.length === 6, 'dashboard hien 6 the so');
ok($('dNx').children.length >= 1, 'hien danh gia & dinh huong');
ok(/<svg/.test($('dTab').innerHTML) && /polyline/.test($('dTab').innerHTML), 'tab Tong quan ve bieu do xu huong');
for (const tb of ['ph', 'ns', 'ly']) { w.dashTab(tb); await wait(50); ok($('dTab').innerHTML.length > 100, 'tab ' + tb + ' co noi dung'); }
w.dashKieu('ngay'); await wait(500); ok(/Ngày/.test($('dKy').textContent), 'chuyen sang xem theo ngay');
w.dashKieu('thang'); await wait(500); ok(/Tháng/.test($('dKy').textContent), 'chuyen sang xem theo thang');
const d0 = $('dDen').value; w.dashMove(-1); await wait(500); ok($('dDen').value < d0, 'nut Ky truoc lui ngay: ' + d0 + ' -> ' + $('dDen').value);
console.log(`\n${pass} pass, ${failn} fail`); process.exit(failn ? 1 : 0);
