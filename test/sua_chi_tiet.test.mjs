// Kiem thu: trang mac dinh la danh sach lead; nut but chi sua tung thong tin o trang chi tiet; quyen sua. Chay SAU api.test.mjs.
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url); const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const BASE = process.env.BASE || 'http://localhost:8799';
const api = async (fn, d = {}, tok) => (await fetch(`${BASE}/api/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(d) })).json();
let pass = 0, failn = 0; const ok = (c, n) => { c ? pass++ : failn++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const adm = (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token;
const stamp = Date.now().toString(36), so = String(Date.now()).slice(-7);
async function taiKhoan(un, ten, role) {
  const r = await api('taoTaiKhoan', { username: un, ten, role }, adm);
  const t = (await api('login', { username: un, password: r.matKhauTam })).token; await api('doiMatKhau', { cu: r.matKhauTam, moi: 'MatKhauSua2026xx' }, t); return t;
}
const sA = await taiKhoan('sc_a_' + stamp, 'Linh', 'Sale'), sB = await taiKhoan('sc_b_' + stamp, 'An', 'Sale'), qd = await taiKhoan('sc_q_' + stamp, 'Thảo', 'QLDA');
const dm = (await api('layDanhMuc', {}, adm)).dm;
const them = async (ten, x = {}) => { const r = await api('themLead', { ngayNhan: '2026-03-10', ten, sale: 'Linh', loaiViec: 'Gọi lại', ngayHanhDong: '2026-03-20', nguon: 'Được giới thiệu', sdt: '09' + so + (x.i || 1), cachSdt: 'Khách cho', ...x }, adm); if (!r.ok) throw new Error(r.msg); return r.ma; };
const A = await them('Khach SC A ' + stamp), B = await them('Khach SC B ' + stamp, { i: 2, nguon: 'Chạy ad Facebook', sdt: '', link: 'facebook.com/sc.b.' + stamp });
const xem = async (ma) => (await api('chiTietLead', { ma }, adm));
const sua = (ma, truong, giaTri, tok = adm) => api('suaNhanh', { ma, truong, giaTri }, tok);

// ---- may chu: gia tri dung ----
for (const [truong, gui, khoa, mong] of [['ten', '  Ten moi ' + stamp + ' ', 'ten', 'Ten moi ' + stamp], ['tomLuoc', 'tom luoc moi', 'tomLuoc', 'tom luoc moi'], ['ghiChu', '=1+1', 'ghiChu', "'=1+1"], ['hanhDong', 'goi buoi sang', 'hanhDong', 'goi buoi sang'],
  ['giaTri', '15.000.000', 'giaTri', 15000000], ['giaTri', '2500000', 'giaTri', 2500000], ['giaTri', '', 'giaTri', null], ['ngayNhan', '2026-03-01', 'ngayNhan', '2026-03-01'], ['ngayHd', '2026-03-25', 'ngayHd', '2026-03-25'], ['link', 'https://facebook.com/sc.a.' + stamp, 'link', 'https://facebook.com/sc.a.' + stamp], ['ghiChu', '', 'ghiChu', '']]) {
  const r = await sua(A, truong, gui), l = (await xem(A)).lead; ok(r.ok && l[khoa] === mong, `admin sua ${truong} = ${JSON.stringify(gui)}` + (r.ok ? '' : ': ' + r.msg));
}
let r = await xem(A); ok(r.ev.some((e) => /Tên khách: .* → Ten moi/.test(e.noiDung)) && r.ev.some((e) => /Ngày nhận: 10\/03\/2026 → 01\/03\/2026/.test(e.noiDung)) && r.ev.some((e) => /Giá trị dự kiến: 2500000 → \(trống\)/.test(e.noiDung)), 'lich su ghi gia tri cu va moi');
const n0 = r.ev.length; ok((await sua(A, 'ten', 'Ten moi ' + stamp)).ok && (await sua(A, 'giaTri', '')).ok && (await xem(A)).ev.length === n0, 'luu khong doi gi thi khong ghi lich su');
// ---- may chu: chan gia tri sai ----
for (const [ma, truong, gui, re, n] of [[A, 'ten', '   ', /bắt buộc/, 'ten trong'], [A, 'ten', 'x'.repeat(201), /200/, 'ten qua dai'], [A, 'tomLuoc', 'x'.repeat(1001), /1000/, 'tom luoc qua dai'], [A, 'ghiChu', 'x'.repeat(501), /500/, 'ghi chu qua dai'], [A, 'hanhDong', 'x'.repeat(301), /300/, 'mo ta qua dai'],
  [A, 'giaTri', '1.5', /chữ số/, 'gia tri so le'], [A, 'giaTri', '-5', /chữ số/, 'gia tri am'], [A, 'giaTri', '15tr', /chữ số/, 'gia tri co chu'], [A, 'ngayNhan', 'abc', /không hợp lệ/, 'ngay nhan sai'], [A, 'ngayNhan', '2099-01-01', /sau hôm nay/, 'ngay nhan tuong lai'], [A, 'ngayNhan', '2026-03-26', /sau ngày làm/, 'ngay nhan sau ngay lam'],
  [A, 'ngayHd', '', /không hợp lệ/, 'ngay lam trong'], [A, 'ngayHd', '2026-02-01', /trước ngày nhận/, 'ngay lam truoc ngay nhan'], [A, 'link', 'khong phai link', /không hợp lệ/, 'link sai'], [A, 'link', 'www.facebook.com/sc.b.' + stamp + '/', /đã có/, 'link trung lead khac'], [B, 'link', '', /cần giữ link/, 'xoa link khi chua co SDT'], [A, 'giaiDoan', 'Đã ký', /Không đổi được/, 'giai doan khong sua kieu nay'], [A, 'sale', 'An', /Không đổi được/, 'sale khong sua kieu nay']]) {
  const x = await sua(ma, truong, gui); ok(!x.ok && re.test(x.msg), 'chan ' + n + ': ' + x.msg);
}
ok((await sua(A, 'link', '')).ok && (await xem(A)).lead.link === '' && (await sua(B, 'link', 'facebook.com/sc.a.' + stamp)).ok, 'lead co SDT duoc xoa link; link da xoa dung lai duoc');
// ---- quyen ----
ok((await sua(A, 'ngayNhan', '2026-03-02', sA)).ok && (await sua(A, 'ten', 'Ten Sale sua ' + stamp, sA)).ok, 'Sale phu trach sua duoc ngay nhan va ten');
for (const t of ['ten', 'ngayNhan', 'link', 'giaTri', 'tomLuoc', 'ghiChu', 'hanhDong', 'ngayHd']) {
  const gia = { ngayNhan: '2026-03-03', ngayHd: '2026-03-27', giaTri: '1000', link: 'facebook.com/x.' + stamp }[t] || 'khong duoc';
  const k = await sua(A, t, gia, sB), q = await sua(A, t, gia, qd); ok(!k.ok && /không thuộc/.test(k.msg) && !q.ok && /Admin/.test(q.msg), 'Sale khac va QLDA khong sua duoc ' + t);
}
ok((await sua(A, 'mucTiemNang', dm.mucTiemNang[0], qd)).ok, 'QLDA van sua muc tiem nang nhu truoc');
ok((await api('suaNhanh', { ma: A, truong: 'ten', giaTri: 'x' })).ok === false, 'chua dang nhap thi chan');
// lead dong
const C = await them('Khach SC C ' + stamp, { i: 3 }); r = await api('doiGiaiDoan', { ma: C, giaiDoan: 'Mất', lyDo: dm.lyDo[0] }, adm); if (!r.ok) throw new Error(r.msg);
for (const t of ['hanhDong', 'ngayHd']) ok(/đã đóng/.test((await sua(C, t, '2026-03-30')).msg || ''), 'lead dong: chan ' + t);
ok((await sua(C, 'ghiChu', 'ghi sau khi dong')).ok && (await sua(C, 'ngayNhan', '2026-03-28')).ok, 'lead dong: van sua ghi chu, ngay nhan');

// ---- giao dien ----
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wait = (ms = 150) => new Promise((x) => setTimeout(x, ms));
async function mo(un, hash = '') {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: BASE + '/' + hash, beforeParse(w) { w.fetch = (u, o) => fetch(BASE + u, o); w.alert = (m) => { throw new Error('alert: ' + m); }; w.prompt = () => { throw new Error('khong duoc dung prompt'); }; } });
  const w = dom.window, $ = (i) => w.document.getElementById(i), vis = (i) => !$(i).classList.contains('hidden');
  $('lu').value = un; $('lp').value = un === 'admin' ? 'MatKhauAdmin2026' : 'MatKhauSua2026xx'; w.doLogin(); await wait(900);
  const o = (k) => $('dFields').querySelector(`.tt[data-k="${k}"]`), but = (k) => o(k) && o(k).querySelector('button.but'), gt = (k) => o(k).querySelector('.gt').textContent;
  const luu = async (k, v, them = {}) => { but(k).click(); $('dsV').value = v; for (const i in them) $(i).value = them[i]; $('dsLuu').click(); await wait(1300); };
  const phim = (el, key, x = {}) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...x }));
  return { w, $, vis, o, but, gt, luu, phim };
}
const M = await mo('admin');
ok(M.vis('pList') && !M.vis('pAdd') && M.$('nav').querySelector('button.on').getAttribute('data-p') === 'list', 'dang nhap xong thay danh sach lead');
const M2 = await mo('admin', '#lead/' + A); await wait(500); ok(M2.vis('pDetail') && !M2.vis('pAdd'), 'mo link thang toi lead van vao trang chi tiet');
const D = await them('Khach SC D ' + stamp, { i: 4 });
M.w.openDetail(D); await wait(900);
const khoa = [...M.$('dFields').querySelectorAll('button.but')].map((b) => b.closest('.tt').dataset.k);
ok(khoa.join() === 'ten,giaiDoan,sale,sao,mucTiemNang,ngayNhan,nguon,sdt,cachSdt,link,giaTri,loaiViec,ngayHd,hanhDong,tomLuoc,ghiChu', 'lead moi: nut but chi o cac muc sua duoc: ' + khoa.join());
ok(M.but('ten').getAttribute('aria-label') === 'Sửa Tên khách' && M.but('ten').querySelector('svg'), 'nut co hinh but va ten goi');
ok(!/Sửa SĐT|QLDA & link Brief|link Proposal/.test(M.$('dActs').textContent) && /Đổi giai đoạn/.test(M.$('dActs').textContent) && /Chuyển Sale/.test(M.$('dActs').textContent), 'hang nut chi con Doi giai doan va Chuyen Sale');
M.but('ten').click(); ok(M.$('dsV').value === 'Khach SC D ' + stamp, 'o sua dien san'); M.but('ghiChu').click(); ok(M.$('dFields').querySelectorAll('.osua').length === 1 && M.$('dsV').tagName === 'TEXTAREA', 'chi mo mot o sua mot luc');
M.$('dsV').value = 'bo'; M.phim(M.$('dsV'), 'Escape'); ok(!M.$('dsV') && M.gt('ghiChu') === '(chưa có)', 'Esc huy, giu nguyen');
M.but('ten').click(); M.$('dsV').value = 'bo2'; M.$('dsHuy').click(); ok(!M.$('dsV') && M.gt('ten') === 'Khach SC D ' + stamp, 'Huy giu nguyen');
await M.luu('ten', 'Ten giao dien ' + stamp); ok(!M.$('dsV') && M.gt('ten') === 'Ten giao dien ' + stamp && M.$('dTitle').textContent.includes('Ten giao dien') && /Đã lưu Tên khách/.test(M.$('dmsg').textContent), 'sua ten: cap nhat tieu de va bao da luu');
await M.luu('ten', ''); ok(M.$('dsV') && /bắt buộc/.test(M.$('dsMsg').textContent) && !M.$('dsLuu').disabled, 'loi hien ngay duoi o, giu o sua'); M.$('dsHuy').click();
M.but('ghiChu').click(); M.$('dsV').value = 'dong 1'; M.phim(M.$('dsV'), 'Enter'); await wait(300); ok(M.$('dsV'), 'Enter trong o dai khong luu'); M.phim(M.$('dsV'), 'Enter', { ctrlKey: true }); await wait(1300); ok(!M.$('dsV') && M.gt('ghiChu') === 'dong 1', 'Ctrl+Enter luu');
M.but('giaTri').click(); M.$('dsV').value = '8.000.000'; M.phim(M.$('dsV'), 'Enter'); await wait(1300); ok(M.gt('giaTri') === '8.000.000 đ', 'Enter luu gia tri');
M.but('giaTri').click(); ok(M.$('dsV').value === '8.000.000', 'gia tri dien san dang co dau cham'); M.$('dsHuy').click();
await M.luu('ngayNhan', '2026-03-05'); ok(M.gt('ngayNhan') === '05/03/2026', 'sua ngay nhan');
await M.luu('ngayHd', '2026-03-22'); ok(M.gt('ngayHd') === '22/03/2026', 'sua ngay lam');
await M.luu('hanhDong', 'gui bao gia'); await M.luu('tomLuoc', 'can marketing'); ok(M.gt('hanhDong') === 'gui bao gia' && M.gt('tomLuoc') === 'can marketing', 'sua mo ta va tom luoc');
await M.luu('loaiViec', 'Hẹn gặp'); await M.luu('sao', '3'); await M.luu('mucTiemNang', dm.mucTiemNang[0]); await M.luu('nguon', 'Chạy ad Facebook');
let l = (await xem(D)).lead; ok(l.loaiViec === 'Hẹn gặp' && l.sao === 3 && l.mucTiemNang === dm.mucTiemNang[0] && l.nguon === 'Chạy ad Facebook' && /★★★/.test(M.$('dBadges').textContent), 'sua cac o chon, thanh tom tat cap nhat');
await M.luu('link', 'facebook.com/sc.d.' + stamp); ok(M.gt('link') === 'facebook.com/sc.d.' + stamp, 'sua link Facebook');
await M.luu('sdt', '12345', { dsCach: 'Tự tìm' }); ok(/SĐT không hợp lệ/.test(M.$('dsMsg').textContent), 'SDT sai bao loi'); M.$('dsHuy').click();
await M.luu('sdt', '09' + so + '7', { dsCach: 'Tự tìm' }); l = (await xem(D)).lead; ok(l.sdt === '09' + so + '7' && l.cachSdt === 'Tự tìm' && M.gt('sdt') === l.sdt, 'sua SDT va cach co');
await M.luu('sdt', '09' + so + '7', { dsCach: 'Khách cho' }); ok((await xem(D)).lead.cachSdt === 'Khách cho', 'chi doi cach co SDT');
await M.luu('cachSdt', 'Tự tìm'); ok((await xem(D)).lead.cachSdt === 'Tự tìm', 'sua cach co SDT o dong rieng');
M.w.dSale(); ok(M.$('dsLy') && M.$('dsLuu').textContent === 'Chuyển', 'nut Chuyen Sale mo o chon'); M.$('dsLuu').click(); ok(/Chọn Sale mới/.test(M.$('dsMsg').textContent), 'phai chon Sale');
M.$('dsV').value = 'An'; M.$('dsLy').value = 'doi nguoi cham'; M.$('dsLuu').click(); await wait(1300); ok(M.gt('sale') === 'An' && /doi nguoi cham/.test(M.$('dEv').textContent), 'chuyen Sale kem ly do');
M.but('giaiDoan').click(); await wait(500); ok(M.vis('pGd'), 'but chi o Giai doan mo man doi giai doan'); M.w.cancelGd(); await wait(700);
ok(!M.but('linkProposal') && !M.o('qlda'), 'chua toi Proposal: khong co nut link Proposal, QLDA');
r = await api('doiGiaiDoan', { ma: D, giaiDoan: 'Khách chờ Proposal', loaiViec: 'Gọi lại', ngayHanhDong: '2026-03-23' }, adm); if (!r.ok) throw new Error(r.msg);
M.w.openDetail(D); await wait(900); await M.luu('qlda', dm.qlda[0]); await M.luu('linkBrief', 'sai'); ok(/không hợp lệ/.test(M.$('dsMsg').textContent), 'link Brief sai bao loi'); M.$('dsHuy').click(); await M.luu('linkBrief', 'https://example.com/br-sc');
ok(M.gt('qlda') === dm.qlda[0] && M.o('linkBrief').querySelector('a[href="https://example.com/br-sc"]'), 'sua QLDA va Brief');
await M.luu('linkBrief', ''); ok(M.gt('linkBrief') === '(chưa có)' && M.gt('qlda') === dm.qlda[0], 'xoa link Brief, giu QLDA');
r = await api('doiGiaiDoan', { ma: D, giaiDoan: 'Đã gửi Proposal', linkProposal: 'https://example.com/pp-sc', loaiViec: 'Gọi lại', ngayHanhDong: '2026-03-24' }, adm); if (!r.ok) throw new Error(r.msg);
M.w.openDetail(D); await wait(900); await M.luu('linkProposal', 'https://example.com/pp-sc2'); ok(M.o('linkProposal').querySelector('a[href="https://example.com/pp-sc2"]'), 'sua link Proposal');
M.w.openDetail(C); await wait(900); ok(!M.but('ngayHd') && !M.but('hanhDong') && !M.but('loaiViec') && M.but('ghiChu') && M.but('linkProposal'), 'lead dong: an but chi viec tiep theo');
// vai tro
const SB = await mo('sc_b_' + stamp); SB.w.openDetail(A); await wait(900);
ok([...SB.$('dFields').querySelectorAll('button.but')].map((b) => b.closest('.tt').dataset.k).join() === 'sale', 'Sale khac: chi con nut o Sale phu trach (chuyen Sale nhu truoc)');
SB.w.openDetail(D); await wait(900); ok(SB.but('ten') && SB.but('ngayNhan') && SB.vis('pDetail'), 'Sale phu trach thay du nut');
await SB.luu('ngayNhan', '2026-03-04'); ok((await xem(D)).lead.ngayNhan === '2026-03-04', 'Sale phu trach sua ngay nhan tren giao dien');
const Q = await mo('sc_q_' + stamp); ok(Q.vis('pList'), 'QLDA vao la thay danh sach'); Q.w.openDetail(D); await wait(900);
ok(!['ten', 'ngayNhan', 'link', 'giaTri', 'tomLuoc', 'ghiChu', 'hanhDong', 'ngayHd', 'qlda', 'linkBrief'].some((k) => Q.but(k)) && ['sdt', 'sao', 'mucTiemNang', 'nguon', 'loaiViec', 'linkProposal', 'sale'].every((k) => Q.but(k)), 'QLDA: chi co but o cac muc von sua duoc');
console.log(`${pass} pass, ${failn} fail`); process.exit(failn ? 1 : 0);
