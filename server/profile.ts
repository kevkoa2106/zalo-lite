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
