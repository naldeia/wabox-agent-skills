# Compatibilidade do SDK publicado

Antes de integrar, confira a versão instalada, os exports e os tipos do pacote, além do OpenAPI do ambiente alvo. Código-fonte do monorepo e exemplos online podem estar à frente do npm.

Na revisão de **2026-09-21**, a API passou a autenticar com **API keys do workspace** (`Authorization: Bearer wbx_key_…`, criadas em Segurança › API keys, com permissões por key), que substituem os headers `Client-Token` e `Account-Token`. O SDK correspondente usa `createWabox({ instanceId, token, apiKey? })` e `createWaboxAccount({ apiKey })` (variável sugerida: `WABOX_API_KEY`). As versões npm existentes nessa data são anteriores:

| Versão npm | Provisionamento | Rotas de instância |
| --- | --- | --- |
| `0.1.0` | só `createWaboxPartner` + tipos `/partner/*` (rotas que não existem mais); **não exporta `createWaboxAccount`** | `createWabox({ clientToken? })` |
| `0.1.1` | `createWaboxAccount({ accountToken })` envia `Account-Token`, que a API não aceita mais → `401 api_key_required` | `createWabox({ clientToken? })` |
| com `apiKey` nos tipos | `createWaboxAccount({ apiKey })` | `createWabox({ apiKey? })` |

`createWabox`, `unwrap` e os helpers em `@wabox/sdk/webhooks` funcionam em todas; tipos de campos/rotas acrescentados depois da publicação podem estar ausentes.

- Não use `createWaboxPartner`/`Partner-Token`/`/partner/*` nem `accountToken`/`Account-Token` contra a API atual.
- Se a versão instalada já aceitar `apiKey` (confira os tipos de `WaboxOptions`/`WaboxAccountOptions`), use-a e fixe a versão no lockfile do projeto.
- Enquanto isso, use um cliente HTTP para `/account/*` com `Authorization: Bearer`. Para rotas/campos de instância ausentes nos tipos, use HTTP validado pelo OpenAPI atual ou gere um cliente a partir dele; não esconda divergências com `as any`.
- Rotas de instância em workspace que exige API key, com SDK `0.1.x`: `clientToken` envia o header `Client-Token`, que a API aceita como alias — passe nele a API key (`wbx_key_…`, permissão `instances:operate`). Ao atualizar o SDK, troque por `apiKey`.
- O SDK é ESM e pede Node ≥ 20 (ou runtime compatível, como Bun). Verifique o runtime/build do Kinbox antes da adoção.

## Exemplo mínimo de Account API com Fetch

Adapte ao cliente HTTP e validação do projeto. A base é o **host**, sem `/account` no final. Todos os segredos ficam no backend. O helper não faz retry automático; timeout/`5xx` em criação pode significar resultado desconhecido.

```ts
const apiUrl = process.env.WABOX_API_URL ?? "https://api.wabox.me";
// API key do workspace (Segurança › API keys). Provisionamento: instances:read + instances:write;
// webhooks:read/webhooks:write só se for gerenciar /account/webhooks.
const apiKey = process.env.WABOX_API_KEY;
if (!apiKey) throw new Error("WABOX_API_KEY não configurado");

async function accountRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: `/account/${string}`,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey!}`, // a Account API não aceita o alias Client-Token
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    // Normalize error.code/details e Retry-After no cliente real; não logue tokens/respostas de credenciais.
    // 401 api_key_required = key ausente/inválida; 403 insufficient_scope = falta details.required_scope na key.
    throw Object.assign(new Error(`Wabox HTTP ${response.status}`), {
      status: response.status,
      body: data,
      retryAfter: response.headers.get("Retry-After"),
    });
  }
  return data; // valide o schema antes de usar/persistir a resposta
}

// Leitura para validar acesso ao workspace (instances:read):
const plan = await accountRequest("GET", "/account/plan");
// No fluxo autorizado de provisionamento, após lock e reconciliação por canal (instances:write):
// await accountRequest("POST", "/account/instances", { name: "kinbox:tenant:channel" });
```

Para envio, use `createWabox({ instanceId, token, apiKey })` (ou `clientToken` no SDK `0.1.x`) e caminhos relativos como `/send-text`. Esse cliente usa as credenciais da instância; a API key é opcional — só quando o workspace exige API key nas rotas de instância — e precisa da permissão `instances:operate`, não das permissões da Account API. Verificação HMAC usa o segredo efetivo de webhook, que também é uma credencial diferente.
