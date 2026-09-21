/**
 * Servidor local para receber webhooks do Wabox durante o desenvolvimento.
 * Apenas dados/canais de teste: guarda em memória e expõe GET /events sem autenticação.
 * Não é exemplo de inbox de produção; eventos somem quando o processo reinicia.
 *
 *   WABOX_WEBHOOK_SECRET=whsec_… bun webhook-sink.ts [porta=8787]
 *   (Node ≥ 22: node --experimental-strip-types webhook-sink.ts)
 *
 * - POST /<qualquer>   → verifica X-Wabox-Signature (se o segredo estiver definido), imprime e guarda o evento
 * - GET  /events       → últimos 200 eventos em JSON (mais recente primeiro); ?type=received filtra
 * - GET  /health       → ok
 *
 * Exponha com `ngrok http 8787` ou `cloudflared tunnel --url http://localhost:8787` e configure:
 *   wabox.sh PUT webhooks '{"received_url":"https://<túnel>/received","delivery_url":"https://<túnel>/delivery","message_status_url":"https://<túnel>/status","connected_url":"https://<túnel>/connected","disconnected_url":"https://<túnel>/disconnected"}'
 */
import { createServer } from "node:http";
import { verifyWaboxSignature } from "./verify-signature.ts";

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const secret = process.env.WABOX_WEBHOOK_SECRET ?? "";
const events: Array<{
  received_at: string;
  path: string;
  signature: "valid" | "invalid" | "unchecked";
  event: unknown;
}> = [];

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") return res.writeHead(200).end("ok");
  if (req.method === "GET" && url.pathname === "/events") {
    const type = url.searchParams.get("type");
    const list = type
      ? events.filter((e) => (e.event as { type?: string })?.type === type)
      : events;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(list, null, 2));
  }
  if (req.method !== "POST") return res.writeHead(404).end();

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  const header = req.headers["x-wabox-signature"];
  const signature = secret
    ? verifyWaboxSignature(secret, header, raw)
      ? "valid"
      : "invalid"
    : "unchecked";
  if (signature === "invalid") {
    console.warn(`✗ ${url.pathname} assinatura inválida (header=${header ?? "ausente"})`);
    return res.writeHead(401).end();
  }
  let event: unknown;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    event = raw.toString("utf8");
  }
  events.unshift({ received_at: new Date().toISOString(), path: url.pathname, signature, event });
  if (events.length > 200) events.pop();
  res.writeHead(200).end(); // responda antes de processar

  const e = event as Record<string, unknown>;
  const summary =
    e?.type === "received"
      ? `${e.phone} ${Object.keys(e).find((k) => ["text", "image", "audio", "video", "document", "sticker", "location", "contact", "reaction", "poll", "poll_vote", "buttons_response", "list_response", "notification"].includes(k)) ?? "?"}`
      : e?.type === "delivery"
        ? `${e.phone} ${e.error_code ? `ERRO ${e.error_code}` : "ok"} ${e.message_id ?? ""}`
        : e?.type === "message_status"
          ? `${e.phone} ${e.status} ${(e.ids as string[])?.join(",")}`
          : JSON.stringify(e).slice(0, 120);
  console.log(`${signature === "valid" ? "✓" : "·"} ${e?.type ?? "?"} ${summary}`);
}).listen(port, () => {
  console.log(
    `webhook sink em http://localhost:${port}  (assinatura: ${secret ? "verificando" : "NÃO verificada — defina WABOX_WEBHOOK_SECRET"})`,
  );
});
