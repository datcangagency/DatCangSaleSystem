// Hop dong + doanh thu + canh bao. Chay SAU detail_report.test.mjs (can lead 'Mau Ky' da ky co hop dong).
const BASE = process.env.BASE || 'http://localhost:8799';
const api = async (fn, d = {}, tok) => (await fetch(`${BASE}/api/${fn}`, { method: 'POST', headers: { authorization: tok ? 'Bearer ' + tok : '' }, body: JSON.stringify(d) })).json();
let pass = 0, failn = 0; const ok = (c, n) => { c ? pass++ : failn++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const adm = (await api('login', { username: 'admin', password: 'MatKhauAdmin2026' })).token;
const hom = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10), th = hom.slice(0, 7);
const add = (s, n) => { const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// tai khoan Sale + QLDA
const mk = async (un, ten, role) => { const r = await api('taoTaiKhoan', { username: un, ten, role }, adm); const l = await api('login', { username: un, password: r.matKhauTam }); const pw = 'MatKhau' + un + '2026xx'; await api('doiMatKhau', { cu: r.matKhauTam, moi: pw }, l.token); return (await api('login', { username: un, password: pw })).token; };
const sT = await mk('sale_hd', 'Trung', 'Sale'), sA = await mk('sale_hd2', 'An', 'Sale'), ql = await mk('qlda_hd', 'Nhung', 'QLDA');

let ls = (await api('danhSachHopDong', {}, adm)); ok(ls.ok && ls.hd.length === 1 && ls.hd[0].khach === 'Mau Ky', 'lead Da ky tao san 1 hop dong');
ok(ls.hd[0].dots.length === 1 && ls.hd[0].dots[0].soTien === 6000000 && ls.hd[0].conPhai === 6000000, 'hop dong 1 thang: 1 dot 100%');
ok(ls.hd[0].ma.startsWith('HD-') && ls.hd[0].leadMa, 'ma HD-yymm-nnn va gan lead');

// tao HD thu cong
const base = { khach: 'Quan A', loai: 'Theo thời hạn', soThang: 3, giaTri: 30000000, ngayKy: add(hom, -40), keHoach: '50_50' };
let r = await api('taoHopDong', { ...base, soThang: 2 }, sT); ok(!r.ok && /dưới 3 tháng/.test(r.msg), 'duoi 3 thang khong duoc chia 50+50');
r = await api('taoHopDong', { ...base, giaTri: 0 }, sT); ok(!r.ok, 'gia tri 0 bi tu choi');
r = await api('taoHopDong', { ...base, loai: 'X' }, sT); ok(!r.ok, 'loai sai bi tu choi');
r = await api('taoHopDong', { ...base, loai: 'Theo gói', camKet: 0 }, sT); ok(!r.ok && /gói/.test(r.msg), 'goi can so luong cam ket');
r = await api('taoHopDong', base, ql); ok(!r.ok, 'QLDA khong tao hop dong');
r = await api('taoHopDong', { ...base, sale: 'An' }, sT); ok(r.ok, 'Sale tao HD (Sale ep ve minh)'); const hdA = r.ma;
let ct = await api('chiTietHopDong', { ma: hdA }, sT);
ok(ct.ok && ct.hd.sale === 'Trung' && ct.hd.dots.length === 2 && ct.hd.dots[0].soTien === 15000000 && ct.hd.dots[1].soTien === 15000000 && ct.hd.dots[1].han > ct.hd.dots[0].han, 'tao 2 dot 50/50');
ok(ct.hd.ngayHet > ct.hd.ngayKy, 'ngay het = ky + 3 thang');
r = await api('taoHopDong', { khach: 'Goi B', loai: 'Theo gói', camKet: 5, donVi: 'video', giaTri: 10000000, ngayKy: add(hom, -20), soThang: 1, keHoach: 'mot_lan' }, sA); ok(r.ok, 'HD theo goi'); const hdB = r.ma;
r = await api('taoHopDong', { khach: 'Cu C', loai: 'Theo thời hạn', soThang: 1, giaTri: 5000000, ngayKy: add(hom, -2), ngayHet: add(hom, 5) }, sA); ok(r.ok, 'HD sap het han'); const hdC = r.ma;

// phan quyen xem
ok((await api('chiTietHopDong', { ma: hdA }, sA)).ok === false, 'Sale khac khong xem HD nguoi khac');
ls = await api('danhSachHopDong', {}, sA); ok(ls.hd.length >= 2 && ls.hd.every((h) => h.sale === 'An') && !ls.hd.some((h) => h.ma === hdA), 'Sale chi thay HD cua minh');
ok((await api('doanhThu', {}, sA)).ok === false && (await api('doanhThu', {}, ql)).ok === false, 'Sale/QLDA khong xem doanh thu cong ty');
ok((await api('ghiThuTien', { ma: hdA, soTien: 1000 }, sT)).ok === false, 'Sale khong nhap thu tien');
ok((await api('ghiThucThi', { ma: hdB, loai: 'Giao sản phẩm', soLuong: 1, noiDung: 'x' }, sA)).ok === false, 'Sale khong ghi thuc thi');

// thu tien
r = await api('ghiThuTien', { ma: hdA, soTien: 40000000, ngay: hom }, adm); ok(!r.ok && /Vượt/.test(r.msg), 'khong thu vuot gia tri HD');
r = await api('ghiThuTien', { ma: hdA, soTien: 15000000, ngay: add(hom, -39) }, adm); ok(r.ok && r.conPhai === 15000000, 'thu dot 1');
r = await api('ghiThuTien', { ma: hdA, soTien: -5, ngay: hom }, adm); ok(!r.ok, 'so tien am bi tu choi');
let cb = await api('canhBaoHopDong', {}, adm);
ok(cb.canhBao.thu.some((x) => x.ma === hdA && x.muc === 'quá hạn' && x.soTien === 15000000), 'canh bao qua han dot 2 (' + cb.canhBao.thu.length + ')');
ok(cb.canhBao.het.some((x) => x.ma === hdC), 'canh bao sap het han');
ok(cb.canhBao.imLang.some((x) => x.ma === hdA), 'canh bao 14 ngay khong co thuc thi');
// thuc thi
r = await api('ghiThucThi', { ma: hdB, loai: 'Giao sản phẩm', soLuong: 5, noiDung: 'Giao du 5 video', ngay: hom }, ql); ok(r.ok, 'QLDA ghi thuc thi');
r = await api('ghiThucThi', { ma: hdB, loai: 'Giao sản phẩm', soLuong: 0, noiDung: 'x' }, ql); ok(!r.ok, 'giao san pham can so luong');
r = await api('ghiThucThi', { ma: hdB, loai: 'Khác', noiDung: '' }, ql); ok(!r.ok, 'noi dung bat buoc');
cb = await api('canhBaoHopDong', {}, adm); ok(cb.canhBao.tienDo.some((x) => x.ma === hdB && x.muc === 'đủ số lượng'), 'canh bao goi da giao du');
ok(!cb.canhBao.imLang.some((x) => x.ma === hdB), 'HD co thuc thi gan day khong bi bao im lang');
cb = await api('canhBaoHopDong', {}, sT); ok(cb.canhBao.thu.every((x) => x.sale === 'Trung'), 'Sale chi thay canh bao HD cua minh');
// sua
r = await api('suaHopDong', { ma: hdA, giaTri: 20000000 }, adm); ok(!r.ok && /đã có khoản thu/.test(r.msg), 'khong doi gia tri khi da thu');
r = await api('suaHopDong', { ma: hdC, giaTri: 6000000, keHoach: 'mot_lan' }, adm); ok(r.ok, 'doi gia tri HD chua thu'); ok((await api('chiTietHopDong', { ma: hdC }, adm)).hd.dots[0].soTien === 6000000, 'dot thu tinh lai');
r = await api('suaHopDong', { ma: hdC, trangThai: 'Hủy' }, adm); ok(r.ok, 'huy HD');
// doanh thu
const dt = await api('doanhThu', { thang: th }, adm);
ok(dt.ok && dt.xuHuong.length === 12 && dt.xuHuong[11].m === th, 'doanh thu: 12 thang xu huong');
const hdAll = (await api('danhSachHopDong', {}, adm)).hd.filter((h) => h.trangThai !== 'Hủy');
const tong = hdAll.reduce((s, h) => s + h.giaTri, 0), daThu = hdAll.reduce((s, h) => s + h.daThu, 0);
ok(dt.conPhai === tong - daThu, 'con phai thu = tong gia tri - da thu (' + dt.conPhai + ')');
ok(dt.ky.s === hdAll.filter((h) => h.ngayKy.slice(0, 7) === th).reduce((s, h) => s + h.giaTri, 0), 'doanh so ky theo ngay ky trong thang');
ok(dt.thu === 15000000 || add(hom, -39).slice(0, 7) !== th, 'thuc thu theo ngay thu');
ok(dt.sale.reduce((s, x) => s + x.conPhai, 0) === dt.conPhai, 'con phai theo Sale cong lai bang tong');
ok(Array.isArray(dt.nhanXet) && dt.nhanXet.length >= 1, 'co nhan xet doanh thu');
// lead Da ky tao HD ngay khi chuyen giai doan: lead da co HD khong bi doi tao lai
const lead = (await api('themLead', { ten: 'Khach Ky Moi', sdt: '0911000123', cachSdt: 'Khách cho', nguon: 'Được giới thiệu', sale: 'Trung', ngayNhan: hom, ngayHanhDong: hom, loaiViec: 'Gọi lại' }, adm)).ma;
r = await api('doiGiaiDoan', { ma: lead, giaiDoan: 'Đã ký', hopDong: { loai: 'Theo gói', camKet: 3, donVi: 'bài', giaTri: 3000000, ngayKy: hom } }, sT); ok(r.ok && r.hopDong, 'chuyen Da ky + tao HD cung luc');
ok(!(await api('taoHopDong', { leadMa: lead, khach: 'x', loai: 'Theo gói', camKet: 1, giaTri: 1000, ngayKy: hom }, adm)).ok, 'lead da co HD khong tao them');
const sau = await api('danhSachHopDong', {}, adm); ok(sau.thieuHD.length === 0, 'khong con lead Da ky thieu HD');
// sao luu gom bang moi
const bk = await api('saoLuu', {}, adm); ok(bk.dem.contracts >= 4 && bk.dem.dot_thu >= 4 && bk.dem.thu_tien >= 1 && bk.dem.thuc_thi >= 1, 'sao luu gom hop dong/thu tien/thuc thi ' + JSON.stringify(bk.dem));
console.log(`\n${pass} pass, ${failn} fail`); process.exit(failn ? 1 : 0);
