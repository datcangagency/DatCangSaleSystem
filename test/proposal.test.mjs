// Kiem thu API giai doan Proposal. Chay SAU api.test.mjs (dung tai khoan admin do no tao).
const BASE = process.env.BASE || 'http://localhost:8799';
const api = async (fn, d = {}, tok) => (await fetch(`${BASE}/api/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(d) })).json();
let pass = 0, failn = 0; const ok = (c, n) => { c ? pass++ : failn++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const adm = (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token;
const dm = (await api('layDanhMuc', {}, adm)).dm;
ok(dm.giaiDoan.join('|') === 'Mới|Đã liên hệ|Hẹn tư vấn|Khách chờ Proposal|Đã gửi Proposal|Đàm phán|Đã ký|Mất|Không tiềm năng', 'danh muc giai doan: ' + dm.giaiDoan.join('|'));
const so = String(Date.now()).slice(-7);
const them = await api('themLead', { ngayNhan: '2026-11-20', nguon: 'Được giới thiệu', ten: 'Khach Proposal ' + so, sdt: '091' + so, cachSdt: 'Khách cho', sale: 'Linh', loaiViec: 'Làm proposal', ngayHanhDong: '2099-01-01' }, adm);
ok(them.ok, 'them lead: ' + them.msg); const ma = them.ma;
const viec = { ma, loaiViec: 'Gọi lại', ngayHanhDong: '2099-02-01' };
const doi = (x) => api('doiGiaiDoan', { ...viec, ...x }, adm);
const xem = async () => (await api('chiTietLead', { ma }, adm)).lead;
ok((await doi({ giaiDoan: 'Khách chờ Proposal' })).ok, 'sang Khach cho Proposal khong can link');
let r = await doi({ giaiDoan: 'Đã gửi Proposal' }); ok(!r.ok && /cần dán link/.test(r.msg), 'thieu link bi tu choi');
for (const xau of ['abc', 'javascript:alert(1)', 'ftp://x.com/a', 'https://khong-co-cham', 'https://a.com/co khoang trang', 'https://a.com/' + 'x'.repeat(600)]) {
  r = await doi({ giaiDoan: 'Đã gửi Proposal', linkProposal: xau }); ok(!r.ok && /không hợp lệ/.test(r.msg), 'link sai bi tu choi: ' + xau.slice(0, 40));
}
ok((await xem()).giaiDoan === 'Khách chờ Proposal' && (await xem()).linkProposal === '', 'bi tu choi thi du lieu giu nguyen');
r = await doi({ giaiDoan: 'Đã gửi Proposal', linkProposal: ' https://example.com/p1 ' }); ok(r.ok, 'co link thi duoc: ' + r.msg);
ok((await xem()).giaiDoan === 'Đã gửi Proposal' && (await xem()).linkProposal === 'https://example.com/p1', 'luu link da cat khoang trang');
r = await doi({ giaiDoan: 'Đã gửi Proposal' }); ok(r.ok && (await xem()).linkProposal === 'https://example.com/p1', 'dang o Da gui: sua viec tiep theo khong mat link');
ok((await doi({ giaiDoan: 'Đàm phán' })).ok && (await xem()).linkProposal === 'https://example.com/p1', 'sang Dam phan giu link');
ok((await doi({ giaiDoan: 'Đã gửi Proposal' })).ok, 'quay lai Da gui dung link da luu');
r = await api('suaNhanh', { ma, truong: 'linkProposal', giaTri: 'https://example.com/p2' }, adm); ok(r.ok && (await xem()).linkProposal === 'https://example.com/p2', 'sua nhanh link');
r = await api('suaNhanh', { ma, truong: 'linkProposal', giaTri: '' }, adm); ok(!r.ok && (await xem()).linkProposal === 'https://example.com/p2', 'khong xoa trang link');
const ev = (await api('chiTietLead', { ma }, adm)).ev; ok(ev.some((e) => /Link Proposal: .*p1.*p2/.test(e.noiDung)), 'lich su ghi doi link');
const un = 'pp_' + Date.now().toString(36);
const tmp = (await api('taoTaiKhoan', { username: un, ten: 'An', role: 'Sale' }, adm)).matKhauTam;
const t = (await api('login', { username: un, password: tmp })).token; await api('doiMatKhau', { cu: tmp, moi: 'MatKhauPp2026xx' }, t);
r = await api('suaNhanh', { ma, truong: 'linkProposal', giaTri: 'https://example.com/p3' }, t); ok(!r.ok && /không thuộc/.test(r.msg), 'Sale khac khong sua duoc link');
r = await api('danhSachLead', {}, adm); ok(r.leads.find((l) => l.ma === ma).linkProposal === 'https://example.com/p2', 'danh sach tra link');
r = await api('saoLuu', {}, adm); ok(r.ok && r.sql.includes('link_proposal') && r.sql.includes('https://example.com/p2'), 'ban sao luu co link');
console.log(`${pass} pass, ${failn} fail`); process.exit(failn ? 1 : 0);
