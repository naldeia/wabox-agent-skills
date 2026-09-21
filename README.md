# Wabox agent skills

Skills no formato [Agent Skills](https://agentskills.io) (`SKILL.md` + `references/` + `scripts/`) para agentes de código — Claude Code, Codex, Cursor e qualquer agente que leia `SKILL.md` — integrarem o [Wabox](https://wabox.me), API de WhatsApp (linked device) com REST + webhooks.

```bash
npx skills add naldeia/wabox-agent-skills
```

| Skill | Quando o agente usa |
| --- | --- |
| [`integrate-wabox`](skills/integrate-wabox/SKILL.md) | Conectar um número, enviar mensagens, receber e verificar webhooks, tratar fila, erros e limites da API pública. Inclui `wabox.sh` (curl pronto), um servidor local de webhooks, verificadores de assinatura em TypeScript, Go e PHP e o de/para **Baileys → Wabox**. |
| [`troubleshoot-wabox`](skills/troubleshoot-wabox/SKILL.md) | Diagnosticar mensagens que não saem, webhooks que não chegam, `error_code`s, banimento e desconexões. |
| [`wabox-partner`](skills/wabox-partner/SKILL.md) | Criar e operar instâncias pela Partner API (`Partner-Token`, `/partner/instances`) em nome dos seus clientes. |

`troubleshoot-wabox` e `wabox-partner` referenciam scripts e referências de `integrate-wabox` — instale as três juntas (padrão do comando acima). Para escolher: `npx skills add naldeia/wabox-agent-skills --skill integrate-wabox`.

## Links

- Documentação: https://developer.wabox.me (`/llms.txt`, `/llms-full.txt`)
- OpenAPI: https://api.wabox.me/openapi.json
- SDK TypeScript: [`@wabox/sdk`](https://www.npmjs.com/package/@wabox/sdk)

Este repositório é um espelho publicado a partir do monorepo do Wabox; abra issues aqui, mas as alterações entram por lá.
