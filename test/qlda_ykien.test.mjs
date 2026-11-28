// Kiem thu QLDA phu trach, link Brief, y kien khach truoc ky (API va giao dien). Chay SAU api.test.mjs.
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire(import.meta.url); const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const BASE = process.env.BASE || 'http://localhost:8799';
const api = async (fn, d = {}, tok) => (await fetch(`${BASE}/api/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(d) })).json();
let pass = 0, failn = 0; const ok = (c, n) => { c ? pass++ : failn++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const adm = (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token;
const dm = (await api('layDanhMuc', {}, adm)).dm;
ok(dm.lanTan.join('|') === 'Giá/ngân sách|Nội dung đề xuất|Thời điểm|Niềm tin|Đang so sánh bên khác|Khác', 'danh muc dieu lan tan: ' + dm.lanTan.join('|'));
ok(dm.qlda.includes('Thảo') && dm.qlda.includes('Nhung'), 'danh muc QLDA: ' + dm.qlda.join('|'));
const q = dm.qlda[0], q2 = dm.qlda[1];
const stamp = Date.now().toString(36);
const mk = async (un, ten, role) => { const tmp = (await api('taoTaiKhoan', { username: un, ten, role }, adm)).matKhauTam; const t = (await api('login', { username: un, password: tmp })).token; await api('doiMatKhau', { cu: tmp, moi: 'MatKhauYk2026xx' }, t); return t; };
const sOwn = await mk('yk_own_' + stamp, 'Dương', 'Sale'), sKhac = await mk('yk_oth_' + stamp, 'An', 'Sale'), ql = await mk('yk_ql_' + stamp, q, 'QLDA');
let so = Number(String(Date.now()).slice(-7));
const them = async (ten) => { const r = await api('themLead', { ngayNhan: '2026-11-20', nguon: 'Được giới thiệu', ten, sdt: '092' + String(so++).padStart(7, '0').slice(-7), cachSdt: 'Khách cho', sale: 'Dương', loaiViec: 'Gọi lại', ngayHanhDong: '2099-01-01' }, adm); if (!r.ok) throw new Error(r.msg); return r.ma; };
const xem = async (ma) => api('chiTietLead', { ma }, adm);
const viec = { loaiViec: 'Gọi lại', ngayHanhDong: '2099-02-01' };
const doi = (ma, x, t = sOwn) => api('doiGiaiDoan', { ma, ...viec, ...x }, t);

// --- QLDA va Brief
const A = await them('Khach YK A ' + stamp);
let r = await api('ghiHoSo', { ma: A, qlda: q }, sOwn); ok(!r.ok && /từ giai đoạn Khách chờ Proposal/.test(r.msg), 'lead Moi chua nhap duoc QLDA');
r = await doi(A, { giaiDoan: 'Khách chờ Proposal', qlda: 'Người lạ' }); ok(!r.ok && /Chọn QLDA/.test(r.msg) && (await xem(A)).lead.giaiDoan === 'Mới', 'QLDA ngoai danh sach bi chan, giai doan giu nguyen');
r = await doi(A, { giaiDoan: 'Khách chờ Proposal', linkBrief: 'javascript:alert(1)' }); ok(!r.ok && /Link Brief không hợp lệ/.test(r.msg), 'link Brief sai bi chan');
r = await doi(A, { giaiDoan: 'Khách chờ Proposal', qlda: q, linkBrief: ' https://example.com/brief-a ' }); ok(r.ok, 'chuyen giai doan kem QLDA + Brief: ' + r.msg);
let c = await xem(A); ok(c.lead.qlda === q && c.lead.linkBrief === 'https://example.com/brief-a', 'lead luu QLDA va Brief da cat khoang trang');
ok(c.ev.some((e) => /QLDA: \(trống\) → /.test(e.noiDung) && /Link Brief:/.test(e.noiDung)), 'lich su ghi QLDA va Brief');
r = await doi(A, { giaiDoan: 'Khách chờ Proposal' }); ok(r.ok && (await xem(A)).lead.qlda === q, 'khong gui truong thi giu nguyen');
r = await api('ghiHoSo', { ma: A, qlda: q2 }, sOwn); c = await xem(A); ok(r.ok && c.lead.qlda === q2 && c.lead.linkBrief === 'https://example.com/brief-a', 'doi rieng QLDA khong mat Brief');
r = await api('ghiHoSo', { ma: A, linkBrief: '' }, sOwn); ok(r.ok && (await xem(A)).lead.linkBrief === '', 'duoc xoa trong link Brief');
await api('ghiHoSo', { ma: A, linkBrief: 'https://example.com/brief-a' }, adm);
r = await api('ghiHoSo', { ma: A, qlda: q }, sKhac); ok(!r.ok && /không thuộc/.test(r.msg), 'Sale khac khong sua duoc');
r = await api('ghiHoSo', { ma: A, qlda: q }, ql); ok(!r.ok && /Chỉ Sale phụ trách hoặc Admin/.test(r.msg), 'QLDA khong tu sua QLDA');
r = await doi(A, { giaiDoan: 'Khách chờ Proposal', qlda: q }, ql); ok(!r.ok && /Chỉ Sale phụ trách hoặc Admin/.test(r.msg), 'QLDA khong doi QLDA qua doi giai doan');
r = await doi(A, { giaiDoan: 'Khách chờ Proposal', qlda: q2, linkBrief: 'https://example.com/brief-a' }, ql); ok(r.ok, 'QLDA doi giai doan, gui gia tri khong doi thi duoc: ' + r.msg);

// --- y kien khach
r = await api('ghiYKien', { ma: A, muc: ['Giá/ngân sách'] }, sOwn); ok(!r.ok && /Đã gửi Proposal hoặc Đàm phán/.test(r.msg), 'chua gui Proposal thi chua ghi y kien');
await doi(A, { giaiDoan: 'Đã gửi Proposal', linkProposal: 'https://example.com/pp-a' });
r = await api('ghiYKien', { ma: A, muc: [] }, sOwn); ok(!r.ok && /ít nhất một/.test(r.msg), 'phai chon muc');
r = await api('ghiYKien', { ma: A, muc: ['Linh tinh'] }, sOwn); ok(!r.ok && /không có trong danh sách/.test(r.msg), 'muc la bi chan');
r = await api('ghiYKien', { ma: A, muc: ['Khác'] }, sOwn); ok(!r.ok && /ghi rõ/.test(r.msg), 'chon Khac phai ghi chu');
r = await api('ghiYKien', { ma: A, muc: ['Thời điểm'], ghiChu: 'x'.repeat(301) }, sOwn); ok(!r.ok && /300/.test(r.msg), 'ghi chu qua dai');
r = await api('ghiYKien', { ma: A, muc: ['Thời điểm'] }, sKhac); ok(!r.ok && /không thuộc/.test(r.msg), 'Sale khac khong ghi duoc');
r = await api('ghiYKien', { ma: A, muc: ['Thời điểm'] }, ql); ok(!r.ok, 'QLDA khong ghi y kien');
r = await api('ghiYKien', { ma: A, muc: ['Thời điểm', 'Giá/ngân sách', 'Thời điểm'], ghiChu: '=can giam gia' }, sOwn);
ok(r.ok && r.yKien.muc.join('|') === 'Giá/ngân sách|Thời điểm' && r.yKien.giaiDoan === 'Đã gửi Proposal' && r.yKien.boi === 'Dương', 'ghi y kien: bo trung, dung thu tu danh muc');
await doi(A, { giaiDoan: 'Đàm phán' });
r = await api('ghiYKien', { ma: A, muc: ['Giá/ngân sách'] }, adm); ok(r.ok && r.yKien.giaiDoan === 'Đàm phán', 'Admin ghi o Dam phan');
c = await xem(A); ok(c.yKien.length === 2 && c.yKien[0].giaiDoan === 'Đàm phán' && c.yKien[1].muc.length === 2, 'lich su y kien giu du, moi nhat truoc');
let ds = (await api('danhSachLead', {}, adm)).leads.find((l) => l.ma === A);
ok(ds.yKien && ds.yKien.so === 2 && ds.yKien.muc.join() === 'Giá/ngân sách' && ds.qlda === q2, 'danh sach tra lan ghi gan nhat va so lan');
const B2 = await them('Khach YK B ' + stamp);
await doi(B2, { giaiDoan: 'Đã gửi Proposal', linkProposal: 'https://example.com/pp-b' }); await api('ghiYKien', { ma: B2, muc: ['Giá/ngân sách', 'Niềm tin'] }, sOwn);
const tk0 = await api('thongKe', { kieu: 'tuan', den: '2026-11-28' }, adm);
await doi(B2, { giaiDoan: 'Mất', lyDo: 'Không nhu cầu' });
const tk = await api('thongKe', { kieu: 'tuan', den: '2026-11-28' }, adm);
const m = (x, k) => x.lanTan.find((y) => y.k === k);
ok(tk.lanTan.length === 6 && m(tk, 'Giá/ngân sách').so === m(tk0, 'Giá/ngân sách').so && m(tk, 'Giá/ngân sách').so >= 2, 'dem theo lead, ghi nhieu lan chi tinh mot: ' + m(tk, 'Giá/ngân sách').so);
ok(m(tk, 'Niềm tin').mat === m(tk0, 'Niềm tin').mat + 1 && m(tk, 'Niềm tin').mo === m(tk0, 'Niềm tin').mo - 1, 'ket qua Mat duoc cap nhat');
ok(tk.hoiYKien.coGhi >= 1 && tk.hoiYKien.dang >= tk.hoiYKien.coGhi && tk.hoiYKien.tongLead >= 2, 'do phu ghi y kien: ' + JSON.stringify(tk.hoiYKien));

// --- hop dong
const hd = { loai: 'Theo thời hạn', ngayKy: '2026-11-25', soThang: 3, giaTri: 30000000, keHoach: 'mot_lan' };
r = await doi(A, { giaiDoan: 'Đã ký', hopDong: { ...hd, qlda: '', linkBrief: '' } }); ok(r.ok && r.hopDong, 'ky hop dong, de trong thi giu gia tri lead: ' + r.msg); const hdA = r.hopDong;
let ct = await api('chiTietHopDong', { ma: hdA }, adm); ok(ct.hd.qlda === q2 && ct.hd.linkBrief === 'https://example.com/brief-a', 'QLDA va Brief theo sang hop dong');
r = await api('ghiHoSo', { maHD: hdA, qlda: q }, sOwn); ct = await api('chiTietHopDong', { ma: hdA }, adm); ok(r.ok && ct.hd.qlda === q && (await xem(A)).lead.qlda === q, 'sua o hop dong thi lead doi theo');
r = await api('ghiHoSo', { maHD: hdA, qlda: q2 }, sKhac); ok(!r.ok && /Không tìm thấy hợp đồng/.test(r.msg), 'Sale khac khong sua hop dong');
r = await api('ghiHoSo', { maHD: hdA, qlda: q2 }, ql); ok(!r.ok, 'QLDA khong sua QLDA o hop dong');
const D2 = await them('Khach YK D ' + stamp);
r = await doi(D2, { giaiDoan: 'Đã ký', hopDong: { ...hd, qlda: q, linkBrief: 'https://example.com/brief-d' } });
ok(r.ok && (await xem(D2)).lead.linkBrief === 'https://example.com/brief-d' && (await xem(D2)).lead.qlda === q, 'nhap trong form hop dong thi luu vao lead');
const E = await them('Khach YK E ' + stamp);
r = await doi(E, { giaiDoan: 'Đã ký', hopDong: { ...hd, linkBrief: 'xau' } }); ok(!r.ok && /Link Brief/.test(r.msg) && (await xem(E)).lead.giaiDoan === 'Mới', 'link sai trong form hop dong: khong ky, khong doi gi');
r = await api('taoHopDong', { ...hd, khach: 'Khach le ' + stamp, qlda: q2, linkBrief: 'https://example.com/brief-le' }, sOwn); ok(r.ok, 'hop dong khong gan lead: ' + r.msg); const hdLe = r.ma;
ct = await api('chiTietHopDong', { ma: hdLe }, adm); ok(ct.hd.qlda === q2 && ct.hd.linkBrief === 'https://example.com/brief-le', 'hop dong le luu tai hop dong');
r = await api('ghiHoSo', { maHD: hdLe, linkBrief: 'https://example.com/brief-le2' }, adm); ct = await api('chiTietHopDong', { ma: hdLe }, adm); ok(r.ok && ct.hd.linkBrief.endsWith('le2') && ct.hd.qlda === q2, 'sua hop dong le');
const dsHd = (await api('danhSachHopDong', {}, adm)).hd; ok(dsHd.find((x) => x.ma === hdA).qlda === q && dsHd.find((x) => x.ma === hdLe).qlda === q2, 'danh sach hop dong co QLDA');
r = await api('saoLuu', {}, adm); ok(r.ok && r.dem.y_kien >= 3 && r.sql.split('\n').filter((x) => x.startsWith('INSERT INTO y_kien(')).length === r.dem.y_kien && r.sql.includes('brief-le2') && /INSERT INTO leads\([^)]*qlda,link_brief/.test(r.sql), 'ban sao luu co y kien, QLDA, Brief: ' + r.dem.y_kien);

// --- giao dien
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const mo = async (un) => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: BASE + '/', beforeParse(w) { w.fetch = (u, o) => fetch(BASE + u, o); w.alert = (x) => { throw new Error('alert: ' + x) }; } });
  const w = dom.window, d = w.document, $ = (i) => d.getElementById(i);
  $('lu').value = un; $('lp').value = 'MatKhauYk2026xx'; w.doLogin(); await wait(600); w.show('list'); await wait(700); w.$('fKy').value = ''; w.kyChange();
  return { w, d, $, row: (ma) => $('tb').querySelector(`tr[data-ma="${ma}"]`), sel: (ma, f) => $('tb').querySelector(`tr[data-ma="${ma}"] select[data-f="${f}"]`) };
};
const wait = (ms = 150) => new Promise((x) => setTimeout(x, ms));
const F = await them('Khach YK F ' + stamp);
const U = await mo('yk_own_' + stamp); const { w, d, $, row, sel } = U;
const pick = async (ma, f, v) => { const s = sel(ma, f); s.value = v; s.dispatchEvent(new w.Event('change')); await wait(800); };
const go = (id, v) => { const e = $(id); e.value = v; e.dispatchEvent(new w.Event(e.tagName === 'SELECT' ? 'change' : 'input')); };
const phieu = () => $('tb').querySelector('tr.phieu');
ok(!sel(F, 'qlda') && !row(F).querySelector('.hs') && !/Ý kiến/.test(row(F).textContent), 'lead Moi: chua hien QLDA, Brief, y kien');
await pick(F, 'giaiDoan', 'Khách chờ Proposal');
ok(phieu() && phieu().dataset.kieu === 'hoso' && $('pQlda') && $('pBrief') && $('pLoai').value === 'Gọi lại' && /Chuyển sang Khách chờ Proposal/.test($('pGui').textContent), 'chon Khach cho Proposal: mo o QLDA + Brief duoi dong');
go('pQlda', q); go('pBrief', 'abc'); $('pGui').click(); await wait(800); ok(phieu() && /Link Brief không hợp lệ/.test($('pLoi').textContent) && $('pQlda').value === q && $('pBrief').value === 'abc', 'link sai: giu chu da nhap');
go('pBrief', 'https://example.com/brief-f'); $('pGui').click(); await wait(900);
ok(!phieu() && sel(F, 'giaiDoan').value === 'Khách chờ Proposal' && sel(F, 'qlda').value === q && /ngoc/.test(sel(F, 'qlda').className), 'da chuyen, cot Phu trach hien QLDA');
let a = row(F).querySelector('.hs a'); ok(a && a.href === 'https://example.com/brief-f' && a.target === '_blank' && /noopener/.test(a.rel), 'cot Ho so co link Brief');
await pick(F, 'qlda', ''); ok(sel(F, 'qlda').value === '' && /vang/.test(sel(F, 'qlda').className) && /Chưa có QLDA/.test(sel(F, 'qlda').selectedOptions[0].textContent), 'bo QLDA: nhac "Chua co QLDA"');
await pick(F, 'qlda', q2); ok((await xem(F)).lead.qlda === q2, 'chon QLDA ngay tren danh sach');
row(F).querySelector('.hs button').click(); ok(phieu() && !$('pLoai') && $('pBrief').value.endsWith('brief-f') && $('pQlda').value === q2, 'Sua Brief: dien san');
go('pBrief', ''); $('pGui').click(); await wait(900); ok(row(F).querySelector('.hs button.them') && /\+ Brief/.test(row(F).querySelector('.hs').textContent), 'xoa Brief: hien nut + Brief');
await pick(F, 'giaiDoan', 'Đã liên hệ'); await pick(F, 'giaiDoan', 'Khách chờ Proposal'); ok(phieu() && $('pQlda').value === q2, 'thieu Brief thi quay lai van mo o nhap');
go('pBrief', 'https://example.com/brief-f2'); $('pGui').click(); await wait(900);
await pick(F, 'giaiDoan', 'Đã liên hệ'); await pick(F, 'giaiDoan', 'Khách chờ Proposal'); ok(!phieu() && sel(F, 'giaiDoan').value === 'Khách chờ Proposal', 'da du QLDA + Brief thi chuyen thang');
await pick(F, 'giaiDoan', 'Đã gửi Proposal'); go('pLink', 'https://example.com/pp-f'); $('pGui').click(); await wait(900);
let bt = [...row(F).querySelectorAll('button.them')].find((b) => /Ý kiến khách/.test(b.textContent)); ok(bt, 'Da gui Proposal: co nut + Y kien khach');
bt.click(); const oc = () => [...phieu().querySelectorAll('input[name=pYk]')];
ok(phieu().dataset.kieu === 'ykien' && oc().length === 6 && $('pGhi'), 'o ghi y kien co 6 muc');
$('pGui').click(); await wait(200); ok(/ít nhất một/.test($('pLoi').textContent), 'chua chon muc bi nhac');
const tich = (v) => oc().find((o) => o.value === v).click();
tich('Khác'); $('pGui').click(); await wait(800); ok(/ghi rõ/.test($('pLoi').textContent) && oc().find((o) => o.value === 'Khác').checked, 'chon Khac thieu ghi chu: bao loi, giu lua chon');
tich('Khác'); tich('Giá/ngân sách'); tich('Niềm tin'); go('pGhi', 'cho sep duyet'); $('pGui').click(); await wait(900);
ok(!phieu() && /Lăn tăn: Giá\/ngân sách, Niềm tin/.test(row(F).textContent) && /Đã ghi ý kiến/.test($('lmsg').textContent), 'danh sach hien dieu lan tan');
bt = [...row(F).querySelectorAll('button.them')].find((b) => /Ghi thêm/.test(b.textContent)); bt.click(); tich('Thời điểm'); $('pGui').click(); await wait(900);
ok(/Lăn tăn: Thời điểm/.test(row(F).textContent) && /2 lần ghi/.test(row(F).textContent), 'ghi them: hien lan moi nhat va so lan');
// trang chi tiet
w.openDetail(F); await wait(800);
ok($('dFields').querySelector('a[href="https://example.com/brief-f2"]') && /QLDA phụ trách/.test($('dFields').textContent) && $('dFields').querySelector('[data-k="qlda"] button.but') && $('dFields').querySelector('[data-k="linkBrief"] button.but'), 'chi tiet co QLDA, Brief, nut sua');
ok($('dYk').querySelectorAll('tbody tr').length === 2 && /cho sep duyet/.test($('dYk').textContent) && $('dYkLuu'), 'chi tiet co lich su y kien va o ghi them');
const but = (k) => $('dFields').querySelector(`[data-k="${k}"] button.but`);
but('linkBrief').click(); ok($('dsV').value.endsWith('brief-f2'), 'form sua dien san');
$('dsV').value = 'sai'; $('dsLuu').click(); await wait(700); ok(/không hợp lệ/.test($('dsMsg').textContent), 'chi tiet: link sai bao loi');
$('dsV').value = 'https://example.com/brief-f3'; $('dsLuu').click(); await wait(1400); but('qlda').click(); $('dsV').value = q; $('dsLuu').click(); await wait(1400); ok($('dFields').querySelector('a[href="https://example.com/brief-f3"]') && !$('dsV') && $('dFields').querySelector('[data-k="qlda"] .gt').textContent === q, 'chi tiet: luu duoc, dong form');
w.dYkLuu(); ok(/ít nhất một/.test($('dYkMsg').textContent), 'chi tiet: phai chon muc');
d.querySelector('#dYk input[value="Đang so sánh bên khác"]').click(); w.dYkLuu(); await wait(1400); ok($('dYk').querySelectorAll('tbody tr').length === 3 && /Đang so sánh bên khác/.test($('dYk').querySelector('tbody tr').textContent), 'chi tiet: ghi y kien');
// modal doi giai doan -> Da ky: form hop dong dien san
w.dGd(); ok($('gHS').classList.contains('hidden'), 'modal: Da gui khong hien o QLDA rieng');
$('gGd').value = 'Khách chờ Proposal'; w.gdChange(); ok(!$('gHS').classList.contains('hidden') && $('gQlda').value === q && $('gBrief').value.endsWith('f3'), 'modal: Khach cho Proposal hien QLDA + Brief dien san');
$('gGd').value = 'Đã ký'; w.gdChange(); ok($('gHS').classList.contains('hidden') && $('hgQlda').value === q && $('hgBrief').value.endsWith('f3'), 'form hop dong dien san tu lead');
$('hgQlda').value = q2; $('hgGia').value = '12.000.000'; w.doGd(); await wait(1500);
const hF = (await api('danhSachHopDong', {}, adm)).hd.find((x) => x.leadMa === F); ok(hF && hF.qlda === q2 && hF.linkBrief.endsWith('f3'), 'ky tu giao dien: QLDA, Brief theo sang hop dong');
w.show('list'); await wait(700); ok(/Lăn tăn:/.test(row(F).textContent) && ![...row(F).querySelectorAll('button.them')].some((b) => /Ý kiến|Ghi thêm/.test(b.textContent)), 'Da ky: con xem y kien, khong ghi them');
w.openDetail(F); await wait(700); ok($('dYk').querySelectorAll('tbody tr').length === 3 && !$('dYkLuu'), 'chi tiet Da ky: chi xem');
// hop dong
w.show('hd'); await wait(800); ok($('hdTb').textContent.includes('QLDA: ' + q2) && $('hdTb').querySelector('a[href="https://example.com/brief-f3"]'), 'danh sach hop dong hien QLDA + Brief');
w.openHd(hF.ma); await wait(700); ok($('hddFields').querySelector('a[href="https://example.com/brief-f3"]') && /QLDA & link Brief/.test($('hddActs').textContent), 'chi tiet hop dong co QLDA, Brief, nut sua');
w.hdHs(); $('hhQlda').value = q; w.hdHsLuu(); await wait(1400); ok((await xem(F)).lead.qlda === q && $('hddFields').textContent.includes(q) && !$('hhQlda'), 'sua QLDA tu hop dong');
w.show('hd'); await wait(500); w.hdNew(); ok($('nQlda').options.length === dm.qlda.length + 1 && $('nBrief').value === '', 'form hop dong moi co o QLDA, Brief');
// lead Da ky chua co HD -> Tao HD dien san
w.HSLEAD['L-X'] = { qlda: q2, linkBrief: 'https://example.com/x' }; w.hdFromLead('L-X', 'Khach X', 'Dương'); ok($('nQlda').value === q2 && $('nBrief').value === 'https://example.com/x', 'tao HD tu lead dien san');
// dashboard + CSV
w.show('dash'); await wait(800); w.dashTab('yk'); ok(/Điều khách lăn tăn trước ký/.test($('dTab').textContent) && $('dTab').querySelectorAll('tbody tr').length === 6 && /toàn bộ thời gian/.test($('dTab').textContent), 'dashboard co tab Y kien khach');
let csv = null; w.Blob = class { constructor(x) { csv = x.join(''); } }; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; w.HTMLAnchorElement.prototype.click = () => {};
w.exportDash(); ok(/Điều khách lăn tăn/.test(csv) && /Đang so sánh bên khác/.test(csv), 'CSV dashboard co bang lan tan');
w.show('list'); await wait(700); w.$('fKy').value = ''; w.kyChange(); w.exportCsv(); const tach = (x) => x.slice(1, -1).split('","'), dong = csv.split('\r\n').slice(1).map(tach), H = dong[0], cF = dong.find((x) => x[0] === F), cA = dong.find((x) => x[0] === A), o = (x, k) => x[H.indexOf(k)];
ok(H.includes('QLDA phụ trách') && dong.slice(1).every((x) => x.length === H.length), 'CSV lead co cot moi, moi dong du so cot');
ok(o(cF, 'Link Brief') === 'https://example.com/brief-f3' && o(cF, 'QLDA phụ trách') === q && o(cF, 'Khách lăn tăn (lần ghi gần nhất)') === 'Đang so sánh bên khác' && o(cF, 'Số lần ghi ý kiến') === '3', 'CSV lead dung gia tri: ' + o(cF, 'Số lần ghi ý kiến'));
ok(o(cA, 'Khách lăn tăn (lần ghi gần nhất)') === 'Giá/ngân sách' && o(cA, 'Số lần ghi ý kiến') === '2', 'CSV lead A lay lan ghi gan nhat');
const X = await them('Khach YK X ' + stamp); await doi(X, { giaiDoan: 'Đàm phán' }); const gx = await api('ghiYKien', { ma: X, muc: ['Khác'], ghiChu: '=1+1' }, sOwn); ok(gx.ok && gx.yKien.ghiChu === "'=1+1", 'ghi chu bat dau bang = duoc vo hieu cong thuc');
w.show('hd'); await wait(700); w.exportHd(); ok(/"QLDA phụ trách","Link Brief"/.test(csv), 'CSV hop dong co cot moi');
// vai tro QLDA
const G = await them('Khach YK G ' + stamp); await api('doiGiaiDoan', { ma: G, giaiDoan: 'Đã gửi Proposal', linkProposal: 'https://example.com/g', ...viec }, adm);
const Q = await mo('yk_ql_' + stamp);
ok(Q.sel(G, 'qlda') && Q.sel(G, 'qlda').disabled && !Q.row(G).querySelector('.hs button') && !/Ý kiến khách/.test(Q.row(G).textContent), 'QLDA chi xem: khong sua QLDA, Brief, y kien');
{ const s = Q.sel(G, 'giaiDoan'); s.value = 'Khách chờ Proposal'; s.dispatchEvent(new Q.w.Event('change')); await wait(900); ok(!Q.$('tb').querySelector('tr.phieu') && Q.sel(G, 'giaiDoan').value === 'Khách chờ Proposal', 'QLDA doi giai doan khong mo o QLDA'); }
Q.w.openDetail(G); await wait(700); ok(!Q.$('dFields').querySelector('[data-k="qlda"] button.but, [data-k="linkBrief"] button.but') && !Q.$('dYkLuu'), 'QLDA: chi tiet khong co nut sua QLDA, Brief');
console.log(`${pass} pass, ${failn} fail`); process.exit(failn ? 1 : 0);
