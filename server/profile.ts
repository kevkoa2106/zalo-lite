// The account profile as the UI needs it, from zca-js's `fetchAccountInfo().profile`.
export type Profile = {
  id: string;
  name: string;
  avatar: string;
  cover: string; // banner image URL; zca-js has no call to change it
  gender: 0 | 1; // 0 Nam, 1 Nữ (zca-js Gender)
  dob: string; // YYYY-MM-DD, "" when Zalo gives none
  phone: string;
};

/**
 * A birth date as YYYY-MM-DD, which is what `updateProfile` takes. Zalo's `sdob` is "dd/mm/yyyy" (checked on a live account);
 * `dob` (seconds since 1970) is the fallback.
 * ponytail: the fallback assumes Vietnam time (UTC+7); it only runs when `sdob` is missing.
 */
export function isoDob(sdob: unknown, dob: unknown) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(sdob ?? "").trim());
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  const s = Number(dob);
  return Number.isFinite(s) && s > 0 ? new Date((s + 7 * 3600) * 1000).toISOString().slice(0, 10) : "";
}

export function profileOf(p: Record<string, any>, id: string): Profile {
  return {
    id,
    name: String(p.displayName || p.zaloName || ""),
    avatar: String(p.avatar ?? ""),
    cover: String(p.cover ?? ""),
    gender: p.gender === 1 ? 1 : 0,
    dob: isoDob(p.sdob, p.dob),
    phone: String(p.phoneNumber ?? ""),
  };
}

export type ProfileEdit = { name: string; gender: 0 | 1; dob: string };

/**
 * Check a profile change before it goes to Zalo: this is the real account, so bad input must not reach it.
 * ponytail: the 64-character cap is a sanity limit; Zalo's own rules decide the rest and its error is shown as it is.
 */
export function validateProfile(r: Record<string, unknown>, now = Date.now()): ProfileEdit {
  const name = String(r.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Tên hiển thị không được để trống");
  if (name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Tên hiển thị không hợp lệ");
  if (r.gender !== 0 && r.gender !== 1) throw new Error("Giới tính không hợp lệ");
  const dob = String(r.dob ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const [y, mo, d] = m ? [+m[1]!, +m[2]!, +m[3]!] : [0, 0, 0];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (!m || y < 1900 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || t.getTime() > now) throw new Error("Ngày sinh không hợp lệ");
  return { name, gender: r.gender, dob };
}

export type AvatarUpload = { data: Buffer; width: number; height: number };
const MAX_AVATAR = 5 * 1024 * 1024;

/** The avatar the UI sends: a JPEG (zca-js uploads it as one) of at most 5 MB with sane dimensions. */
export function validateAvatar(r: Record<string, unknown>): AvatarUpload {
  const b64 = String(r.b64 ?? "");
  if ((b64.length * 3) / 4 > MAX_AVATAR) throw new Error("Ảnh quá lớn (tối đa 5 MB)");
  const data = Buffer.from(b64, "base64");
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error("Ảnh đại diện phải là JPEG");
  const side = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 64 || n > 4096) throw new Error("Kích thước ảnh không hợp lệ");
    return n;
  };
  return { data, width: side(r.width), height: side(r.height) };
}
