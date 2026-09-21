<?php
/**
 * Verificação da assinatura de webhooks do Wabox (PHP ≥ 7.4).
 *
 *   X-Wabox-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>
 *
 * Uso (corpo cru via php://input, antes de json_decode):
 *   $raw = file_get_contents('php://input');
 *   if (!verifyWaboxSignature(getenv('WABOX_WEBHOOK_SECRET'), $_SERVER['HTTP_X_WABOX_SIGNATURE'] ?? '', $raw)) {
 *       http_response_code(401); exit;
 *   }
 *   http_response_code(200);           // responda antes de processar
 *   $event = json_decode($raw, true);
 *
 * Laravel: use $request->getContent() (não $request->all()) para o corpo cru.
 */
function verifyWaboxSignature(string $secret, string $header, string $rawBody, int $toleranceSeconds = 300): bool
{
    if ($secret === '' || $header === '') {
        return false;
    }
    $t = null;
    $sigs = [];
    foreach (explode(',', $header) as $part) {
        $kv = explode('=', trim($part), 2);
        if (count($kv) !== 2) {
            continue;
        }
        [$k, $v] = $kv;
        if ($k === 't' && ctype_digit($v)) {
            $t = (int) $v;
        } elseif ($k === 'v1' && preg_match('/^[0-9a-f]{64}$/i', $v)) {
            $sigs[] = strtolower($v);
        }
    }
    if ($t === null || $sigs === [] || abs(time() - $t) > $toleranceSeconds) {
        return false;
    }
    $expected = hash_hmac('sha256', $t . '.' . $rawBody, $secret);
    foreach ($sigs as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}
