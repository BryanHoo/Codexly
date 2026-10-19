import type { ConnectionDraft } from "@codexly/frontend-core/claude-configuration";
import type { ClaudeSettingsControls } from "./claude-runtime-settings-fields.js";
import { ApiConnectionFields, ApiConnectionSubmit } from "./api-connection-fields.js";

/** 初始化和设置共用最小连接表单，模型、工具规则不进入连接流程。 */
export function ClaudeConnectionFields({
  labels,
  setup = false,
  connection,
  disabled,
  busy,
  canReuseKey,
  actionLabel,
  onChange,
  onSubmit,
}: Readonly<{
  labels: ClaudeSettingsControls["labels"];
  setup?: boolean;
  connection: ConnectionDraft;
  disabled: boolean;
  busy: boolean;
  canReuseKey: boolean;
  actionLabel: string;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  onSubmit: () => void;
}>) {
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !busy) onSubmit();
      }}
    >
      <ApiConnectionFields
        setup={setup}
        disabled={disabled || busy}
        baseUrl={connection.baseUrl}
        apiKey={connection.apiKey}
        endpointPlaceholder="https://api.anthropic.com"
        keyPlaceholder={canReuseKey ? labels.keepKey : labels.credentialPlaceholder}
        labels={{
          title: labels.credentials,
          endpoint: labels.endpoint,
          apiKey: labels.apiKey,
          showKey: labels.showKey,
          hideKey: labels.hideKey,
        }}
        onBaseUrlChange={(baseUrl) => {
          onChange({ baseUrl });
        }}
        onApiKeyChange={(apiKey) => {
          onChange({ apiKey });
        }}
      />
      <ApiConnectionSubmit
        setup={setup}
        disabled={disabled || busy}
        busy={busy}
        label={busy ? labels.connecting : actionLabel}
      />
    </form>
  );
}
