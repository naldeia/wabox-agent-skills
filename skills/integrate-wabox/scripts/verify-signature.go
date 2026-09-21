// Verificação da assinatura de webhooks do Wabox em Go.
//
//	X-Wabox-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>
//
// Uso num handler net/http (leia o corpo cru antes de decodificar o JSON):
//
//	raw, _ := io.ReadAll(r.Body)
//	if !VerifyWaboxSignature(secret, r.Header.Get("X-Wabox-Signature"), raw, 5*time.Minute) {
//		w.WriteHeader(http.StatusUnauthorized); return
//	}
package waboxwebhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// VerifyWaboxSignature valida o header contra o corpo cru. Aceita vários v1= (rotação de segredo).
func VerifyWaboxSignature(secret, header string, rawBody []byte, tolerance time.Duration) bool {
	if secret == "" || header == "" {
		return false
	}
	var t int64 = -1
	var sigs [][]byte
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				t = n
			}
		case "v1":
			if b, err := hex.DecodeString(v); err == nil && len(b) == sha256.Size {
				sigs = append(sigs, b)
			}
		}
	}
	if t < 0 || len(sigs) == 0 {
		return false
	}
	if d := time.Since(time.Unix(t, 0)); d > tolerance || d < -tolerance {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(t, 10)))
	mac.Write([]byte("."))
	mac.Write(rawBody)
	expected := mac.Sum(nil)
	for _, s := range sigs {
		if hmac.Equal(s, expected) {
			return true
		}
	}
	return false
}
