/**
 * Dat Cang - Quan ly khach (ban thu V0.1, 27/11/2026)
 * Web app: Sale dang nhap, them lead (ma tu sinh), xem lead, doi giai doan (ngay tu ghi).
 * Co so du lieu: Google Trang tinh (DB_ID). Khong luu mat khau dang ro, khong luu du lieu khach trong ma nguon.
 */
var DB_ID = '__DB_ID__';
var TZ = 'Asia/Bangkok';
var SESSION_SEC = 6 * 3600;   // toi da cua CacheService
var MAX_FAIL = 5;             // so lan nhap sai lien tiep
var LOCK_MIN = 15;            // phut khoa tai khoan
var HASH_ROUNDS = 300;
var MIN_PASS = 10;
var ROLES = ['Admin', 'QLDA', 'Sale'];

var LEAD_COLS = ['Mã lead', 'Ngày nhận', 'Tên khách', 'SĐT', 'Nguồn', 'Sale phụ trách', 'Giai đoạn',
  'Ngày đổi giai đoạn gần nhất', 'Tóm lược khách', 'Hành động tiếp theo', 'Ngày hành động',
  'Giá trị dự kiến (chưa VAT)', 'Lý do mất', 'Ghi chú', 'Tạo lúc', 'Người sửa cuối', 'Sửa lúc'];
var CLOSED = ['Đã ký', 'Mất', 'Không tiềm năng'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Đất Cảng - Quản lý khách')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- tien ich ---------- */
function sh_(name) {
  var s = SpreadsheetApp.openById(DB_ID).getSheetByName(name);
  if (!s) throw new Error('Thiếu tab ' + name);
  return s;
}
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function now_() { return new Date(); }
function fmt_(d, f) { return Utilities.formatDate(d, TZ, f); }
function fmtDate_(v) { return (v instanceof Date) ? fmt_(v, 'dd/MM/yyyy') : (v ? String(v) : ''); }
function fmtTime_(v) { return (v instanceof Date) ? fmt_(v, 'dd/MM/yyyy HH:mm') : (v ? String(v) : ''); }
function safe_(v) {            // chong chen cong thuc
  v = (v === null || v === undefined) ? '' : String(v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function parseDate_(s) {       // yyyy-mm-dd
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}
function normPhone_(s) {
  var d = String(s || '').replace(/[^\d+]/g, '');
  d = d.replace(/^\+/, '');
  if (/^84\d{9}$/.test(d)) d = '0' + d.slice(2);
  return /^0\d{9,10}$/.test(d) ? d : null;
}
function phoneKey_(v) {        // Trang tinh co the doi SDT thanh so va mat so 0 dau: so sanh theo chu so, bo so 0 dau
  return String(v === null || v === undefined ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
}
function phoneShow_(v) {
  var k = phoneKey_(v);
  return k ? '0' + k : '';
}
function hash_(pass, salt) {
  var h = String(pass);
  for (var i = 0; i < HASH_ROUNDS; i++) {
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + h + '|' + i, Utilities.Charset.UTF_8);
    h = Utilities.base64Encode(d);
  }
  return h;
}
function randPass_() {
  var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
  var u = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < 12; i++) out += chars.charAt(parseInt(u.substr(i * 2, 2), 16) % chars.length);
  return out;
}
function log_(user, action, obj, detail) {
  try { sh_('Nhật ký').appendRow([now_(), user || '', action, obj || '', safe_(detail || '')]); } catch (e) { Logger.log('log loi: ' + e); }
}
function wrap_(fn) {
  try { return fn(); }
  catch (e) { Logger.log('LOI: ' + e + ' ' + (e && e.stack)); return { ok: false, msg: 'Có lỗi hệ thống, thử lại hoặc báo admin.' }; }
}

/* ---------- tai khoan va phien ---------- */
function findUser_(username) {
  var data = sh_('Tài khoản').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username) return { row: i + 1, v: data[i] };
  }
  return null;
}
function auth_(token) {
  if (!token) return null;
  var c = CacheService.getScriptCache().get('S:' + token);
  if (!c) return null;
  var u = findUser_(JSON.parse(c).u);
  if (!u || !isTrue_(u.v[8])) return null;
  CacheService.getScriptCache().put('S:' + token, c, SESSION_SEC);
  return { username: String(u.v[0]).toLowerCase(), ten: String(u.v[1]), role: String(u.v[2]), doiMK: isTrue_(u.v[5]), row: u.row };
}
function userInfo_(a) { return { username: a.username, ten: a.ten, role: a.role, doiMK: a.doiMK }; }
var EXPIRED = { ok: false, expired: true, msg: 'Phiên đã hết hạn, đăng nhập lại.' };

function login(username, pass) {
  return wrap_(function () {
    var u = String(username || '').trim().toLowerCase(); var p = String(pass || '');
    var generic = { ok: false, msg: 'Sai tên đăng nhập hoặc mật khẩu.' };
    if (!u || !p) return { ok: false, msg: 'Nhập tên đăng nhập và mật khẩu.' };
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var f = findUser_(u);
      if (!f) { hash_(p, 'x'); log_(u, 'DANG_NHAP_SAI', '', 'khong ton tai'); return generic; }
      var r = f.v;
      if (!isTrue_(r[8])) { log_(u, 'DANG_NHAP_SAI', '', 'tai khoan tat'); return generic; }
      var until = r[7] ? new Date(r[7]) : null;
      if (until && until.getTime() > now_().getTime())
        return { ok: false, msg: 'Tài khoản tạm khóa đến ' + fmt_(until, 'HH:mm') + ' vì nhập sai nhiều lần.' };
      if (hash_(p, String(r[3])) === String(r[4])) {
        var token = Utilities.getUuid() + Utilities.getUuid();
        CacheService.getScriptCache().put('S:' + token, JSON.stringify({ u: u }), SESSION_SEC);
        sh_('Tài khoản').getRange(f.row, 7, 1, 2).setValues([[0, '']]);
        log_(u, 'DANG_NHAP', '', '');
        return { ok: true, token: token, user: { username: u, ten: String(r[1]), role: String(r[2]), doiMK: isTrue_(r[5]) } };
      }
      var fails = (Number(r[6]) || 0) + 1, lockUntil = '';
      if (fails >= MAX_FAIL) { lockUntil = new Date(now_().getTime() + LOCK_MIN * 60000); fails = 0; }
      sh_('Tài khoản').getRange(f.row, 7, 1, 2).setValues([[fails, lockUntil]]);
      log_(u, 'DANG_NHAP_SAI', '', lockUntil ? 'khoa ' + LOCK_MIN + ' phut' : 'sai lan ' + fails);
      return generic;
    } finally { lock.releaseLock(); }
  });
}
function logout(token) {
  return wrap_(function () { CacheService.getScriptCache().remove('S:' + token); return { ok: true }; });
}
function phien(token) {
  return wrap_(function () { var a = auth_(token); return a ? { ok: true, user: userInfo_(a) } : EXPIRED; });
}
function doiMatKhau(token, cu, moi) {
  return wrap_(function () {
    var a = auth_(token); if (!a) return EXPIRED;
    moi = String(moi || '');
    if (moi.length < MIN_PASS) return { ok: false, msg: 'Mật khẩu mới tối thiểu ' + MIN_PASS + ' ký tự.' };
    if (moi.toLowerCase() === a.username) return { ok: false, msg: 'Mật khẩu không được trùng tên đăng nhập.' };
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var f = findUser_(a.username);
      if (hash_(cu, String(f.v[3])) !== String(f.v[4])) return { ok: false, msg: 'Mật khẩu hiện tại không đúng.' };
      if (moi === String(cu)) return { ok: false, msg: 'Mật khẩu mới phải khác mật khẩu hiện tại.' };
      var salt = Utilities.getUuid();
      sh_('Tài khoản').getRange(f.row, 4, 1, 6).setValues([[salt, hash_(moi, salt), false, 0, '', true]]);
      log_(a.username, 'DOI_MAT_KHAU', '', '');
      return { ok: true };
    } finally { lock.releaseLock(); }
  });
}

/* ---------- danh muc ---------- */
function danhMuc_() {
  var data = sh_('Danh mục').getDataRange().getValues(), out = { giaiDoan: [], nguon: [], sale: [], qlda: [] };
  var keys = ['giaiDoan', 'nguon', 'sale', 'qlda'];
  for (var i = 1; i < data.length; i++) for (var c = 0; c < 4; c++) { var v = String(data[i][c] || '').trim(); if (v) out[keys[c]].push(v); }
  return out;
}
function layDanhMuc(token) {
  return wrap_(function () { var a = auth_(token); if (!a) return EXPIRED; return { ok: true, dm: danhMuc_() }; });
}

/* ---------- lead ---------- */
function themLead(token, d) {
  return wrap_(function () {
    var a = auth_(token); if (!a) return EXPIRED;
    if (a.doiMK) return { ok: false, msg: 'Đổi mật khẩu trước khi dùng.' };
    d = d || {};
    var dm = danhMuc_();
    var ten = String(d.ten || '').trim(), tl = String(d.tomLuoc || '').trim(), hd = String(d.hanhDong || '').trim();
    var sdt = normPhone_(d.sdt), ngayNhan = parseDate_(d.ngayNhan), ngayHd = parseDate_(d.ngayHanhDong);
    var gia = (d.giaTri === '' || d.giaTri === null || d.giaTri === undefined) ? '' : Number(d.giaTri);
    var sale = a.role === 'Sale' ? a.ten : String(d.sale || '').trim();
    var err = [];
    if (!ten || ten.length > 200) err.push('Tên khách bắt buộc, tối đa 200 ký tự.');
    if (!sdt) err.push('SĐT không hợp lệ (10 hoặc 11 số, bắt đầu bằng 0).');
    if (dm.nguon.indexOf(String(d.nguon)) < 0) err.push('Chọn nguồn từ danh sách.');
    if (dm.sale.indexOf(sale) < 0) err.push('Chọn Sale phụ trách từ danh sách.');
    if (!ngayNhan) err.push('Ngày nhận không hợp lệ.');
    if (tl.length > 1000) err.push('Tóm lược tối đa 1000 ký tự.');
    if (!hd || hd.length > 300) err.push('Hành động tiếp theo bắt buộc, tối đa 300 ký tự.');
    if (!ngayHd) err.push('Ngày hành động không hợp lệ.');
    else if (ngayNhan && ngayHd.getTime() < ngayNhan.getTime()) err.push('Ngày hành động không được trước ngày nhận.');
    if (gia !== '' && (isNaN(gia) || gia < 0)) err.push('Giá trị dự kiến phải là số không âm.');
    if (err.length) return { ok: false, msg: err.join(' ') };

    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var s = sh_('Lead'), data = s.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (phoneKey_(data[i][3]) === phoneKey_(sdt)) return { ok: false, msg: 'SĐT đã có trong hệ thống: ' + data[i][0] + ', Sale ' + data[i][5] + ', giai đoạn ' + data[i][6] + '.' };
      }
      var key = 'L-' + fmt_(now_(), 'yyMM');
      var cs = sh_('Bộ đếm'), cd = cs.getDataRange().getValues(), n = 0, crow = -1;
      for (var j = 1; j < cd.length; j++) if (String(cd[j][0]) === key) { n = Number(cd[j][1]) || 0; crow = j + 1; }
      n += 1;
      if (crow < 0) cs.appendRow([key, n]); else cs.getRange(crow, 2).setValue(n);
      var ma = key + '-' + ('000' + n).slice(-3);
      var t = now_();
      s.appendRow([ma, ngayNhan, safe_(ten), sdt, d.nguon, sale, 'Mới', t, safe_(tl), safe_(hd), ngayHd,
        gia, '', '', t, a.ten, t]);
      s.getRange(s.getLastRow(), 4).setNumberFormat('@').setValue(sdt);   // giu so 0 dau
      log_(a.username, 'THEM_LEAD', ma, 'Sale ' + sale);
      return { ok: true, ma: ma };
    } finally { lock.releaseLock(); }
  });
}
function rowToLead_(r) {
  return { ma: r[0], ngayNhan: fmtDate_(r[1]), ten: r[2], sdt: phoneShow_(r[3]), nguon: r[4], sale: r[5], giaiDoan: r[6],
    ngayDoiGd: fmtDate_(r[7]), tomLuoc: r[8], hanhDong: r[9], ngayHd: fmtDate_(r[10]), giaTri: r[11], lyDoMat: r[12] };
}
function danhSachLead(token) {
  return wrap_(function () {
    var a = auth_(token); if (!a) return EXPIRED;
    var data = sh_('Lead').getDataRange().getValues(), out = [];
    for (var i = data.length - 1; i >= 1 && out.length < 500; i--) {
      if (!data[i][0]) continue;
      if (a.role === 'Sale' && String(data[i][5]) !== a.ten) continue;
      out.push(rowToLead_(data[i]));
    }
    return { ok: true, leads: out };
  });
}
function doiGiaiDoan(token, ma, gd, lyDo, hanhDong, ngayHd) {
  return wrap_(function () {
    var a = auth_(token); if (!a) return EXPIRED;
    if (a.doiMK) return { ok: false, msg: 'Đổi mật khẩu trước khi dùng.' };
    var dm = danhMuc_();
    if (dm.giaiDoan.indexOf(String(gd)) < 0) return { ok: false, msg: 'Chọn giai đoạn từ danh sách.' };
    var closed = CLOSED.indexOf(gd) >= 0, ly = String(lyDo || '').trim(), hd = String(hanhDong || '').trim(), nh = parseDate_(ngayHd);
    if (gd === 'Mất' && !ly) return { ok: false, msg: 'Giai đoạn Mất bắt buộc ghi lý do.' };
    if (!closed && (!hd || !nh)) return { ok: false, msg: 'Lead còn mở bắt buộc có hành động tiếp theo và ngày hành động.' };
    if (ly.length > 300 || hd.length > 300) return { ok: false, msg: 'Nội dung tối đa 300 ký tự.' };
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var s = sh_('Lead'), data = s.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) !== String(ma)) continue;
        if (a.role === 'Sale' && String(data[i][5]) !== a.ten) return { ok: false, msg: 'Lead này không thuộc Sale của bạn.' };
        var t = now_(), old = data[i][6];
        s.getRange(i + 1, 7, 1, 8).setValues([[gd, t, data[i][8], closed ? '' : safe_(hd), closed ? '' : nh, data[i][11], gd === 'Mất' ? safe_(ly) : '', data[i][13]]]);
        s.getRange(i + 1, 16, 1, 2).setValues([[a.ten, t]]);
        log_(a.username, 'DOI_GIAI_DOAN', ma, old + ' -> ' + gd);
        return { ok: true };
      }
      return { ok: false, msg: 'Không tìm thấy lead.' };
    } finally { lock.releaseLock(); }
  });
}

/* ---------- ham admin: chay trong trinh soan thao Apps Script, mat khau tam chi hien o nhat ky chay ---------- */
function taoTaiKhoan(username, hoTen, vaiTro) {
  username = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) throw new Error('Tên đăng nhập 3 đến 30 ký tự a-z, 0-9, _ .');
  if (ROLES.indexOf(vaiTro) < 0) throw new Error('Vai trò phải là ' + ROLES.join(', '));
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (findUser_(username)) throw new Error('Tên đăng nhập đã tồn tại.');
    var pass = randPass_(), salt = Utilities.getUuid();
    sh_('Tài khoản').appendRow([username, hoTen, vaiTro, salt, hash_(pass, salt), true, 0, '', true]);
    log_('admin-editor', 'TAO_TAI_KHOAN', username, vaiTro);
    Logger.log('Tài khoản ' + username + ' | mật khẩu tạm: ' + pass + ' | phải đổi ở lần đăng nhập đầu.');
  } finally { lock.releaseLock(); }
}
function datLaiMatKhau(username) {
  username = String(username).trim().toLowerCase();
  var f = findUser_(username); if (!f) throw new Error('Không có tài khoản ' + username);
  var pass = randPass_(), salt = Utilities.getUuid();
  sh_('Tài khoản').getRange(f.row, 4, 1, 6).setValues([[salt, hash_(pass, salt), true, 0, '', true]]);
  log_('admin-editor', 'DAT_LAI_MAT_KHAU', username, '');
  Logger.log('Mật khẩu tạm của ' + username + ': ' + pass);
}
function tatTaiKhoan(username) {
  var f = findUser_(String(username).trim().toLowerCase()); if (!f) throw new Error('Không có tài khoản.');
  sh_('Tài khoản').getRange(f.row, 9).setValue(false);
  log_('admin-editor', 'TAT_TAI_KHOAN', username, '');
}
function khoiTaoThu() {       // tao 2 tai khoan thu, KHONG dung ten that
  taoTaiKhoan('admin', 'Admin', 'Admin');
  taoTaiKhoan('sale_thu', 'Trung', 'Sale');   // ten khop danh muc Sale de thu
}

/** Tu kiem tra tren Google that: tao tai khoan tam, chay dang nhap, doi MK, them lead, doi giai doan, roi tat tai khoan tam. Chi dung cho ban thu. */
function selfTest() {
  var out = [], ok = function (c, n) { out.push((c ? 'PASS ' : 'FAIL ') + n); };
  var u = 'selftest' + Math.floor(Math.random() * 1e6), p1 = 'TamThoi#2026ab', p2 = 'MatKhauMoi#2026';
  var salt = Utilities.getUuid();
  sh_('Tài khoản').appendRow([u, 'Trung', 'Sale', salt, hash_(p1, salt), true, 0, '', true]);
  var r = login(u, 'sai'); ok(!r.ok, 'sai mat khau bi tu choi');
  r = login(u, p1); ok(r.ok && r.user.doiMK, 'dang nhap dung, bat doi MK');
  var t = r.token;
  r = doiMatKhau(t, p1, p2); ok(r.ok, 'doi mat khau');
  r = login(u, p2); ok(r.ok && !r.user.doiMK, 'dang nhap mat khau moi'); t = r.token;
  var sdt = '09' + ('00000000' + Math.floor(Math.random() * 1e8)).slice(-8);
  var d = { ngayNhan: fmt_(now_(), 'yyyy-MM-dd'), nguon: 'Khách cho số', ten: 'KHACH THU TU DONG', sdt: sdt, sale: 'Trung', giaTri: '1000000', tomLuoc: 'du lieu thu', hanhDong: 'Goi thu', ngayHanhDong: fmt_(now_(), 'yyyy-MM-dd') };
  r = themLead(t, d); ok(r.ok && /^L-\d{4}-\d{3}$/.test(r.ma), 'them lead ma tu sinh ' + r.ma);
  var ma = r.ma;
  r = themLead(t, d); ok(!r.ok, 'trung SDT bi chan');
  r = doiGiaiDoan(t, ma, 'Đã liên hệ', '', 'Gui bao gia', fmt_(now_(), 'yyyy-MM-dd')); ok(r.ok, 'doi giai doan');
  r = danhSachLead(t); ok(r.ok && r.leads.some(function (l) { return l.ma === ma && l.giaiDoan === 'Đã liên hệ'; }), 'danh sach co lead da doi giai doan');
  logout(t); r = danhSachLead(t); ok(r.expired === true, 'dang xuat het hieu luc');
  var f = findUser_(u); sh_('Tài khoản').getRange(f.row, 9).setValue(false);
  Logger.log(out.join('\n') + '\n(tai khoan tam ' + u + ' da tat; lead thu ' + ma + ' nam trong Trang tinh thu)');
}
