# Compatibilidade do SDK publicado

Antes de integrar, confira a versão instalada, os exports e os tipos do pacote, além do OpenAPI do ambiente alvo. Código-fonte do monorepo e exemplos online podem estar à frente do npm.

Na revisão de **2026-09-21**, a API publicada usava `/account/*` com `Account-Token`, mas o tarball npm `@wabox/sdk@0.1.0` ainda exportava `createWaboxPartner` e tipos `/partner/*`. Essa versão **não exporta `createWaboxAccount`**. A API pública de instância (`createWabox`), `unwrap` e os helpers em `@wabox/sdk/webhooks` estão disponíveis; tipos de campos/rotas acrescentados depois da publicação podem estar ausentes.

- Não use `createWaboxPartner`/`Partner-Token`/`/partner/*` contra a API atual.
- Se uma versão nova já trouxer `createWaboxAccount` e tipos compatíveis, use-a e fixe a versão no lockfile do projeto.
- Enquanto isso, use um cliente HTTP para `/account/*` com `Account-Token`. Para rotas/campos de instância ausentes nos tipos, use HTTP validado pelo OpenAPI atual ou gere um cliente a partir dele; não esconda divergências com `as any`.
- O SDK é ESM e pede Node ≥ 20 (ou runtime compatível, como Bun). Verifique o runtime/build do Kinbox antes da adoção.

## Exemplo mínimo de Account API com Fetch

Adapte ao cliente HTTP e validação do projeto. A base é o **host**, sem `/account` no final. Todos os segredos ficam no backend. O helper não faz retry automático; timeout/`5xx` em criação pode significar resultado desconhecido.

```ts
const apiUrl = process.env.WABOX_API_URL ?? "https://api.wabox.me";
const accountToken = process.env.WABOX_ACCOUNT_TOKEN;
if (!accountToken) throw new Error("WABOX_ACCOUNT_TOKEN não configurado");

async function accountRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: `/account/${string}`,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      "Account-Token": accountToken!,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    // Normalize error.code/details e Retry-After no cliente real; não logue tokens/respostas de credenciais.
    throw Object.assign(new Error(`Wabox HTTP ${response.status}`), {
      status: response.status,
      body: data,
      retryAfter: response.headers.get("Retry-After"),
    });
  }
  return data; // valide o schema antes de usar/persistir a resposta
}

// Leitura para validar acesso ao workspace:
const plan = await accountRequest("GET", "/account/plan");
// No fluxo autorizado de provisionamento, após lock e reconciliação por canal:
// await accountRequest("POST", "/account/instances", { name: "kinbox:tenant:channel" });
```

Para envio, a API continua usando `createWabox({ instanceId, token, clientToken })` e caminhos relativos como `/send-text`. Esse cliente usa credenciais da instância, não `Account-Token`. Verificação HMAC usa o segredo efetivo de webhook, que também é uma credencial diferente.
