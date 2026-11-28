// Dat Cang - Quan ly khach (Cloudflare Worker + D1). Chi chua ma nguon; du lieu nam trong D1.
// Moi API: POST /api/<ten>, body JSON, token trong header Authorization: Bearer <token>.

const SESSION_MS = 6 * 3600 * 1000, MAX_FAIL = 5, LOCK_MS = 15 * 60 * 1000;
const PBKDF2_ITERS = 10000;          // Goi y: Workers Free chi cho 10 ms CPU/yeu cau; do thuc te truoc khi tang
const MIN_PASS = 10;
const ROLES = ['Admin', 'QLDA', 'Sale'];
const CLOSED = ['Đã ký', 'Mất', 'Không tiềm năng'];
const LOSS = ['Mất', 'Không tiềm năng'];
const DA_GUI = 'Đã gửi Proposal';   // giai đoạn bắt buộc có link Proposal
const CHUA_HO_SO = ['Mới', 'Đã liên hệ', 'Hẹn tư vấn'];   // chưa tới bước nhập QLDA và link Brief
const GD_Y_KIEN = [DA_GUI, 'Đàm phán'];                  // giai đoạn ghi ý kiến khách trước ký

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const now = () => Date.now();
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (msg, extra) => ({ ok: false, msg, ...(extra || {}) });

async function sha256(s) { return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function pbkdf2(pass, salt, iters) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iters }, k, 256));
}
function safeEq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function randPass() { const cs = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from(rnd(14), (x) => cs[x % cs.length]).join(''); }
// Chong chen cong thuc khi ai do mo du lieu bang Excel/Trang tinh
function safe(v) { const s = String(v == null ? '' : v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }

function bkk() { return new Date(now() + 7 * 3600 * 1000); }       // gio Viet Nam
function yymm() { const d = bkk(); return String(d.getUTCFullYear()).slice(2) + ('0' + (d.getUTCMonth() + 1)).slice(-2); }
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z')); }

// ---- hop dong / doanh thu ----
const LOAI_HD = ['Theo gói', 'Theo thời hạn'], KE_HOACH = ['mot_lan', '50_50'];
const LOAI_TT = ['Giao sản phẩm', 'Báo cáo/Họp khách', 'Phản hồi của khách', 'Khác'];
const TT_HD = ['Đang thực hiện', 'Hoàn thành', 'Hủy'];
const HD_HET_GAN = 14, HD_IM_LANG = 14, HD_THU_GAN = 7;   // ngay: gan het han / khong co su kien thuc thi / sap den han thu (proposed, chinh duoc)
const ymd = (dt) => dt.toISOString().slice(0, 10);
const homNayVN = () => ymd(bkk());
function addMonths(s, n) { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d, last)); return ymd(t); }
function addDays(s, n) { const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return ymd(t); }
function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
const tien = (v) => Math.round(Number(v) || 0);

// Kiem tra du lieu hop dong + dung cac cau lenh INSERT (hop_dong + dot_thu). lead: dong lead (hoac null)
async function chuanBiHD(env, a, d, lead) {
  const khach = String((d.khach || (lead && lead.ten) || '')).trim();
  const loai = String(d.loai || ''), ngayKy = String(d.ngayKy || homNayVN());
  const soThang = d.soThang === '' || d.soThang == null ? 0 : Number(d.soThang), camKet = d.camKet === '' || d.camKet == null ? 0 : Number(d.camKet);
  const gia = Number(d.giaTri), ke = String(d.keHoach || 'mot_lan'), donVi = String(d.donVi || '').trim();
  const e = [];
  if (!khach || khach.length > 150) e.push('Tên khách bắt buộc (tối đa 150 ký tự).');
  if (!LOAI_HD.includes(loai)) e.push('Chọn loại hợp đồng: Theo gói hoặc Theo thời hạn.');
  if (!validDate(ngayKy)) e.push('Ngày ký không hợp lệ.');
  if (!Number.isFinite(gia) || gia <= 0) e.push('Giá trị hợp đồng (Net trước VAT) phải lớn hơn 0.');
  if (!KE_HOACH.includes(ke)) e.push('Kiểu thanh toán không hợp lệ.');
  if (!Number.isInteger(soThang) || soThang < 0 || soThang > 60) e.push('Số tháng phải là số nguyên 0-60.');
  if (!Number.isInteger(camKet) || camKet < 0 || camKet > 100000) e.push('Số lượng cam kết phải là số nguyên không âm.');
  if (loai === 'Theo thời hạn' && soThang < 1) e.push('Hợp đồng theo thời hạn cần số tháng ≥ 1.');
  if (loai === 'Theo gói' && camKet < 1) e.push('Hợp đồng theo gói cần số lượng cam kết ≥ 1 (ví dụ 5 video).');
  if (ke === '50_50' && loai === 'Theo thời hạn' && soThang < 3) e.push('Hợp đồng dưới 3 tháng thu 1 lần (100%). Chỉ từ 3 tháng mới chia 50% + 50%.');
  let ngayHet = String(d.ngayHet || '');
  if (ngayHet && !validDate(ngayHet)) e.push('Ngày hết hạn không hợp lệ.');
  if (!ngayHet && soThang > 0) ngayHet = addMonths(ngayKy, soThang);
  if (ngayHet && validDate(ngayKy) && ngayHet < ngayKy) e.push('Ngày hết hạn không được trước ngày ký.');
  if (donVi.length > 30) e.push('Đơn vị tối đa 30 ký tự.');
  const ghiChu = String(d.ghiChu || '').trim();
  if (ghiChu.length > 500) e.push('Ghi chú tối đa 500 ký tự.');
  let sale = a.role === 'Sale' ? a.ten : String(d.sale || (lead && lead.sale) || '').trim();
  if (!sale) e.push('Chọn Sale phụ trách.');
  else if (a.role !== 'Sale' && !(await catalog(env)).sale.includes(sale)) e.push('Sale không có trong danh mục.');
  if (lead && a.role === 'Sale' && lead.sale !== a.ten) e.push('Lead này không thuộc Sale của bạn.');
  // Có lead gốc: ghi vào lead (hợp đồng đọc theo), để trống thì giữ giá trị đã có ở lead. Không có lead: ghi ở hợp đồng.
  const gui = {}; if (String(d.qlda || '').trim()) gui.qlda = d.qlda; if (String(d.linkBrief || '').trim()) gui.linkBrief = d.linkBrief;
  const luuO = lead ? (await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(lead.ma).first()) : {};
  const hs = doiHoSo(await catalog(env), gui, luuO); if (hs.loi) e.push(hs.loi);
  if (e.length) return { err: e.join(' ') };
  const t = now(), key = 'HD-' + yymm();
  const c = await env.DB.prepare('INSERT INTO counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n').bind(key).first();
  const ma = key + '-' + ('000' + c.n).slice(-3);
  const giaR = tien(gia);
  const dots = ke === '50_50' ? [[1, 50, Math.round(giaR / 2), ngayKy], [2, 50, giaR - Math.round(giaR / 2), addMonths(ngayKy, 1)]] : [[1, 100, giaR, ngayKy]];
  const stmts = [env.DB.prepare('INSERT INTO contracts(ma,lead_ma,khach,sale,loai,ngay_ky,so_thang,ngay_het,cam_ket,don_vi,gia_tri,ke_hoach,trang_thai,can_xac_nhan,ghi_chu,tao_luc,sua_boi,sua_luc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ma, lead ? lead.ma : '', safe(khach), sale, loai, ngayKy, soThang, ngayHet, camKet, safe(donVi), giaR, ke, 'Đang thực hiện', d.canXacNhan ? 1 : 0, safe(ghiChu), t, a.ten, t)];
  for (const x of dots) stmts.push(env.DB.prepare('INSERT INTO dot_thu(hd_ma,dot,ty_le,so_tien,han) VALUES(?,?,?,?,?)').bind(ma, x[0], x[1], x[2], x[3]));
  if (lead) stmts.push(...stmtHoSo(env, a, 'leads', lead.ma, luuO, hs.moi));
  else if (Object.keys(hs.moi).length) stmts.push(...stmtHoSo(env, a, 'contracts', ma, {}, hs.moi));
  stmts.push(logStmt(env, a.username, 'TAO_HOP_DONG', ma, `${khach} | ${loai} | ${giaR} | ${ke}${lead ? ' | ' + lead.ma : ''}`));
  return { ma, stmts };
}

// Gom so lieu phat sinh cho tap hop dong: tong da thu, dot thu, su kien thuc thi
async function phanTichHD(env, rows) {
  if (!rows.length) return [];
  const [dots, thu, tt, gh, ld] = await env.DB.batch([
    env.DB.prepare('SELECT hd_ma, dot, ty_le, so_tien, han FROM dot_thu ORDER BY hd_ma, dot'),
    env.DB.prepare('SELECT hd_ma, SUM(so_tien) AS s, MAX(ngay) AS cuoi FROM thu_tien GROUP BY hd_ma'),
    env.DB.prepare('SELECT hd_ma, COUNT(*) AS n, MAX(ngay) AS cuoi FROM thuc_thi GROUP BY hd_ma'),
    env.DB.prepare("SELECT hd_ma, SUM(so_luong) AS s FROM thuc_thi WHERE loai = 'Giao sản phẩm' GROUP BY hd_ma"),
    env.DB.prepare('SELECT ma, qlda, link_brief FROM leads WHERE ma IN (SELECT lead_ma FROM contracts)'),
  ]);
  const mLd = {}; for (const x of ld.results) mLd[x.ma] = x;
  const by = (r) => { const m = {}; for (const x of r.results) (m[x.hd_ma] = m[x.hd_ma] || []).push(x); return m; };
  const mDot = by(dots), mThu = {}, mTt = {}, mGh = {};
  for (const x of thu.results) mThu[x.hd_ma] = x; for (const x of tt.results) mTt[x.hd_ma] = x; for (const x of gh.results) mGh[x.hd_ma] = x.s || 0;
  const today = homNayVN();
  return rows.map((c) => {
    const ds = mDot[c.ma] || [], daThu = tien((mThu[c.ma] || {}).s), tc = mTt[c.ma] || {};
    let cum = 0, quaHanSo = 0, dotTiep = null;
    for (const x of ds) { cum += x.so_tien; if (x.han < today && daThu < cum) quaHanSo = Math.max(quaHanSo, cum - daThu); }
    let acc = 0; for (const x of ds) { acc += x.so_tien; if (daThu < acc) { dotTiep = { dot: x.dot, han: x.han, soTien: Math.min(x.so_tien, acc - daThu) }; break; } }
    const goc = (c.lead_ma && mLd[c.lead_ma]) || c;
    return { ...c, qlda: goc.qlda || '', link_brief: goc.link_brief || '', dots: ds, daThu, conPhai: Math.max(0, c.gia_tri - daThu), quaHanSo, dotTiep, giao: mGh[c.ma] || 0, suKien: tc.n || 0, suKienCuoi: tc.cuoi || '' };
  });
}

function canhBaoHD(list) {
  const today = homNayVN(), out = { thu: [], het: [], tienDo: [], imLang: [] };
  for (const c of list) {
    if (c.trang_thai !== 'Đang thực hiện') continue;
    const base = { ma: c.ma, khach: c.khach, sale: c.sale };
    if (c.quaHanSo > 0) out.thu.push({ ...base, muc: 'quá hạn', soTien: c.quaHanSo, han: (c.dotTiep || {}).han || '', text: `Quá hạn thu ${tien(c.quaHanSo).toLocaleString('vi-VN')} đ` });
    else if (c.dotTiep && c.dotTiep.han >= today && diffDays(today, c.dotTiep.han) <= HD_THU_GAN) out.thu.push({ ...base, muc: 'sắp đến hạn', soTien: c.dotTiep.soTien, han: c.dotTiep.han, text: `Đợt ${c.dotTiep.dot} thu ${tien(c.dotTiep.soTien).toLocaleString('vi-VN')} đ, hạn ${c.dotTiep.han.split('-').reverse().join('/')}` });
    if (c.ngay_het) { const n = diffDays(today, c.ngay_het); if (n <= HD_HET_GAN) out.het.push({ ...base, ngayHet: c.ngay_het, conLai: n, text: n < 0 ? `Đã hết hạn ${-n} ngày, chưa đóng hợp đồng` : `Còn ${n} ngày hết hạn: chuẩn bị tái ký` }); }
    if (c.loai === 'Theo gói' && c.cam_ket > 0) {
      const dv = c.don_vi || 'sản phẩm', xong = c.giao / c.cam_ket;
      if (c.giao >= c.cam_ket) out.tienDo.push({ ...base, muc: 'đủ số lượng', text: `Đã giao đủ ${c.giao}/${c.cam_ket} ${dv}: đóng hợp đồng hoặc chào gói mới` });
      else if (c.ngay_het && c.ngay_ky < c.ngay_het) { const tl = Math.min(1, Math.max(0, diffDays(c.ngay_ky, today) / diffDays(c.ngay_ky, c.ngay_het)));
        if (tl - xong >= 0.25) out.tienDo.push({ ...base, muc: 'chậm tiến độ', text: `Đã qua ${Math.round(tl * 100)}% thời gian nhưng mới giao ${c.giao}/${c.cam_ket} ${dv}` }); }
    }
    const moc = c.suKienCuoi || c.ngay_ky, im = diffDays(moc, today);
    if (im >= HD_IM_LANG) out.imLang.push({ ...base, soNgay: im, text: c.suKienCuoi ? `${im} ngày chưa có sự kiện thực thi (gần nhất ${c.suKienCuoi.split('-').reverse().join('/')})` : `${im} ngày từ khi ký chưa có sự kiện thực thi nào` });
  }
  return out;
}
const hdOut = (c) => ({ ma: c.ma, leadMa: c.lead_ma, khach: c.khach, sale: c.sale, qlda: c.qlda || '', linkBrief: c.link_brief || '', loai: c.loai, ngayKy: c.ngay_ky, soThang: c.so_thang, ngayHet: c.ngay_het, camKet: c.cam_ket, donVi: c.don_vi, giaTri: c.gia_tri, keHoach: c.ke_hoach,
  trangThai: c.trang_thai, canXacNhan: !!c.can_xac_nhan, ghiChu: c.ghi_chu, daThu: c.daThu, conPhai: c.conPhai, quaHanSo: c.quaHanSo, dotTiep: c.dotTiep, dots: c.dots.map((x) => ({ dot: x.dot, tyLe: x.ty_le, soTien: x.so_tien, han: x.han })), giao: c.giao, suKien: c.suKien, suKienCuoi: c.suKienCuoi });
const hdVisible = (a) => a.role === 'Sale' ? ' WHERE sale = ?' : '';
function normPhone(v) {
  let s = String(v || '').trim().replace(/[\s.\-()]/g, '');
  if (/^\+?84\d{9,10}$/.test(s)) s = '0' + s.replace(/^\+?84/, '');
  return /^0\d{9,10}$/.test(s) ? s : '';
}
function normLink(v) {
  let x = String(v || '').trim().toLowerCase();
  if (!x || /\s/.test(x)) return '';
  x = x.replace(/^https?:\/\//, '').replace(/^(www\.|m\.|mbasic\.|web\.)/, '').replace(/#.*$/, '');
  const m = /^([^?]*)\?(.*)$/.exec(x); let id = '';
  if (m) { x = m[1]; const q = /(?:^|&)id=(\d+)/.exec(m[2]); if (q) id = '?id=' + q[1]; }
  x = x.replace(/\/+$/, '') + id;
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/.test(x) ? x : '';
}

// Link Proposal phải là địa chỉ web đầy đủ (http/https), không chứa khoảng trắng.
const linkHopLe = (v) => v.length <= 500 && /^https?:\/\/[^\s"'<>\/]+\.[^\s"'<>]+$/i.test(v);
const LOI_LINK = 'Link Proposal không hợp lệ: dán đầy đủ địa chỉ bắt đầu bằng http:// hoặc https://.';

// QLDA phụ trách và link Brief: đều không bắt buộc, được xóa trống. Chỉ Sale phụ trách hoặc Admin nhập.
const LOI_BRIEF = 'Link Brief không hợp lệ: dán đầy đủ địa chỉ bắt đầu bằng http:// hoặc https://.';
const LOI_QUYEN_HS = 'Chỉ Sale phụ trách hoặc Admin được nhập QLDA và link Brief.';
// Trả về { loi } hoặc { moi: {qlda?, link_brief?} } chỉ gồm trường được gửi lên và có thay đổi so với cu.
function doiHoSo(dm, d, cu) {
  const moi = {};
  if (d.qlda !== undefined) { const v = String(d.qlda || '').trim(); if (v !== (cu.qlda || '')) { if (v && !dm.qlda.includes(v)) return { loi: 'Chọn QLDA từ danh sách.' }; moi.qlda = v; } }
  if (d.linkBrief !== undefined) { const v = String(d.linkBrief || '').trim(); if (v !== (cu.link_brief || '')) { if (v && !linkHopLe(v)) return { loi: LOI_BRIEF }; moi.link_brief = v; } }
  return { moi };
}
const TEN_HS = { qlda: 'QLDA', link_brief: 'Link Brief' };
function stmtHoSo(env, a, bang, ma, cu, moi) {
  const cot = Object.keys(moi); if (!cot.length) return [];
  return [env.DB.prepare(`UPDATE ${bang} SET ${cot.map((k) => k + '=?').join(', ')}, sua_boi=?, sua_luc=? WHERE ma=?`).bind(...cot.map((k) => moi[k]), a.ten, now(), ma),
    logStmt(env, a.username, 'SUA_NHANH', ma, cot.map((k) => `${TEN_HS[k]}: ${cu[k] || '(trống)'} → ${moi[k] || '(trống)'}`).join(' | '))];
}
const docMuc = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; } };
const ykOut = (r) => ({ ngay: r.ngay, giaiDoan: r.giai_doan, muc: docMuc(r.muc), ghiChu: r.ghi_chu, boi: r.boi });

// Tên cũ "Mình tự tìm" đổi thành "Tự tìm" (dữ liệu và trang cũ vẫn gửi tên cũ đều được hiểu).
const tenCach = (v) => (v === 'Mình tự tìm' ? 'Tự tìm' : v);

async function catalog(env) {
  const { results } = await env.DB.prepare('SELECT kind, value FROM catalog ORDER BY kind, ord').all();
  const o = { giaiDoan: [], nguon: [], nguonLink: [], cachSdt: [], sale: [], qlda: [], lyDo: [], mucTiemNang: [], loaiViec: [], lanTan: [] };
  const map = { giai_doan: 'giaiDoan', nguon: 'nguon', nguon_link: 'nguonLink', cach_sdt: 'cachSdt', sale: 'sale', qlda: 'qlda', ly_do: 'lyDo', muc_tiem_nang: 'mucTiemNang', loai_viec: 'loaiViec', lan_tan: 'lanTan' };
  for (const r of results) if (map[r.kind]) o[map[r.kind]].push(r.kind === 'cach_sdt' ? tenCach(r.value) : r.value);
  return o;
}

function logStmt(env, usr, action, obj, detail) {
  return env.DB.prepare('INSERT INTO audit(luc,usr,action,obj,detail) VALUES(?,?,?,?,?)').bind(now(), usr, action, obj || '', String(detail || '').slice(0, 500));
}

async function auth(env, req) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!tok) return null;
  const th = await sha256(tok);
  const r = await env.DB.prepare(
    'SELECT u.username, u.ten, u.role, u.must_change, s.expires FROM sessions s JOIN users u ON u.username = s.username WHERE s.token_hash = ? AND u.active = 1'
  ).bind(th).first();
  if (!r || r.expires < now()) return null;
  return { username: r.username, ten: r.ten, role: r.role, doiMK: !!r.must_change, th };
}
const userOut = (u) => ({ username: u.username, ten: u.ten, role: u.role, doiMK: !!(u.doiMK ?? u.must_change) });

async function newSession(env, username) {
  const tok = b64url(rnd(32));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()),
    env.DB.prepare('INSERT INTO sessions(token_hash,username,expires) VALUES(?,?,?)').bind(await sha256(tok), username, now() + SESSION_MS),
  ]);
  return tok;
}

// Số sao ưu tiên 0..3: có SĐT thì tối thiểu 1 sao; 2 và 3 sao do người dùng chọn.
const soSao = (r) => Math.max(Number(r.uu_tien) || 0, r.sdt ? 1 : 0);
const SQL_SAO = "MAX(uu_tien, CASE WHEN sdt <> '' THEN 1 ELSE 0 END)";

const leadOut = (r) => ({
  ma: r.ma, ngayNhan: r.ngay_nhan, ten: r.ten, sdt: r.sdt, link: r.link, nguon: r.nguon, cachSdt: tenCach(r.cach_sdt), sale: r.sale,
  giaiDoan: r.giai_doan, ngayDoiGd: r.ngay_doi_gd, mucTiemNang: r.muc_tiem_nang, tomLuoc: r.tom_luoc, loaiViec: r.loai_viec,
  hanhDong: r.hanh_dong, ngayHd: r.ngay_hd, giaTri: r.gia_tri, lyDo: r.ly_do, ghiChu: r.ghi_chu, linkProposal: r.link_proposal || '', qlda: r.qlda || '', linkBrief: r.link_brief || '', sao: soSao(r), uuTien: soSao(r) > 0,
});

async function findDup(env, sdt, linkKey, exceptMa) {
  const r = await env.DB.prepare(
    "SELECT ma, sale, giai_doan FROM leads WHERE ((? <> '' AND sdt = ?) OR (? <> '' AND link_key = ?)) AND ma <> ? LIMIT 1"
  ).bind(sdt, sdt, linkKey, linkKey, exceptMa || '').first();
  return r ? `Lead đã có trong hệ thống: ${r.ma}, Sale ${r.sale}, giai đoạn ${r.giai_doan}.` : '';
}

const API = {
  async login(env, req, a, d) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(String(d.username || '').trim().toLowerCase()).first();
    const bad = 'Sai tên đăng nhập hoặc mật khẩu.';
    if (!u || !u.active) return fail(bad);
    if (u.locked_until > now()) return fail(`Tài khoản đang bị khóa, thử lại sau ${Math.ceil((u.locked_until - now()) / 60000)} phút.`);
    const h = await pbkdf2(String(d.password || ''), u.salt, u.iters);
    if (!safeEq(h, u.hash)) {
      const f = u.fails + 1, lock = f >= MAX_FAIL;
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET fails = ?, locked_until = ? WHERE username = ?').bind(lock ? 0 : f, lock ? now() + LOCK_MS : 0, u.username),
        logStmt(env, u.username, lock ? 'KHOA_TAI_KHOAN' : 'DANG_NHAP_SAI', u.username, ''),
      ]);
      return fail(lock ? 'Sai quá 5 lần, tài khoản bị khóa 15 phút.' : bad);
    }
    const token = await newSession(env, u.username);
    await env.DB.batch([env.DB.prepare('UPDATE users SET fails = 0, locked_until = 0 WHERE username = ?').bind(u.username), logStmt(env, u.username, 'DANG_NHAP', u.username, '')]);
    return { ok: true, token, user: userOut(u) };
  },
  async phien(env, req, a) { return a ? { ok: true, user: userOut(a) } : { ok: false, expired: true }; },
  async logout(env, req, a) { if (a) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(a.th).run(); return { ok: true }; },
  async doiMatKhau(env, req, a, d) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(a.username).first();
    if (!safeEq(await pbkdf2(String(d.cu || ''), u.salt, u.iters), u.hash)) return fail('Mật khẩu hiện tại không đúng.');
    const nw = String(d.moi || '');
    if (nw.length < MIN_PASS) return fail(`Mật khẩu mới tối thiểu ${MIN_PASS} ký tự.`);
    if (nw === String(d.cu)) return fail('Mật khẩu mới phải khác mật khẩu cũ.');
    const salt = b64url(rnd(16));
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET salt=?, hash=?, iters=?, must_change=0 WHERE username=?').bind(salt, await pbkdf2(nw, salt, PBKDF2_ITERS), PBKDF2_ITERS, a.username),
      env.DB.prepare('DELETE FROM sessions WHERE username = ? AND token_hash <> ?').bind(a.username, a.th),
      logStmt(env, a.username, 'DOI_MAT_KHAU', a.username, ''),
    ]);
    return { ok: true };
  },
  async layDanhMuc(env) { return { ok: true, dm: await catalog(env) }; },

  async themLead(env, req, a, d) {
    const dm = await catalog(env);
    const useLink = dm.nguonLink.includes(String(d.nguon));
    const ten = String(d.ten || '').trim(), tl = String(d.tomLuoc || '').trim(), gc = String(d.ghiChu || '').trim(), hd = String(d.hanhDong || '').trim();
    const rawSdt = String(d.sdt || '').trim(), sdt = rawSdt ? normPhone(rawSdt) : '';
    const rawLink = useLink ? String(d.link || '').trim() : '', linkKey = rawLink ? normLink(rawLink) : '';
    let cach = tenCach(String(d.cachSdt || '').trim());
    const sale = a.role === 'Sale' ? a.ten : String(d.sale || '').trim();
    const gia = d.giaTri === '' || d.giaTri == null ? null : Number(d.giaTri);
    const e = [];
    if (!ten || ten.length > 200) e.push('Tên khách bắt buộc, tối đa 200 ký tự.');
    if (rawSdt && !sdt) e.push('SĐT không hợp lệ (10 hoặc 11 số, bắt đầu bằng 0). Chưa có SĐT thì để trống.');
    if (rawLink && !linkKey) e.push('Link Facebook/fanpage không hợp lệ.');
    if (rawLink.length > 300) e.push('Link tối đa 300 ký tự.');
    if (useLink && !sdt && !linkKey) e.push('Nguồn này cần SĐT hoặc link Facebook/fanpage của khách.');
    if (!useLink && !sdt) e.push('Nguồn này bắt buộc có SĐT.');
    if (sdt && !dm.cachSdt.includes(cach)) e.push('Chọn cách có SĐT: Khách cho hay Tự tìm.');
    if (!sdt) cach = '';
    if (!dm.nguon.includes(String(d.nguon))) e.push('Chọn nguồn từ danh sách.');
    if (!dm.sale.includes(sale)) e.push('Chọn Sale phụ trách từ danh sách.');
    if (!validDate(d.ngayNhan)) e.push('Ngày nhận không hợp lệ.');
    if (!dm.loaiViec.includes(String(d.loaiViec))) e.push('Chọn loại việc tiếp theo.');
    if (hd.length > 300) e.push('Mô tả việc tiếp theo tối đa 300 ký tự.');
    if (tl.length > 1000) e.push('Tóm lược tối đa 1000 ký tự.');
    if (gc.length > 500) e.push('Ghi chú tối đa 500 ký tự.');
    if (!validDate(d.ngayHanhDong)) e.push('Ngày hành động không hợp lệ.');
    else if (validDate(d.ngayNhan) && d.ngayHanhDong < d.ngayNhan) e.push('Ngày hành động không được trước ngày nhận.');
    if (gia !== null && (isNaN(gia) || gia < 0)) e.push('Giá trị dự kiến phải là số không âm.');
    if (e.length) return fail(e.join(' '));
    const dup = await findDup(env, sdt, linkKey, ''); if (dup) return fail(dup);

    const key = 'L-' + yymm(), t = now();
    const c = await env.DB.prepare('INSERT INTO counters(key,n) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n').bind(key).first();
    const ma = key + '-' + ('000' + c.n).slice(-3);
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO leads(ma,ngay_nhan,ten,sdt,link,link_key,nguon,cach_sdt,sale,giai_doan,ngay_doi_gd,muc_tiem_nang,tom_luoc,loai_viec,hanh_dong,ngay_hd,gia_tri,ghi_chu,uu_tien,ngay_co_sdt,tao_luc,sua_boi,sua_luc)
           VALUES(?,?,?,?,?,?,?,?,?,'Mới',?,'Chưa phân loại',?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(ma, d.ngayNhan, safe(ten), sdt, safe(rawLink), linkKey, d.nguon, cach, sale, t, safe(tl), d.loaiViec, safe(hd), d.ngayHanhDong, gia, safe(gc), sdt ? 1 : 0, sdt ? t : null, t, a.ten, t),
        logStmt(env, a.username, 'THEM_LEAD', ma, `Sale ${sale}${sdt ? ', co SDT' : ', chua co SDT'}`),
      ]);
    } catch (err) { if (/UNIQUE/i.test(String(err))) return fail('Lead đã có trong hệ thống (SĐT hoặc link trùng).'); throw err; }
    return { ok: true, ma };
  },

  async danhSachLead(env) {
    const { results } = await env.DB.prepare(`SELECT * FROM leads ORDER BY ${SQL_SAO} DESC, tao_luc DESC LIMIT 3000`).all();
    const yk = {};
    for (const r of (await env.DB.prepare('SELECT lead_ma, ngay, giai_doan, muc, ghi_chu, boi FROM y_kien ORDER BY id').all()).results) yk[r.lead_ma] = { so: (yk[r.lead_ma] ? yk[r.lead_ma].so : 0) + 1, ...ykOut(r) };
    return { ok: true, leads: results.map((r) => ({ ...leadOut(r), yKien: yk[r.ma] || null })) };
  },

  async doiGiaiDoan(env, req, a, d) {
    const dm = await catalog(env);
    const l = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    if (a.role === 'Sale' && l.sale !== a.ten) return fail('Lead này không thuộc Sale của bạn.');
    const gd = String(d.giaiDoan || '');
    if (!dm.giaiDoan.includes(gd)) return fail('Giai đoạn không hợp lệ.');
    const muc = d.mucTiemNang ? String(d.mucTiemNang) : l.muc_tiem_nang;
    if (muc !== 'Chưa phân loại' && !dm.mucTiemNang.includes(muc)) return fail('Mức tiềm năng không hợp lệ.');
    const closed = CLOSED.includes(gd), t = now();
    let lyDo = '', loai = '', hd = '', ngay = '';
    if (LOSS.includes(gd)) {
      lyDo = String(d.lyDo || '');
      if (!dm.lyDo.includes(lyDo)) return fail('Chọn lý do ' + (gd === 'Mất' ? 'mất' : 'không tiềm năng') + '.');
    }
    const ghiChu = String(d.ghiChu || '').trim().slice(0, 300);
    if (!closed) {
      loai = String(d.loaiViec || ''); hd = String(d.hanhDong || '').trim(); ngay = String(d.ngayHanhDong || '');
      if (!dm.loaiViec.includes(loai)) return fail('Chọn loại việc tiếp theo.');
      if (!validDate(ngay)) return fail('Ngày hành động không hợp lệ.');
      if (hd.length > 300) return fail('Mô tả việc tiếp theo tối đa 300 ký tự.');
    }
    const cuLink = l.link_proposal || '', moiLink = gd === DA_GUI ? String(d.linkProposal || '').trim() : '';
    if (moiLink && !linkHopLe(moiLink)) return fail(LOI_LINK);
    if (gd === DA_GUI && l.giai_doan !== DA_GUI && !(moiLink || cuLink)) return fail('Chuyển sang Đã gửi Proposal cần dán link Proposal.');
    let hs = { moi: {} };
    if (!CHUA_HO_SO.includes(gd) && (d.qlda !== undefined || d.linkBrief !== undefined)) {
      hs = doiHoSo(dm, d, l); if (hs.loi) return fail(hs.loi);
      if (a.role === 'QLDA' && Object.keys(hs.moi).length) return fail(LOI_QUYEN_HS);
    }
    const sets = [env.DB.prepare(
      'UPDATE leads SET giai_doan=?, ngay_doi_gd=?, muc_tiem_nang=?, ly_do=?, loai_viec=?, hanh_dong=?, ngay_hd=?, sua_boi=?, sua_luc=? WHERE ma=?'
    ).bind(gd, t, muc, lyDo, loai, safe(hd), ngay, a.ten, t, l.ma)];
    if (gd !== l.giai_doan) sets.push(env.DB.prepare('INSERT INTO stage_history(ma,tu,den,luc,boi,ghi_chu) VALUES(?,?,?,?,?,?)').bind(l.ma, l.giai_doan, gd, t, a.ten, safe(ghiChu || lyDo)));
    if (moiLink && moiLink !== cuLink) sets.push(env.DB.prepare('UPDATE leads SET link_proposal=? WHERE ma=?').bind(moiLink, l.ma),
      logStmt(env, a.username, 'SUA_NHANH', l.ma, `Link Proposal: ${cuLink || '(trống)'} → ${moiLink}`));
    sets.push(...stmtHoSo(env, a, 'leads', l.ma, l, hs.moi));
    let maHD = '';
    if (gd === 'Đã ký' && l.giai_doan !== 'Đã ký' && !(await env.DB.prepare('SELECT 1 FROM contracts WHERE lead_ma = ?').bind(l.ma).first())) {
      if (a.role === 'QLDA') return fail('Chỉ Sale hoặc Admin được chuyển lead sang Đã ký (cần tạo hợp đồng).');
      if (!d.hopDong || typeof d.hopDong !== 'object') return fail('Chuyển sang Đã ký phải tạo hợp đồng ngay: nhập loại, ngày ký, giá trị, kiểu thanh toán.');
      const r = await chuanBiHD(env, a, { ...d.hopDong, sale: a.role === 'Sale' ? a.ten : (d.hopDong.sale || l.sale) }, { ...l, ...hs.moi }); if (r.err) return fail(r.err);
      sets.push(...r.stmts); maHD = r.ma;
    }
    sets.push(logStmt(env, a.username, 'DOI_GIAI_DOAN', l.ma, `${l.giai_doan} -> ${gd}`));
    await env.DB.batch(sets);
    return { ok: true, hopDong: maHD };
  },

  async capNhatSdt(env, req, a, d) {
    const dm = await catalog(env);
    const sdt = normPhone(d.sdt), cach = tenCach(String(d.cachSdt || ''));
    if (!sdt) return fail('SĐT không hợp lệ (10 hoặc 11 số, bắt đầu bằng 0).');
    if (!dm.cachSdt.includes(cach)) return fail('Chọn cách có SĐT: Khách cho hay Tự tìm.');
    const l = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    if (a.role === 'Sale' && l.sale !== a.ten) return fail('Lead này không thuộc Sale của bạn.');
    const dup = await findDup(env, sdt, '', l.ma); if (dup) return fail(dup);
    const t = now(), had = !!l.sdt;
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE leads SET sdt=?, cach_sdt=?, uu_tien=MAX(uu_tien,1), ngay_co_sdt=?, sua_boi=?, sua_luc=? WHERE ma=?').bind(sdt, cach, had ? l.ngay_co_sdt : t, a.ten, t, l.ma),
        logStmt(env, a.username, 'CAP_NHAT_SDT', l.ma, (had ? 'doi SDT' : 'them SDT') + ' | ' + cach),
      ]);
    } catch (err) { if (/UNIQUE/i.test(String(err))) return fail('SĐT này đã có ở lead khác.'); throw err; }
    return { ok: true, uuTien: true };
  },

  async chuyenSale(env, req, a, d) {
    const dm = await catalog(env), moi = String(d.saleMoi || ''), ly = String(d.lyDo || '').trim();
    if (!dm.sale.includes(moi)) return fail('Chọn Sale từ danh sách.');
    if (ly.length > 300) return fail('Lý do tối đa 300 ký tự.');
    const l = await env.DB.prepare('SELECT ma, sale FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    if (l.sale === moi) return fail('Lead đã thuộc Sale này.');
    const t = now();
    await env.DB.batch([
      env.DB.prepare('UPDATE leads SET sale=?, sua_boi=?, sua_luc=? WHERE ma=?').bind(moi, a.ten, t, l.ma),
      logStmt(env, a.username, 'CHUYEN_SALE', l.ma, `${l.sale} -> ${moi}${ly ? ' | ' + safe(ly) : ''}`),
    ]);
    return { ok: true };
  },

  // Đổi nhanh một trường ngay trên danh sách lead.
  async suaNhanh(env, req, a, d) {
    const truong = String(d.truong || ''), v = String(d.giaTri ?? '').trim();
    const l = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    if (a.role === 'Sale' && l.sale !== a.ten) return fail('Lead này không thuộc Sale của bạn.');
    const dm = await catalog(env);
    let cot, nhan, moi = v, cu;
    if (truong === 'sao') {
      const nen = l.sdt ? 1 : 0, n = v === '' ? NaN : Number(v);
      if (!(n === nen || n === 2 || n === 3)) return fail(l.sdt ? 'Lead đã có SĐT: chọn 1, 2 hoặc 3 sao.' : 'Lead chưa có SĐT: chọn 0, 2 hoặc 3 sao.');
      cot = 'uu_tien'; nhan = 'Số sao'; moi = n; cu = soSao(l);
    } else if (truong === 'mucTiemNang') {
      if (v !== 'Chưa phân loại' && !dm.mucTiemNang.includes(v)) return fail('Mức tiềm năng không hợp lệ.');
      cot = 'muc_tiem_nang'; nhan = 'Mức tiềm năng'; cu = l.muc_tiem_nang;
    } else if (truong === 'nguon') {
      if (!dm.nguon.includes(v)) return fail('Chọn nguồn từ danh sách.');
      if (!l.sdt && !(dm.nguonLink.includes(v) && l.link)) return fail('Nguồn này cần SĐT của khách (nguồn ad/hội nhóm thì cần SĐT hoặc link).');
      cot = 'nguon'; nhan = 'Nguồn'; cu = l.nguon;
    } else if (truong === 'cachSdt') {
      moi = tenCach(v);
      if (!l.sdt) return fail('Lead chưa có SĐT.');
      if (!dm.cachSdt.includes(moi)) return fail('Chọn cách có SĐT: Khách cho hay Tự tìm.');
      cot = 'cach_sdt'; nhan = 'Cách có SĐT'; cu = tenCach(l.cach_sdt);
    } else if (truong === 'loaiViec') {
      if (CLOSED.includes(l.giai_doan)) return fail('Lead đã đóng, không có việc tiếp theo.');
      if (!dm.loaiViec.includes(v)) return fail('Chọn loại việc tiếp theo.');
      cot = 'loai_viec'; nhan = 'Loại việc tiếp theo'; cu = l.loai_viec;
    } else if (truong === 'linkProposal') {
      if (!linkHopLe(v)) return fail(LOI_LINK);
      cot = 'link_proposal'; nhan = 'Link Proposal'; cu = l.link_proposal || '';
    } else return fail('Không đổi được trường này.');
    if (moi === cu) return { ok: true };
    await env.DB.batch([
      env.DB.prepare(`UPDATE leads SET ${cot}=?, sua_boi=?, sua_luc=? WHERE ma=?`).bind(moi, a.ten, now(), l.ma),
      logStmt(env, a.username, 'SUA_NHANH', l.ma, `${nhan}: ${cu === '' || cu == null ? '(trống)' : cu} → ${moi}`),
    ]);
    return { ok: true };
  },

  // Nhập QLDA và link Brief cho lead, hoặc cho hợp đồng (gửi maHD). Hợp đồng có lead gốc thì lưu ở lead.
  async ghiHoSo(env, req, a, d) {
    let bang = 'leads', cu;
    if (d.maHD) {
      const c = await env.DB.prepare('SELECT * FROM contracts WHERE ma = ?').bind(String(d.maHD)).first();
      if (!c || (a.role === 'Sale' && c.sale !== a.ten)) return fail('Không tìm thấy hợp đồng.');
      cu = c.lead_ma ? await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(c.lead_ma).first() : null;
      if (!cu) { cu = c; bang = 'contracts'; }
    } else {
      cu = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
      if (!cu) return fail('Không tìm thấy lead.');
      if (a.role === 'Sale' && cu.sale !== a.ten) return fail('Lead này không thuộc Sale của bạn.');
      if (CHUA_HO_SO.includes(cu.giai_doan)) return fail('Nhập QLDA và link Brief từ giai đoạn Khách chờ Proposal.');
    }
    if (a.role === 'QLDA') return fail(LOI_QUYEN_HS);
    const hs = doiHoSo(await catalog(env), d, cu); if (hs.loi) return fail(hs.loi);
    const st = stmtHoSo(env, a, bang, cu.ma, cu, hs.moi);
    if (st.length) await env.DB.batch(st);
    return { ok: true };
  },

  // Ý kiến khách trước ký: mỗi lần ghi là một dòng lịch sử, không sửa đè.
  async ghiYKien(env, req, a, d) {
    const l = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    if (a.role === 'QLDA') return fail('Chỉ Sale phụ trách hoặc Admin được ghi ý kiến khách.');
    if (a.role === 'Sale' && l.sale !== a.ten) return fail('Lead này không thuộc Sale của bạn.');
    if (!GD_Y_KIEN.includes(l.giai_doan)) return fail('Chỉ ghi ý kiến khi lead ở giai đoạn Đã gửi Proposal hoặc Đàm phán.');
    const dm = await catalog(env), chon = Array.isArray(d.muc) ? d.muc.map(String) : [];
    if (!chon.length) return fail('Chọn ít nhất một điều khách lăn tăn.');
    if (chon.some((x) => !dm.lanTan.includes(x))) return fail('Mục lăn tăn không có trong danh sách.');
    const muc = dm.lanTan.filter((x) => chon.includes(x)), gc = String(d.ghiChu || '').trim();
    if (gc.length > 300) return fail('Ghi chú tối đa 300 ký tự.');
    if (muc.includes('Khác') && !gc) return fail('Chọn "Khác" thì ghi rõ khách lăn tăn điều gì.');
    const t = now(), ngay = homNayVN();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO y_kien(lead_ma,ngay,giai_doan,muc,ghi_chu,boi,luc) VALUES(?,?,?,?,?,?,?)').bind(l.ma, ngay, l.giai_doan, JSON.stringify(muc), safe(gc), a.ten, t),
      env.DB.prepare('UPDATE leads SET sua_boi=?, sua_luc=? WHERE ma=?').bind(a.ten, t, l.ma),
      logStmt(env, a.username, 'Y_KIEN', l.ma, muc.join(', ')),
    ]);
    return { ok: true, yKien: { ngay, giaiDoan: l.giai_doan, muc, ghiChu: safe(gc), boi: a.ten } };
  },

  async lichSu(env, req, a, d) {
    const { results } = await env.DB.prepare('SELECT tu, den, luc, boi, ghi_chu FROM stage_history WHERE ma = ? ORDER BY id').bind(String(d.ma || '')).all();
    return { ok: true, ls: results };
  },


  async chiTietLead(env, req, a, d) {
    const l = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    const hist = (await env.DB.prepare('SELECT tu, den, luc, boi, ghi_chu FROM stage_history WHERE ma = ? ORDER BY id').bind(l.ma).all()).results;
    const act = (await env.DB.prepare("SELECT luc, usr, action, detail FROM audit WHERE obj = ? AND action IN ('THEM_LEAD','CAP_NHAT_SDT','CHUYEN_SALE','SUA_NHANH') ORDER BY id").bind(l.ma).all()).results;
    const ten = {}; for (const u of (await env.DB.prepare('SELECT username, ten FROM users').all()).results) ten[u.username] = u.ten;
    const ev = [];
    if (!act.some((x) => x.action === 'THEM_LEAD')) ev.push({ luc: l.tao_luc, loai: 'Tạo lead', noiDung: 'Nguồn ' + l.nguon + ', Sale ' + l.sale, boi: '' });
    for (const x of act) ev.push({ luc: x.luc, loai: x.action === 'THEM_LEAD' ? 'Tạo lead' : x.action === 'CHUYEN_SALE' ? 'Chuyển Sale' : x.action === 'SUA_NHANH' ? 'Sửa thông tin' : 'SĐT', noiDung: x.detail.replace(/co SDT/g, 'có SĐT').replace(/chua co SDT/g, 'chưa có SĐT').replace(/doi SDT/g, 'đổi SĐT').replace(/them SDT, len uu tien/g, 'thêm SĐT, lên diện ưu tiên').replace(/them SDT/g, 'thêm SĐT'), boi: ten[x.usr] || x.usr });
    for (const h of hist) ev.push({ luc: h.luc, loai: 'Đổi giai đoạn', noiDung: h.tu + ' → ' + h.den + (h.ghi_chu ? ' (' + h.ghi_chu + ')' : ''), boi: h.boi });
    ev.sort((x, y) => y.luc - x.luc);
    const yKien = (await env.DB.prepare('SELECT ngay, giai_doan, muc, ghi_chu, boi FROM y_kien WHERE lead_ma = ? ORDER BY id DESC').bind(l.ma).all()).results.map(ykOut);
    return { ok: true, yKien, lead: { ...leadOut(l), ngayCoSdt: l.ngay_co_sdt, taoLuc: l.tao_luc, suaBoi: l.sua_boi, suaLuc: l.sua_luc }, ev };
  },

  async baoCao(env, req, a, d) {
    const b = bkk(); const cur = String(b.getUTCFullYear()) + '-' + ('0' + (b.getUTCMonth() + 1)).slice(-2);
    const th = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.thang || '')) ? String(d.thang) : cur;
    const range = (m) => { const [y, mo] = m.split('-').map(Number); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      return { t: m + '-01', e: m + '-' + ('0' + last).slice(-2), ms: Date.UTC(y, mo - 1, 1) - 7 * 3600000, me: Date.UTC(y, mo, 1) - 7 * 3600000 }; };
    const prevM = (() => { const [y, mo] = th.split('-').map(Number); const p = new Date(Date.UTC(y, mo - 2, 1)); return p.getUTCFullYear() + '-' + ('0' + (p.getUTCMonth() + 1)).slice(-2); })();
    const dm = await catalog(env);
    const stat = async (m) => { const r = range(m);
      const [n, k] = await env.DB.batch([
        env.DB.prepare('SELECT COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ?').bind(r.t, r.e),
        env.DB.prepare("SELECT COUNT(DISTINCT ma) AS c FROM stage_history WHERE den = 'Đã ký' AND luc >= ? AND luc < ?").bind(r.ms, r.me)]);
      const nhan = n.results[0].c, ky = k.results[0].c; return { nhan, ky, tyLeKy: nhan ? ky / nhan : null }; };
    const R = range(th), today = bkk().toISOString().slice(0, 10);
    const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);
    const ph = CLOSED.map(() => '?').join(',');
    const [gd, ng, sl, ky, mo, qh, ld, cs, tong] = await env.DB.batch([
      q('SELECT giai_doan AS k, COUNT(*) AS c FROM leads GROUP BY giai_doan'),
      q('SELECT nguon AS k, COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY nguon', R.t, R.e),
      q('SELECT sale AS k, COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY sale', R.t, R.e),
      q("SELECT l.sale AS k, COUNT(DISTINCT h.ma) AS c FROM stage_history h JOIN leads l ON l.ma = h.ma WHERE h.den = 'Đã ký' AND h.luc >= ? AND h.luc < ? GROUP BY l.sale", R.ms, R.me),
      q(`SELECT sale AS k, COUNT(*) AS c FROM leads WHERE giai_doan NOT IN (${ph}) GROUP BY sale`, ...CLOSED),
      q(`SELECT ma, ten, sale, giai_doan, loai_viec, hanh_dong, ngay_hd FROM leads WHERE giai_doan NOT IN (${ph}) AND ngay_hd <> '' AND ngay_hd < ? ORDER BY ngay_hd LIMIT 50`, ...CLOSED, today),
      q("SELECT ly_do AS k, COUNT(*) AS c FROM leads WHERE giai_doan IN ('Mất','Không tiềm năng') AND ngay_doi_gd >= ? AND ngay_doi_gd < ? GROUP BY ly_do", R.ms, R.me),
      q("SELECT CASE WHEN sdt = '' THEN 'Chưa có SĐT' WHEN cach_sdt = 'Mình tự tìm' THEN 'Tự tìm' ELSE cach_sdt END AS k, COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY 1", R.t, R.e),
      q(`SELECT COUNT(*) AS c FROM leads WHERE giai_doan NOT IN (${ph})`, ...CLOSED),
    ]);
    const map = (x) => Object.fromEntries(x.results.map((r) => [r.k || '(chưa ghi)', r.c]));
    const gdM = map(gd), ngM = map(ng), slN = map(sl), slK = map(ky), slO = map(mo);
    const quaHan = qh.results, qhBySale = {}; for (const r of quaHan) qhBySale[r.sale] = (qhBySale[r.sale] || 0) + 1;
    const theoSale = dm.sale.map((s) => ({ sale: s, nhan: slN[s] || 0, ky: slK[s] || 0, tyLeKy: slN[s] ? (slK[s] || 0) / slN[s] : null, dangMo: slO[s] || 0, quaHan: qhBySale[s] || 0 }));
    return { ok: true, thang: th, thangTruoc: prevM, thangNay: await stat(th), truoc: await stat(prevM), dangMo: tong.results[0].c,
      theoGiaiDoan: dm.giaiDoan.map((k) => ({ k, c: gdM[k] || 0 })), theoNguon: dm.nguon.map((k) => ({ k, c: ngM[k] || 0 })), theoSale,
      lyDo: Object.entries(map(ld)).map(([k, c]) => ({ k, c })), cachSdt: Object.entries(map(cs)).map(([k, c]) => ({ k, c })), quaHan, homNay: today };
  },

  async thongKe(env, req, a, d) {
    // Dashboard lead theo ngay / tuan (T2-CN) / thang, gio Viet Nam. Ky tinh theo thoi diem doi sang "Da ky".
    const kieu = ['ngay', 'tuan', 'thang'].includes(d.kieu) ? d.kieu : 'tuan';
    const today = bkk().toISOString().slice(0, 10);
    const A = /^\d{4}-\d{2}-\d{2}$/.test(String(d.den || '')) && !isNaN(Date.parse(d.den + 'T00:00:00Z')) ? String(d.den) : today;
    const iso = (t) => new Date(t).toISOString().slice(0, 10), U = (s) => Date.parse(s + 'T00:00:00Z'), DAY = 86400000;
    const per = (anchor) => { const t0 = U(anchor);
      if (kieu === 'ngay') return { t: anchor, e: anchor };
      if (kieu === 'tuan') { const dow = (new Date(t0).getUTCDay() + 6) % 7; return { t: iso(t0 - dow * DAY), e: iso(t0 - dow * DAY + 6 * DAY) }; }
      const x = new Date(t0); return { t: iso(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1)), e: iso(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)) }; };
    const prevOf = (p) => { const t0 = U(p.t);
      if (kieu === 'ngay') return per(iso(t0 - DAY)); if (kieu === 'tuan') return per(iso(t0 - 7 * DAY));
      return per(iso(t0 - DAY)); };
    const cur = per(A); const bk = [cur]; const nB = kieu === 'ngay' ? 14 : 12;
    while (bk.length < nB) bk.unshift(prevOf(bk[0]));
    const lab = (p) => kieu === 'ngay' ? p.t.slice(8) + '/' + p.t.slice(5, 7) : kieu === 'tuan' ? p.t.slice(8) + '/' + p.t.slice(5, 7) : p.t.slice(5, 7) + '/' + p.t.slice(2, 4);
    const T0 = bk[0].t, T1 = bk[bk.length - 1].e, ms0 = U(T0) - 7 * 3600000, ms1 = U(T1) + DAY - 7 * 3600000;
    const R = cur, P = bk[bk.length - 2], msR = [U(R.t) - 7 * 3600000, U(R.e) + DAY - 7 * 3600000];
    const q = (sql, ...b) => env.DB.prepare(sql).bind(...b), ph = CLOSED.map(() => '?').join(',');
    const [nd, sd, kd, gd, reach, ng, slc, slo, ld, mt, qh, hot, dm0] = await env.DB.batch([
      q('SELECT ngay_nhan AS d, COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY ngay_nhan', T0, T1),
      q("SELECT date(ngay_co_sdt/1000 + 25200, 'unixepoch') AS d, COUNT(*) AS c FROM leads WHERE ngay_co_sdt >= ? AND ngay_co_sdt < ? GROUP BY d", ms0, ms1),
      q("SELECT date(luc/1000 + 25200, 'unixepoch') AS d, COUNT(DISTINCT ma) AS c FROM stage_history WHERE den = 'Đã ký' AND luc >= ? AND luc < ? GROUP BY d", ms0, ms1),
      q('SELECT giai_doan AS k, COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY giai_doan', R.t, R.e),
      q('SELECT h.den AS k, COUNT(DISTINCT h.ma) AS c FROM stage_history h JOIN leads l ON l.ma = h.ma WHERE l.ngay_nhan >= ? AND l.ngay_nhan <= ? GROUP BY h.den', R.t, R.e),
      q("SELECT nguon AS k, COUNT(*) AS nhan, SUM(sdt <> '') AS sdt, SUM(giai_doan = 'Đã ký') AS ky, SUM(giai_doan IN ('Mất','Không tiềm năng')) AS dong FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY nguon", R.t, R.e),
      q("SELECT sale AS k, COUNT(*) AS nhan, SUM(sdt <> '') AS sdt, SUM(giai_doan = 'Đã ký') AS ky FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY sale", R.t, R.e),
      q(`SELECT sale AS k, SUM(giai_doan NOT IN (${ph})) AS mo, SUM(giai_doan NOT IN (${ph}) AND ngay_hd <> '' AND ngay_hd < ?) AS qh, SUM(giai_doan NOT IN (${ph}) AND ngay_hd = '') AS kv FROM leads GROUP BY sale`, ...CLOSED, ...CLOSED, today, ...CLOSED),
      q("SELECT ly_do AS k, COUNT(*) AS c FROM leads WHERE giai_doan IN ('Mất','Không tiềm năng') AND ngay_doi_gd >= ? AND ngay_doi_gd < ? GROUP BY ly_do", msR[0], msR[1]),
      q('SELECT muc_tiem_nang AS k, COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY muc_tiem_nang', R.t, R.e),
      q(`SELECT ma, ten, sale, giai_doan, loai_viec, hanh_dong, ngay_hd FROM leads WHERE giai_doan NOT IN (${ph}) AND ngay_hd <> '' AND ngay_hd < ? ORDER BY ngay_hd LIMIT 30`, ...CLOSED, today),
      q(`SELECT ma, ten, sale, giai_doan, ${SQL_SAO} AS uu_tien, ngay_hd FROM leads WHERE giai_doan NOT IN (${ph}) AND muc_tiem_nang = 'Tiềm năng' ORDER BY ${SQL_SAO} DESC, tao_luc DESC LIMIT 10`, ...CLOSED),
      q(`SELECT COUNT(*) AS c FROM leads WHERE giai_doan NOT IN (${ph})`, ...CLOSED),
    ]);
    const mp = (x) => Object.fromEntries(x.results.map((r) => [r.d, r.c]));
    const N = mp(nd), S = mp(sd), K = mp(kd);
    const sum = (m, p) => { let t = 0; for (let x = U(p.t); x <= U(p.e); x += DAY) t += m[iso(x)] || 0; return t; };
    const xuong = bk.map((p) => ({ nhan: sum(N, p), sdt: sum(S, p), ky: sum(K, p), nhan_l: lab(p), t: p.t, e: p.e }));
    const C = xuong[xuong.length - 1], Pv = xuong[xuong.length - 2];
    const dmc = await catalog(env);
    const gdM = Object.fromEntries(gd.results.map((r) => [r.k, r.c])), rcM = Object.fromEntries(reach.results.map((r) => [r.k, r.c]));
    const ngM = Object.fromEntries(ng.results.map((r) => [r.k, r])), slcM = Object.fromEntries(slc.results.map((r) => [r.k, r])), sloM = Object.fromEntries(slo.results.map((r) => [r.k, r]));
    const nguon = dmc.nguon.map((k) => ({ k, nhan: ngM[k]?.nhan || 0, sdt: ngM[k]?.sdt || 0, ky: ngM[k]?.ky || 0, dong: ngM[k]?.dong || 0 }));
    const sale = dmc.sale.map((k) => ({ k, nhan: slcM[k]?.nhan || 0, sdt: slcM[k]?.sdt || 0, ky: slcM[k]?.ky || 0, mo: sloM[k]?.mo || 0, quaHan: sloM[k]?.qh || 0, khongViec: sloM[k]?.kv || 0 }));
    const giaiDoan = dmc.giaiDoan.map((k) => ({ k, c: gdM[k] || 0, daTung: rcM[k] || 0 }));
    const lyDo = ld.results.map((r) => ({ k: r.k || '(chưa ghi)', c: r.c })).sort((x, y) => y.c - x.c);
    const mucTn = mt.results.map((r) => ({ k: r.k, c: r.c }));
    const tongMo = dm0.results[0].c, khongViec = sale.reduce((s, x) => s + x.khongViec, 0), quaHanN = sale.reduce((s, x) => s + x.quaHan, 0);
    // ---- nhan xet tu dong theo quy tac (khong dung AI ngoai) ----
    const nx = [], add = (loai, text) => nx.push({ loai, text });
    const pc = (x) => Math.round(x * 100) + '%', ten = { ngay: 'hôm trước', tuan: 'tuần trước', thang: 'tháng trước' }[kieu];
    if (C.nhan === 0 && Pv.nhan === 0) add('canh_bao', 'Chưa có lead nhận trong kỳ này lẫn ' + ten + ' (xem lại kênh khai thác hoặc chọn kỳ khác).');
    else { const df = C.nhan - Pv.nhan; add(df >= 0 ? 'tot' : 'canh_bao', `Lead nhận: ${C.nhan} (${df >= 0 ? '+' : ''}${df} so với ${ten}${Pv.nhan ? ', ' + (df >= 0 ? '+' : '') + pc(df / Pv.nhan) : ''}).`); }
    if (C.nhan >= 5) { const r = C.sdt / C.nhan; if (r < 0.4) add('canh_bao', `Chỉ ${pc(r)} lead có SĐT (${C.sdt}/${C.nhan}). SĐT là điều kiện để chăm sóc nhanh: ưu tiên xin/tra SĐT ngay khi nhận lead.`); else add('tot', `${pc(r)} lead có SĐT (${C.sdt}/${C.nhan}).`); }
    const tn = nguon.filter((x) => x.nhan >= 5).sort((x, y) => y.sdt / y.nhan - x.sdt / x.nhan);
    if (tn.length >= 2) add('goi_y', `Nguồn ra SĐT tốt nhất: ${tn[0].k} (${pc(tn[0].sdt / tn[0].nhan)}); kém nhất: ${tn[tn.length - 1].k} (${pc(tn[tn.length - 1].sdt / tn[tn.length - 1].nhan)}). Cân nhắc dồn công sức vào nguồn tốt.`);
    if (C.ky > 0) add('tot', `Đã ký ${C.ky} lead trong kỳ${Pv.ky ? ' (kỳ trước ' + Pv.ky + ')' : ''}.`); else if (C.nhan >= 10) add('canh_bao', 'Chưa có lead nào chuyển sang Đã ký trong kỳ.');
    if (quaHanN > 0) { const w = [...sale].sort((x, y) => y.quaHan - x.quaHan)[0]; add('canh_bao', `${quaHanN} lead có việc quá hạn; nhiều nhất ở ${w.k} (${w.quaHan}). Xử lý trước khi nhận thêm lead.`); }
    if (khongViec > 0) add('goi_y', `${khongViec}/${tongMo} lead đang mở chưa có việc tiếp theo/ngày hạn. Nên đặt lịch việc tiếp theo để hệ thống nhắc quá hạn được.`);
    const mo = sale.filter((x) => x.mo > 0).sort((x, y) => y.mo - x.mo);
    if (mo.length >= 2 && mo[0].mo >= 2 * mo[mo.length - 1].mo && mo[0].mo - mo[mo.length - 1].mo >= 10) add('goi_y', `Tải lead không đều: ${mo[0].k} đang giữ ${mo[0].mo} lead mở, ${mo[mo.length - 1].k} chỉ ${mo[mo.length - 1].mo}. Cân nhắc chuyển bớt (nút Chuyển Sale).`);
    if (lyDo.length) add('goi_y', `Lý do mất/không tiềm năng nhiều nhất trong kỳ: ${lyDo[0].k} (${lyDo[0].c}).`);
    const bu = giaiDoan.filter((x) => x.c > 0); const hanhTrinh = ['Mới', 'Đã liên hệ', 'Hẹn tư vấn', 'Khách chờ Proposal', 'Đã gửi Proposal', 'Đàm phán', 'Đã ký'];
    if (C.nhan >= 10 && (gdM['Mới'] || 0) / C.nhan > 0.6) add('canh_bao', `${pc((gdM['Mới'] || 0) / C.nhan)} lead nhận trong kỳ vẫn ở giai đoạn Mới: cần liên hệ sớm hơn.`);
    const hot2 = hot.results.length; if (hot2) add('goi_y', `${hot2} lead mức "Tiềm năng" đang mở (xem danh sách ưu tiên bên dưới).`);
    // Điều khách lăn tăn: toàn bộ thời gian, đếm theo lead (một lead ghi nhiều lần cùng mục chỉ tính một).
    const [ykR, dsGd] = await env.DB.batch([
      q('SELECT y.lead_ma, y.muc, l.giai_doan FROM y_kien y JOIN leads l ON l.ma = y.lead_ma'),
      q('SELECT COUNT(*) AS c, SUM(ma IN (SELECT lead_ma FROM y_kien)) AS co FROM leads WHERE giai_doan IN (?,?)', ...GD_Y_KIEN),
    ]);
    const theoMuc = {}; for (const r of ykR.results) for (const m of docMuc(r.muc)) (theoMuc[m] = theoMuc[m] || {})[r.lead_ma] = r.giai_doan;
    const lanTan = dmc.lanTan.map((k) => { const g = Object.values(theoMuc[k] || {}), ky = g.filter((x) => x === 'Đã ký').length, mat = g.filter((x) => LOSS.includes(x)).length;
      return { k, so: g.length, ky, mat, mo: g.length - ky - mat }; });
    const hoi = { dang: dsGd.results[0].c, coGhi: dsGd.results[0].co || 0, tongLead: new Set(ykR.results.map((r) => r.lead_ma)).size };
    return { ok: true, lanTan, hoiYKien: hoi, kieu, den: A, ky: { t: R.t, e: R.e }, kyTruoc: { t: P.t, e: P.e }, homNay: today, xuHuong: xuong, tong: C, truoc: Pv, tongMo, khongViec, quaHanN,
      giaiDoan, nguon, sale, lyDo, mucTiemNang: mucTn, quaHan: qh.results, uuTien: hot.results, nhanXet: nx };
  },

  // ---- hop dong / doanh thu ----
  async taoHopDong(env, req, a, d) {
    if (a.role === 'QLDA') return fail('Chỉ Sale hoặc Admin được tạo hợp đồng.');
    let lead = null;
    if (d.leadMa) {
      lead = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.leadMa)).first();
      if (!lead) return fail('Không tìm thấy lead.');
      if (await env.DB.prepare('SELECT 1 FROM contracts WHERE lead_ma = ?').bind(lead.ma).first()) return fail('Lead này đã có hợp đồng.');
    }
    const r = await chuanBiHD(env, a, d, lead); if (r.err) return fail(r.err);
    await env.DB.batch(r.stmts);
    return { ok: true, ma: r.ma };
  },

  async danhSachHopDong(env, req, a) {
    const sale = a.role === 'Sale';
    const q = env.DB.prepare('SELECT * FROM contracts' + hdVisible(a) + ' ORDER BY ngay_ky DESC, ma DESC'); const rows = (sale ? await q.bind(a.ten).all() : await q.all()).results;
    const ds = await phanTichHD(env, rows);
    const q2 = env.DB.prepare("SELECT ma, ten, sale, qlda, link_brief, ngay_doi_gd FROM leads WHERE giai_doan = 'Đã ký' AND ma NOT IN (SELECT lead_ma FROM contracts WHERE lead_ma <> '')" + (sale ? ' AND sale = ?' : '') + ' ORDER BY ngay_doi_gd DESC');
    const thieu = (sale ? await q2.bind(a.ten).all() : await q2.all()).results;
    return { ok: true, hd: ds.map(hdOut), thieuHD: thieu.map((x) => ({ ma: x.ma, ten: x.ten, sale: x.sale, qlda: x.qlda, linkBrief: x.link_brief })), canhBao: canhBaoHD(ds), homNay: homNayVN() };
  },

  async chiTietHopDong(env, req, a, d) {
    const c = await env.DB.prepare('SELECT * FROM contracts WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!c || (a.role === 'Sale' && c.sale !== a.ten)) return fail('Không tìm thấy hợp đồng.');
    const [p] = await phanTichHD(env, [c]);
    const [thu, tt] = await env.DB.batch([
      env.DB.prepare('SELECT id, ngay, so_tien, ghi_chu, boi, luc FROM thu_tien WHERE hd_ma = ? ORDER BY ngay, id').bind(c.ma),
      env.DB.prepare('SELECT id, ngay, loai, so_luong, noi_dung, boi, luc FROM thuc_thi WHERE hd_ma = ? ORDER BY ngay DESC, id DESC').bind(c.ma),
    ]);
    return { ok: true, hd: hdOut(p), thu: thu.results, thucThi: tt.results, canhBao: canhBaoHD([p]), loaiThucThi: LOAI_TT };
  },

  async ghiThuTien(env, req, a, d) {
    const c = await env.DB.prepare('SELECT * FROM contracts WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!c) return fail('Không tìm thấy hợp đồng.');
    const so = Number(d.soTien), ngay = String(d.ngay || homNayVN()), gc = String(d.ghiChu || '').trim();
    if (!Number.isFinite(so) || so <= 0) return fail('Số tiền phải lớn hơn 0.');
    if (!validDate(ngay)) return fail('Ngày thu không hợp lệ.');
    if (gc.length > 300) return fail('Ghi chú tối đa 300 ký tự.');
    const da = tien((await env.DB.prepare('SELECT SUM(so_tien) AS s FROM thu_tien WHERE hd_ma = ?').bind(c.ma).first()).s);
    if (da + Math.round(so) > c.gia_tri) return fail(`Vượt giá trị hợp đồng: đã thu ${da.toLocaleString('vi-VN')} đ, còn phải thu ${(c.gia_tri - da).toLocaleString('vi-VN')} đ.`);
    const t = now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO thu_tien(hd_ma,ngay,so_tien,ghi_chu,boi,luc) VALUES(?,?,?,?,?,?)').bind(c.ma, ngay, Math.round(so), safe(gc), a.ten, t),
      env.DB.prepare('UPDATE contracts SET sua_boi=?, sua_luc=? WHERE ma=?').bind(a.ten, t, c.ma),
      logStmt(env, a.username, 'THU_TIEN', c.ma, `${Math.round(so)} | ${ngay}${gc ? ' | ' + safe(gc) : ''}`),
    ]);
    return { ok: true, conPhai: c.gia_tri - da - Math.round(so) };
  },

  async ghiThucThi(env, req, a, d) {
    if (a.role === 'Sale') return fail('Sale không ghi thực thi; nhờ QLDA hoặc Admin.');
    const c = await env.DB.prepare('SELECT ma FROM contracts WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!c) return fail('Không tìm thấy hợp đồng.');
    const loai = String(d.loai || ''), ngay = String(d.ngay || homNayVN()), nd = String(d.noiDung || '').trim(), sl = d.soLuong === '' || d.soLuong == null ? 0 : Number(d.soLuong);
    if (!LOAI_TT.includes(loai)) return fail('Chọn loại sự kiện.');
    if (!validDate(ngay)) return fail('Ngày không hợp lệ.');
    if (!Number.isInteger(sl) || sl < 0 || sl > 10000) return fail('Số lượng phải là số nguyên không âm.');
    if (loai === 'Giao sản phẩm' && sl < 1) return fail('Giao sản phẩm cần số lượng ≥ 1.');
    if (!nd) return fail('Nhập nội dung ngắn (đã làm gì).');
    if (nd.length > 500) return fail('Nội dung tối đa 500 ký tự.');
    const t = now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO thuc_thi(hd_ma,ngay,loai,so_luong,noi_dung,boi,luc) VALUES(?,?,?,?,?,?,?)').bind(c.ma, ngay, loai, loai === 'Giao sản phẩm' ? sl : 0, safe(nd), a.ten, t),
      logStmt(env, a.username, 'THUC_THI', c.ma, `${loai}${sl ? ' x' + sl : ''}`),
    ]);
    return { ok: true };
  },

  async suaHopDong(env, req, a, d) {
    const c = await env.DB.prepare('SELECT * FROM contracts WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!c) return fail('Không tìm thấy hợp đồng.');
    const e = [], n = { ...c };
    const has = (k) => d[k] !== undefined;
    if (has('khach')) { n.khach = String(d.khach).trim(); if (!n.khach || n.khach.length > 150) e.push('Tên khách bắt buộc (tối đa 150 ký tự).'); }
    if (has('trangThai')) { n.trang_thai = String(d.trangThai); if (!TT_HD.includes(n.trang_thai)) e.push('Trạng thái không hợp lệ.'); }
    if (has('ngayHet')) { n.ngay_het = String(d.ngayHet || ''); if (n.ngay_het && !validDate(n.ngay_het)) e.push('Ngày hết hạn không hợp lệ.'); }
    if (has('camKet')) { n.cam_ket = Number(d.camKet); if (!Number.isInteger(n.cam_ket) || n.cam_ket < 0) e.push('Số lượng cam kết không hợp lệ.'); }
    if (has('donVi')) n.don_vi = String(d.donVi).trim().slice(0, 30);
    if (has('ghiChu')) { n.ghi_chu = String(d.ghiChu).trim(); if (n.ghi_chu.length > 500) e.push('Ghi chú tối đa 500 ký tự.'); }
    if (has('canXacNhan')) n.can_xac_nhan = d.canXacNhan ? 1 : 0;
    if (has('sale')) { n.sale = String(d.sale).trim(); if (!(await catalog(env)).sale.includes(n.sale)) e.push('Sale không có trong danh mục.'); }
    const doiTien = has('giaTri') || has('keHoach') || has('ngayKy');
    let dots = null;
    if (doiTien) {
      if (await env.DB.prepare('SELECT 1 FROM thu_tien WHERE hd_ma = ?').bind(c.ma).first()) e.push('Hợp đồng đã có khoản thu, không đổi giá trị / kiểu thanh toán / ngày ký được.');
      else {
        n.gia_tri = has('giaTri') ? tien(d.giaTri) : c.gia_tri; n.ke_hoach = has('keHoach') ? String(d.keHoach) : c.ke_hoach; n.ngay_ky = has('ngayKy') ? String(d.ngayKy) : c.ngay_ky;
        if (!(n.gia_tri > 0)) e.push('Giá trị phải lớn hơn 0.'); if (!KE_HOACH.includes(n.ke_hoach)) e.push('Kiểu thanh toán không hợp lệ.'); if (!validDate(n.ngay_ky)) e.push('Ngày ký không hợp lệ.');
        if (n.ke_hoach === '50_50' && n.loai === 'Theo thời hạn' && n.so_thang < 3) e.push('Hợp đồng dưới 3 tháng thu 1 lần.');
        dots = n.ke_hoach === '50_50' ? [[1, 50, Math.round(n.gia_tri / 2), n.ngay_ky], [2, 50, n.gia_tri - Math.round(n.gia_tri / 2), addMonths(n.ngay_ky, 1)]] : [[1, 100, n.gia_tri, n.ngay_ky]];
      }
    }
    if (e.length) return fail(e.join(' '));
    const t = now(), st = [env.DB.prepare('UPDATE contracts SET khach=?,sale=?,ngay_ky=?,ngay_het=?,cam_ket=?,don_vi=?,gia_tri=?,ke_hoach=?,trang_thai=?,can_xac_nhan=?,ghi_chu=?,sua_boi=?,sua_luc=? WHERE ma=?')
      .bind(safe(n.khach), n.sale, n.ngay_ky, n.ngay_het, n.cam_ket, safe(n.don_vi), n.gia_tri, n.ke_hoach, n.trang_thai, n.can_xac_nhan, safe(n.ghi_chu), a.ten, t, c.ma)];
    if (dots) { st.push(env.DB.prepare('DELETE FROM dot_thu WHERE hd_ma = ?').bind(c.ma)); for (const x of dots) st.push(env.DB.prepare('INSERT INTO dot_thu(hd_ma,dot,ty_le,so_tien,han) VALUES(?,?,?,?,?)').bind(c.ma, x[0], x[1], x[2], x[3])); }
    st.push(logStmt(env, a.username, 'SUA_HOP_DONG', c.ma, Object.keys(d).filter((k) => k !== 'ma').join(',')));
    await env.DB.batch(st);
    return { ok: true };
  },

  async canhBaoHopDong(env, req, a) {
    const sale = a.role === 'Sale', q = env.DB.prepare('SELECT * FROM contracts' + hdVisible(a));
    const ds = await phanTichHD(env, (sale ? await q.bind(a.ten).all() : await q.all()).results);
    const cb = canhBaoHD(ds);
    return { ok: true, canhBao: cb, tong: cb.thu.length + cb.het.length + cb.tienDo.length + cb.imLang.length };
  },

  async doanhThu(env, req, a, d) {
    const b = bkk(), cur = b.getUTCFullYear() + '-' + ('0' + (b.getUTCMonth() + 1)).slice(-2);
    const th = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.thang || '')) ? String(d.thang) : cur;
    const prev = (m, k) => { const [y, mo] = m.split('-').map(Number); const p = new Date(Date.UTC(y, mo - 1 - k, 1)); return p.getUTCFullYear() + '-' + ('0' + (p.getUTCMonth() + 1)).slice(-2); };
    const m0 = prev(th, 11), pm = prev(th, 1);
    const all = (await env.DB.prepare('SELECT * FROM contracts').all()).results, ds = await phanTichHD(env, all);
    const live = ds.filter((c) => c.trang_thai !== 'Hủy');
    const [ky, thu, thuC] = await env.DB.batch([
      env.DB.prepare("SELECT substr(ngay_ky,1,7) AS m, COUNT(*) AS n, SUM(gia_tri) AS s FROM contracts WHERE trang_thai <> 'Hủy' AND ngay_ky >= ? AND ngay_ky <= ? GROUP BY m").bind(m0 + '-01', th + '-31'),
      env.DB.prepare('SELECT substr(ngay,1,7) AS m, SUM(so_tien) AS s FROM thu_tien WHERE ngay >= ? AND ngay <= ? GROUP BY m').bind(m0 + '-01', th + '-31'),
      env.DB.prepare("SELECT c.sale AS k, SUM(t.so_tien) AS s FROM thu_tien t JOIN contracts c ON c.ma = t.hd_ma WHERE substr(t.ngay,1,7) = ? GROUP BY c.sale").bind(th),
    ]);
    const mk = {}, mt = {}; for (const x of ky.results) mk[x.m] = x; for (const x of thu.results) mt[x.m] = x.s || 0;
    const xuHuong = []; for (let i = 11; i >= 0; i--) { const m = prev(th, i); xuHuong.push({ m, ky: tien((mk[m] || {}).s), n: (mk[m] || {}).n || 0, thu: tien(mt[m]) }); }
    const conPhaiTong = live.reduce((s, c) => s + c.conPhai, 0), quaHan = live.filter((c) => c.quaHanSo > 0 && c.trang_thai === 'Đang thực hiện');
    const bySale = {}; const g = (k) => (bySale[k] = bySale[k] || { k, ky: 0, n: 0, thu: 0, conPhai: 0 });
    for (const c of live) { const o = g(c.sale); o.conPhai += c.conPhai; if (c.ngay_ky.slice(0, 7) === th) { o.ky += c.gia_tri; o.n++; } }
    for (const x of thuC.results) g(x.k).thu = tien(x.s);
    const byLoai = {}; for (const c of live) if (c.ngay_ky.slice(0, 7) === th) { const o = (byLoai[c.loai] = byLoai[c.loai] || { k: c.loai, n: 0, ky: 0 }); o.n++; o.ky += c.gia_tri; }
    const thieu = (await env.DB.prepare("SELECT COUNT(*) AS c FROM leads WHERE giai_doan = 'Đã ký' AND ma NOT IN (SELECT lead_ma FROM contracts WHERE lead_ma <> '')").first()).c;
    const cur_ = xuHuong[11], pre_ = xuHuong[10], nx = [];
    const add = (loai, text) => nx.push({ loai, text }), vnd = (v) => tien(v).toLocaleString('vi-VN') + ' đ';
    if (pre_.thu > 0) { const dl = cur_.thu - pre_.thu; add(dl >= 0 ? 'tot' : 'canh_bao', `Thực thu tháng này ${dl >= 0 ? 'cao hơn' : 'thấp hơn'} tháng trước ${vnd(Math.abs(dl))} (${Math.round(Math.abs(dl) / pre_.thu * 100)}%).`); }
    if (cur_.ky > 0 && cur_.thu < cur_.ky * 0.5 && th === cur) add('goi_y', `Doanh số ký ${vnd(cur_.ky)} nhưng thực thu mới ${vnd(cur_.thu)}: đẩy việc thu tiền các đợt đã đến hạn.`);
    if (quaHan.length) add('canh_bao', `${quaHan.length} hợp đồng đang quá hạn thu, tổng ${vnd(quaHan.reduce((s, c) => s + c.quaHanSo, 0))}.`);
    if (thieu) add('canh_bao', `${thieu} lead đang "Đã ký" nhưng chưa có hợp đồng: bổ sung để doanh thu đầy đủ.`);
    if (conPhaiTong > 0) add('goi_y', `Còn phải thu toàn bộ hợp đồng đang chạy: ${vnd(conPhaiTong)}.`);
    const cb = canhBaoHD(live);
    return { ok: true, thang: th, thangTruoc: pm, ky: { s: cur_.ky, n: cur_.n }, kyTruoc: { s: pre_.ky, n: pre_.n }, thu: cur_.thu, thuTruoc: pre_.thu, conPhai: conPhaiTong, xuHuong,
      sale: Object.values(bySale).sort((x, y) => y.ky - x.ky), loai: Object.values(byLoai), quaHan: quaHan.map((c) => ({ ma: c.ma, khach: c.khach, sale: c.sale, soTien: c.quaHanSo })), thieuHD: thieu,
      canhBao: { thu: cb.thu.length, het: cb.het.length, tienDo: cb.tienDo.length, imLang: cb.imLang.length }, nhanXet: nx };
  },

  // ---- quan tri ----
  async saoLuu(env, req, a) {
    // Admin: xuat toan bo du lieu thanh file SQL (INSERT) de luu local. Khong gom phien dang nhap.
    const T = ['users', 'catalog', 'counters', 'leads', 'stage_history', 'audit', 'contracts', 'dot_thu', 'thu_tien', 'thuc_thi', 'y_kien'];
    const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
    const out = ['-- Dat Cang Sale - ban sao luu ' + new Date().toISOString(), '-- Khoi phuc: chay file nay tren D1 trong sau khi chay migrations (bang rong). CHUA PII khach + mat khau da bam.'];
    const dem = {};
    out.push('DELETE FROM catalog; -- migrations da nap danh muc mac dinh; xoa de nap lai dung ban sao luu');
    for (const t of T) {
      const { results } = await env.DB.prepare('SELECT * FROM ' + t).all();
      dem[t] = results.length;
      for (const r of results) { const k = Object.keys(r); out.push('INSERT INTO ' + t + '(' + k.join(',') + ') VALUES(' + k.map(c => q(r[c])).join(',') + ');'); }
    }
    await env.DB.batch([logStmt(env, a.username, 'SAO_LUU', '', JSON.stringify(dem))]);
    return { ok: true, sql: out.join('\n') + '\n', dem };
  },
  async danhSachTaiKhoan(env) {
    const { results } = await env.DB.prepare('SELECT username, ten, role, active, must_change, locked_until FROM users ORDER BY role, username').all();
    return { ok: true, users: results };
  },
  async taoTaiKhoan(env, req, a, d) {
    const un = String(d.username || '').trim().toLowerCase(), ten = String(d.ten || '').trim(), role = String(d.role || '');
    if (!/^[a-z0-9_.]{3,30}$/.test(un)) return fail('Tên đăng nhập 3-30 ký tự: chữ thường, số, _ hoặc .');
    if (!ten || ten.length > 100) return fail('Họ tên bắt buộc.');
    if (!ROLES.includes(role)) return fail('Vai trò không hợp lệ.');
    if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(un).first()) return fail('Tên đăng nhập đã tồn tại.');
    const pw = randPass(), salt = b64url(rnd(16));
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users(username,ten,role,salt,hash,iters,must_change) VALUES(?,?,?,?,?,?,1)').bind(un, safe(ten), role, salt, await pbkdf2(pw, salt, PBKDF2_ITERS), PBKDF2_ITERS),
      logStmt(env, a.username, 'TAO_TAI_KHOAN', un, role),
    ]);
    return { ok: true, matKhauTam: pw };
  },
  async datLaiMatKhau(env, req, a, d) {
    const un = String(d.username || '').trim().toLowerCase();
    if (!(await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(un).first())) return fail('Không có tài khoản này.');
    const pw = randPass(), salt = b64url(rnd(16));
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET salt=?, hash=?, iters=?, must_change=1, fails=0, locked_until=0 WHERE username=?').bind(salt, await pbkdf2(pw, salt, PBKDF2_ITERS), PBKDF2_ITERS, un),
      env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(un),
      logStmt(env, a.username, 'DAT_LAI_MAT_KHAU', un, ''),
    ]);
    return { ok: true, matKhauTam: pw };
  },
  async tatTaiKhoan(env, req, a, d) {
    const un = String(d.username || '').trim().toLowerCase(), on = d.bat ? 1 : 0;
    if (un === a.username) return fail('Không thể tự tắt tài khoản của chính mình.');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET active = ? WHERE username = ?').bind(on, un),
      env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(un),
      logStmt(env, a.username, on ? 'BAT_TAI_KHOAN' : 'TAT_TAI_KHOAN', un, ''),
    ]);
    return { ok: true };
  },
};

// quyen: 'public' = khong can dang nhap; 'auth' = da dang nhap (ke ca dang bat buoc doi MK); 'use' = da doi MK; 'admin'
const PERM = {
  login: 'public', phien: 'public', logout: 'public', doiMatKhau: 'auth', layDanhMuc: 'use',
  themLead: 'use', danhSachLead: 'use', doiGiaiDoan: 'use', capNhatSdt: 'use', suaNhanh: 'use', ghiHoSo: 'use', ghiYKien: 'use', chuyenSale: 'use', lichSu: 'use', chiTietLead: 'use', baoCao: 'use', thongKe: 'use',
  taoHopDong: 'use', danhSachHopDong: 'use', chiTietHopDong: 'use', ghiThucThi: 'use', canhBaoHopDong: 'use', ghiThuTien: 'admin', suaHopDong: 'admin', doanhThu: 'admin',
  danhSachTaiKhoan: 'admin', taoTaiKhoan: 'admin', datLaiMatKhau: 'admin', tatTaiKhoan: 'admin', saoLuu: 'admin',
};

async function khoiTao(env, req) {
  // Chi chay mot lan: khi chua co tai khoan nao, can SETUP_KEY (secret) trong Cloudflare
  const d = await req.json().catch(() => ({}));
  if (!env.SETUP_KEY || !safeEq(String(d.key || ''), env.SETUP_KEY)) return json(fail('Không hợp lệ.'), 403);
  if ((await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first()).c > 0) return json(fail('Đã khởi tạo rồi.'), 409);
  const pw = randPass(), salt = b64url(rnd(16));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(username,ten,role,salt,hash,iters,must_change) VALUES('admin','Quản trị','Admin',?,?,?,1)").bind(salt, await pbkdf2(pw, salt, PBKDF2_ITERS), PBKDF2_ITERS),
    logStmt(env, 'he_thong', 'KHOI_TAO', 'admin', ''),
  ]);
  return json({ ok: true, username: 'admin', matKhauTam: pw });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method !== 'POST') return json(fail('Phương thức không hợp lệ.'), 405);
    const fn = url.pathname.slice(5);
    try {
      if (fn === 'khoiTao') return await khoiTao(env, req);
      const perm = PERM[fn];
      if (!perm || !API[fn]) return json(fail('Không có chức năng này.'), 404);
      const a = await auth(env, req);
      if (perm !== 'public') {
        if (!a) return json({ ok: false, expired: true, msg: 'Phiên đã hết hạn, đăng nhập lại.' });
        if (perm === 'use' && a.doiMK) return json(fail('Đổi mật khẩu trước khi dùng.'));
        if (perm === 'admin' && a.role !== 'Admin') return json(fail('Không đủ quyền.'), 403);
      }
      const d = await req.json().catch(() => ({}));
      return json(await API[fn](env, req, a, d || {}));
    } catch (err) {
      console.error(fn, String(err && err.stack || err));
      return json(fail('Lỗi hệ thống, thử lại sau.'), 500);
    }
  },
};
