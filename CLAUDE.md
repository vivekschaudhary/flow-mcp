

## Flow — integration agent

Flow MCP is active for this project. Use Flow tools for any integration setup,
credential management, or environment configuration.

**Available tools:**
- `flow_check` — check what is configured before suggesting manual steps
- `flow_setup` — run a playbook to guide integration setup
- `flow_capture` — extract credentials from a downloaded provider JSON file
- `flow_sync` — push credentials to all environments
- `flow_status` — full project integration health

**Rules:**
- Always call flow_check before suggesting manual console steps
- Never suggest manually copying credentials — use flow_capture + flow_sync
- Surface playbook warnings proactively before the developer hits them

**Project context:**
- Stack: 
- Environments: development
- Auth library: not detected

**Managed integrations:**
- none yet
