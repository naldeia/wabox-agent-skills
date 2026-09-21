/**
 * Verificação da assinatura de webhooks do Wabox (Node ≥ 18 / Bun).
 *
 *   X-Wabox-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *
 * Uso como módulo:
 *   import { verifyWaboxSignature } from "./verify-signature";
 *   if (!verifyWaboxSignature(secret, req.headers["x-wabox-signature"], rawBody)) return 401;
 *
 * Uso como CLI (corpo cru via stdin):
 *   echo -n '{"type":"received"}' | bun verify-signature.ts whsec_xxx 't=1700000000,v1=abc…'
 *
 * Importante: `rawBody` deve ser exatamente os bytes recebidos (antes de qualquer JSON.parse).
 * Aceita vários `v1=` no header (rotação de segredo): basta um bater.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWaboxSignature(
  secret: string,
  header: string | string[] | undefined,
  rawBody: string | Buffer,
  toleranceSeconds = 300,
  now = Date.now() / 1000,
): boolean {
  if (!secret || !header) return false;
  const h = Array.isArray(header) ? header[0] : header;
  let t = NaN;
  const sigs: Buffer[] = [];
  for (const part of h.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) sigs.push(Buffer.from(v, "hex"));
  }
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSeconds || sigs.length === 0)
    return false;
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(body).digest();
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

if (import.meta.main ?? process.argv[1]?.endsWith("verify-signature.ts")) {
  const [secret, header] = process.argv.slice(2);
  if (!secret || !header) {
    console.error("uso: verify-signature.ts <secret> '<X-Wabox-Signature>' < body.json");
    process.exit(2);
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const ok = verifyWaboxSignature(secret, header, Buffer.concat(chunks));
  console.log(ok ? "valid" : "INVALID");
  process.exit(ok ? 0 : 1);
}
