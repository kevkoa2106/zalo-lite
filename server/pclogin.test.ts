import { expect, test } from "bun:test";
// zca-js's own implementation of the same scheme, used as the reference.
import { ParamsEncryptor, decryptResp, getSignKey } from "../node_modules/zca-js/dist/utils.js";
import { decrypt, paramCipher, signKey, signedParams } from "./pclogin";

test("zcid matches zca-js ParamsEncryptor for the same inputs", () => {
  const imei = "0b1c2d3e-0000-4000-8000-000000000000-0123456789abcdef0123456789abcdef";
  const t = 1762070000000;
  const ref = new ParamsEncryptor({ type: 30, imei, firstLaunchTime: t }).getParams();
  expect(paramCipher(imei, t).zcid).toBe(ref!.zcid);
});

test("encrypt key is 32 chars and the payload decrypts with it", () => {
  const { params, enk } = signedParams("reqqr", "imei-x", { a: 1, b: "hai" });
  expect(enk).toHaveLength(32);
  expect(JSON.parse(decrypt(enk, String(params.params)))).toEqual({ a: 1, b: "hai" });
  expect(decryptResp(enk, String(params.params))).toEqual({ a: 1, b: "hai" });
});

test("reqqr signkey covers every other query param, zpw_ver and zpw_type included", () => {
  const { params } = signedParams("reqqr", "imei-x", { a: 1 });
  const { signkey, ...rest } = params;
  expect(rest.zpw_ver).toBe(694);
  expect(rest.zpw_type).toBe(30);
  expect(signkey).toBe(getSignKey("reqqr", rest));
});

test("signkey matches zca-js getSignKey", () => {
  const p = { zcid: "AB", zcid_ext: "12f", enc_ver: "v2", params: "xyz", type: 30, client_version: 694 };
  expect(signKey("reqqr", p)).toBe(getSignKey("reqqr", p));
});
