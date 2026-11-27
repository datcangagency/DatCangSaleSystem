// Dat Cang - Quan ly khach (Cloudflare Worker + D1). Chi chua ma nguon; du lieu nam trong D1.
// Moi API: POST /api/<ten>, body JSON, token trong header Authorization: Bearer <token>.

const SESSION_MS = 6 * 3600 * 1000, MAX_FAIL = 5, LOCK_MS = 15 * 60 * 1000;
const PBKDF2_ITERS = 10000;          // Goi y: Workers Free chi cho 10 ms CPU/yeu cau; do thuc te truoc khi tang
const MIN_PASS = 10;
const ROLES = ['Admin', 'QLDA', 'Sale'];
const CLOSED = ['Đã ký', 'Mất', 'Không tiềm năng'];
const LOSS = ['Mất', 'Không tiềm năng'];

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

async function catalog(env) {
  const { results } = await env.DB.prepare('SELECT kind, value FROM catalog ORDER BY kind, ord').all();
  const o = { giaiDoan: [], nguon: [], nguonLink: [], cachSdt: [], sale: [], qlda: [], lyDo: [], mucTiemNang: [], loaiViec: [] };
  const map = { giai_doan: 'giaiDoan', nguon: 'nguon', nguon_link: 'nguonLink', cach_sdt: 'cachSdt', sale: 'sale', qlda: 'qlda', ly_do: 'lyDo', muc_tiem_nang: 'mucTiemNang', loai_viec: 'loaiViec' };
  for (const r of results) if (map[r.kind]) o[map[r.kind]].push(r.value);
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

const leadOut = (r) => ({
  ma: r.ma, ngayNhan: r.ngay_nhan, ten: r.ten, sdt: r.sdt, link: r.link, nguon: r.nguon, cachSdt: r.cach_sdt, sale: r.sale,
  giaiDoan: r.giai_doan, ngayDoiGd: r.ngay_doi_gd, mucTiemNang: r.muc_tiem_nang, tomLuoc: r.tom_luoc, loaiViec: r.loai_viec,
  hanhDong: r.hanh_dong, ngayHd: r.ngay_hd, giaTri: r.gia_tri, lyDo: r.ly_do, ghiChu: r.ghi_chu, uuTien: !!r.uu_tien,
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
    let cach = String(d.cachSdt || '').trim();
    const sale = a.role === 'Sale' ? a.ten : String(d.sale || '').trim();
    const gia = d.giaTri === '' || d.giaTri == null ? null : Number(d.giaTri);
    const e = [];
    if (!ten || ten.length > 200) e.push('Tên khách bắt buộc, tối đa 200 ký tự.');
    if (rawSdt && !sdt) e.push('SĐT không hợp lệ (10 hoặc 11 số, bắt đầu bằng 0). Chưa có SĐT thì để trống.');
    if (rawLink && !linkKey) e.push('Link Facebook/fanpage không hợp lệ.');
    if (rawLink.length > 300) e.push('Link tối đa 300 ký tự.');
    if (useLink && !sdt && !linkKey) e.push('Nguồn này cần SĐT hoặc link Facebook/fanpage của khách.');
    if (!useLink && !sdt) e.push('Nguồn này bắt buộc có SĐT.');
    if (sdt && !dm.cachSdt.includes(cach)) e.push('Chọn cách có SĐT: Khách cho hay Mình tự tìm.');
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
    const { results } = await env.DB.prepare('SELECT * FROM leads ORDER BY uu_tien DESC, tao_luc DESC LIMIT 500').all();
    return { ok: true, leads: results.map(leadOut) };
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
    const sets = [env.DB.prepare(
      'UPDATE leads SET giai_doan=?, ngay_doi_gd=?, muc_tiem_nang=?, ly_do=?, loai_viec=?, hanh_dong=?, ngay_hd=?, sua_boi=?, sua_luc=? WHERE ma=?'
    ).bind(gd, t, muc, lyDo, loai, safe(hd), ngay, a.ten, t, l.ma)];
    if (gd !== l.giai_doan) sets.push(env.DB.prepare('INSERT INTO stage_history(ma,tu,den,luc,boi,ghi_chu) VALUES(?,?,?,?,?,?)').bind(l.ma, l.giai_doan, gd, t, a.ten, safe(ghiChu || lyDo)));
    sets.push(logStmt(env, a.username, 'DOI_GIAI_DOAN', l.ma, `${l.giai_doan} -> ${gd}`));
    await env.DB.batch(sets);
    return { ok: true };
  },

  async capNhatSdt(env, req, a, d) {
    const dm = await catalog(env);
    const sdt = normPhone(d.sdt), cach = String(d.cachSdt || '');
    if (!sdt) return fail('SĐT không hợp lệ (10 hoặc 11 số, bắt đầu bằng 0).');
    if (!dm.cachSdt.includes(cach)) return fail('Chọn cách có SĐT: Khách cho hay Mình tự tìm.');
    const l = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    if (a.role === 'Sale' && l.sale !== a.ten) return fail('Lead này không thuộc Sale của bạn.');
    const dup = await findDup(env, sdt, '', l.ma); if (dup) return fail(dup);
    const t = now(), had = !!l.sdt;
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE leads SET sdt=?, cach_sdt=?, uu_tien=1, ngay_co_sdt=?, sua_boi=?, sua_luc=? WHERE ma=?').bind(sdt, cach, had ? l.ngay_co_sdt : t, a.ten, t, l.ma),
        logStmt(env, a.username, 'CAP_NHAT_SDT', l.ma, (had ? 'doi SDT' : 'them SDT, len uu tien') + ' | ' + cach),
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

  async lichSu(env, req, a, d) {
    const { results } = await env.DB.prepare('SELECT tu, den, luc, boi, ghi_chu FROM stage_history WHERE ma = ? ORDER BY id').bind(String(d.ma || '')).all();
    return { ok: true, ls: results };
  },


  async chiTietLead(env, req, a, d) {
    const l = await env.DB.prepare('SELECT * FROM leads WHERE ma = ?').bind(String(d.ma || '')).first();
    if (!l) return fail('Không tìm thấy lead.');
    const hist = (await env.DB.prepare('SELECT tu, den, luc, boi, ghi_chu FROM stage_history WHERE ma = ? ORDER BY id').bind(l.ma).all()).results;
    const act = (await env.DB.prepare("SELECT luc, usr, action, detail FROM audit WHERE obj = ? AND action IN ('THEM_LEAD','CAP_NHAT_SDT','CHUYEN_SALE') ORDER BY id").bind(l.ma).all()).results;
    const ten = {}; for (const u of (await env.DB.prepare('SELECT username, ten FROM users').all()).results) ten[u.username] = u.ten;
    const ev = [];
    if (!act.some((x) => x.action === 'THEM_LEAD')) ev.push({ luc: l.tao_luc, loai: 'Tạo lead', noiDung: 'Nguồn ' + l.nguon + ', Sale ' + l.sale, boi: '' });
    for (const x of act) ev.push({ luc: x.luc, loai: x.action === 'THEM_LEAD' ? 'Tạo lead' : x.action === 'CHUYEN_SALE' ? 'Chuyển Sale' : 'SĐT', noiDung: x.detail.replace(/co SDT/g, 'có SĐT').replace(/chua co SDT/g, 'chưa có SĐT').replace(/doi SDT/g, 'đổi SĐT').replace(/them SDT, len uu tien/g, 'thêm SĐT, lên diện ưu tiên'), boi: ten[x.usr] || x.usr });
    for (const h of hist) ev.push({ luc: h.luc, loai: 'Đổi giai đoạn', noiDung: h.tu + ' → ' + h.den + (h.ghi_chu ? ' (' + h.ghi_chu + ')' : ''), boi: h.boi });
    ev.sort((x, y) => y.luc - x.luc);
    return { ok: true, lead: { ...leadOut(l), ngayCoSdt: l.ngay_co_sdt, taoLuc: l.tao_luc, suaBoi: l.sua_boi, suaLuc: l.sua_luc }, ev };
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
      q("SELECT CASE WHEN sdt = '' THEN 'Chưa có SĐT' ELSE cach_sdt END AS k, COUNT(*) AS c FROM leads WHERE ngay_nhan >= ? AND ngay_nhan <= ? GROUP BY 1", R.t, R.e),
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

  // ---- quan tri ----
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
  themLead: 'use', danhSachLead: 'use', doiGiaiDoan: 'use', capNhatSdt: 'use', chuyenSale: 'use', lichSu: 'use', chiTietLead: 'use', baoCao: 'use',
  danhSachTaiKhoan: 'admin', taoTaiKhoan: 'admin', datLaiMatKhau: 'admin', tatTaiKhoan: 'admin',
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
