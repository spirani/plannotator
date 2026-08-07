# Plannotator for Oh My Pi

Plannotator integrates with [Oh My Pi](https://github.com/oh-my-pi/oh-my-pi) as a native extension. It replaces only the native plan-review surface with the Plannotator browser and adds code-review and annotation commands. Oh My Pi remains the owner of plan artifacts, plan-mode transitions, tool restoration, and execution.

## Install, update, and remove

Install the published extension with Oh My Pi's package manager:

```bash
omp install npm:@plannotator/oh-my-pi-extension
```

Update it with:

```bash
omp plugin upgrade @plannotator/oh-my-pi-extension
```

Remove it with:

```bash
omp plugin uninstall @plannotator/oh-my-pi-extension
```

To try a source checkout without installing it:

```bash
omp --extension ./apps/oh-my-pi-extension --plan
```

Or add the package directory to the `extensions` list in Oh My Pi's configuration:

```yaml
extensions:
  - /path/to/plannotator/apps/oh-my-pi-extension
```

The extension's browser assets are built by the repository command below. If the assets are unavailable, the commands report the repair command instead of opening a partial UI:

```bash
cd plannotator
bun install
bun run build:omp
```

## Native plan review

Oh My Pi first resolves and validates the active `local://` plan artifact, then calls its native `Plan mode - next step` review. Plannotator intercepts that exact review only when the native choices include `Approve and execute`:

- **Approve and execute** in the browser returns the native choice `Approve and execute`. Oh My Pi exits plan mode, restores its tools, and dispatches execution.
- **Send feedback / Refine plan** returns the native choice `Refine plan` and sends the browser feedback through Oh My Pi's native feedback callback.
- If the browser cannot start or the opener fails, the extension warns once and invokes the original native review with the original receiver and arguments.

The bridge does not take ownership of plan files, plan-mode state, execution, or tool scope. It also does not expose a plan-mode event action; `plan-mode` requests through the event API are explicitly unavailable in this host.

## Commands

### Code review

Review the current changes:

```text
/plannotator-review
```

Review a pull or merge request URL:

```text
/plannotator-review https://github.com/owner/repo/pull/123
/plannotator-review https://gitlab.com/owner/repo/-/merge_requests/123
```

Force a provider for local changes:

```text
/plannotator-review --git
/plannotator-review --gitbutler
```

`--git` selects Plannotator's ordinary Git provider. `--gitbutler` requires the GitButler provider. The browser result is sent back as an Oh My Pi follow-up message. Approval uses the `oh-my-pi` review prompt runtime; annotated findings include the normal verification-only review suffix.

### Direct annotation

Annotate a markdown, text, supported configuration, or HTML file; a folder; or a URL:

```text
/plannotator-annotate README.md
/plannotator-annotate docs/ --gate
/plannotator-annotate docs/guide.html --markdown
/plannotator-annotate https://example.com/spec --no-jina
```

The command preserves tolerant one-target resolution: surrounding words are allowed when exactly one target exists, while ambiguous or unresolved targets and unknown flags are reported instead of guessed. `--gate` enables Approve / Send Annotations / Close. `--hook` implies `--gate`; `--json` is accepted for host parity; `--markdown` converts local HTML to markdown; `--render-html` keeps the raw HTML view; and `--no-jina` disables Jina Reader for URL conversion. HTML, folder, URL, supported-file validation, and the 2 MiB file limit are the same as the other direct annotation hosts.

Non-empty annotations become an Oh My Pi follow-up message using the `oh-my-pi` annotation prompt runtime. Close, no-feedback, and approval notifications remain local UI notifications; no empty follow-up is injected.

### Last assistant message

Annotate the newest assistant message on the active Oh My Pi session branch:

```text
/plannotator-last
/plannotator-last --gate
```

The browser receives the newest assistant message plus a picker containing up to the 25 most recent assistant messages when more than one exists. Feedback uses the `oh-my-pi` message prompt runtime and is delivered as a follow-up. If the active branch has no assistant message, the command reports exactly `No assistant message found in session.`. This adapter does not reroute to another session or add stale-entry quote anchors.

## Ask AI, models, and authentication

The extension passes the session's authenticated Oh My Pi model catalog to plan review, code review, direct annotation, last-message annotation, and event-started browser sessions. For plan review, the scoped plan-session models are used; otherwise the session's enabled model list is used and the current model is marked as the default. Ask AI therefore shows only models available to that Oh My Pi session.

Ask AI runs through a spawned `omp --mode rpc` process with the `omp` executable. The browser receives model IDs and labels only; it never receives provider credentials or Oh My Pi auth metadata. The spawned process owns authentication and reads the normal Oh My Pi configuration and inherited environment. Host model selection limits what the UI can request; it does not copy or expose credentials to Plannotator.

## `plannotator-events` API

The extension listens on `plannotator:request`. A request has this envelope:

```ts
import type {
  PlannotatorAction,
  PlannotatorResponse,
} from "@plannotator/oh-my-pi-extension/plannotator-events";

const request = {
  requestId: "request-123",
  action: "code-review",
  payload: { cwd: "/workspace/project" },
  respond(response: PlannotatorResponse<unknown>) {
    // Handle the response in the caller.
  },
};
```

The supported actions are:

| Action | Result timing | Behavior |
|---|---|---|
| `plan-review` | Asynchronous | Returns `{ status: "handled", result: { status: "pending", reviewId } }`; completion is emitted on `plannotator:review-result` and can be recovered with `review-status`. |
| `review-status` | Synchronous | Reads the persisted `pending`, `completed`, or `missing` status for a `reviewId`. |
| `code-review` | Synchronous | Opens code review and returns the browser decision. |
| `annotate` | Synchronous | Opens file, folder, HTML, or URL annotation and returns the decision. |
| `annotate-last` | Synchronous | Opens annotation for supplied payload text or the active branch's newest assistant message and returns the decision. |
| `archive` | Synchronous | Opens the plan archive and returns `{ opened: true }` after the archive surface is available. |
| `plan-mode` | Unavailable | Oh My Pi owns native plan mode; the response is `{ status: "unavailable", error: "Plan mode control is not available in this session." }`. |

Event annotation actions return their browser decision and never inject feedback into the conversation; callers decide how to handle that result. Malformed requests are ignored. Before a session-start context exists, actions that need a host context return `unavailable`. Responses use the common shape `{ status: "handled", result }`, `{ status: "unavailable", error }`, or `{ status: "error", error }`.

## Prompt overrides

This extension uses the `oh-my-pi` runtime identity. To customize only its messages, use runtime-specific overrides under the relevant prompt section:

```json
{
  "prompts": {
    "review": {
      "runtimes": {
        "oh-my-pi": {
          "approved": "Review complete. Continue with the next Oh My Pi step."
        }
      }
    },
    "annotate": {
      "runtimes": {
        "oh-my-pi": {
          "messageFeedback": "Apply these message notes:\n\n{{feedback}}"
        }
      }
    }
  }
}
```

Use the same `prompts.<section>.runtimes.oh-my-pi` shape for `plan`, `review`, and `annotate` fields. Generic overrides still apply when no runtime-specific value is set.
