# Data and trust boundaries

AgentSpace stores a person's workspace locally and lets configured agents request bounded context and propose changes. Its safeguards control operations through the application. They do not replace the operating system's protection of local files or control an external agent host.

## Accepted work has one authority

Managed text, typed values, relationships, immutable revisions and operation receipts live in the same transactional SQLite core. Native UI, CLI and MCP use that core. Human saves are direct; agent mutations are proposals by default. Review checks the candidate, expected revision, current policy and current grant before applying a change.

Repeated operation keys recover the original recorded result. The current proposal status is a separate observation. Conditional undo checks the current revision and refuses to overwrite later work. Neither a successful save nor a human knowledge-review mark establishes that a statement is factually true.

## Agent access is explicit

A configured client is bound to a selected space, instance and grant. The core rechecks access on each call and continuation. Object grants cover those objects and their retained history; links do not extend that scope. Creation of new notes or records requires a separate enablement on a whole-space proposal grant.

The token is returned once when a grant is issued. The database retains its hash. A copied client configuration contains the token and should be handled as an access credential. A client label is a configured label, not verified identity. Revocation prevents subsequent authorized calls; it cannot recall material already supplied to a client.

AgentSpace does not require a model provider. If a person connects an external agent, that host receives the material its tools request within the grant. The host's processing and provider settings remain outside AgentSpace.

## The renderer has a narrow boundary

The desktop renderer is sandboxed with context isolation and without Node integration. The preload exposes named methods only. Main-process handlers independently validate the sender/frame, local origin, strict input schema and applicable space binding. It does not expose arbitrary paths, SQL, shell execution or a general IPC method.

The application serves a fixed local asset set and denies renderer navigation, new windows and permission requests. Markdown preview skips active HTML and does not load remote images. External HTTP(S) links require a user action and native dispatch. Imported text and instructions are content, not trusted application commands.

## Visibility describes observed events

The workspace can show declared purpose and reasons, exact reference revisions, prepared tool results, proposals and committed changes. A prepared result is not proof of host receipt, model understanding or task completion. No private model chain of thought is captured or promised.

## Local file protection

Spaces and access-bearing application preferences use private local permissions where supported. The database is not encrypted by AgentSpace. Protect the space and any copies with the operating system's account, disk and backup controls. External asset references point to files or directories; keeping a reference does not copy those external bytes into the workspace.

The supported boundary assumes files are accessed through the core. Another program with the same operating-system access can alter or copy them directly. Network filesystems, arbitrary database writers, power-cut durability and platform behavior that has not been exercised are not covered by the current verification claims.

See [architecture](ARCHITECTURE.md), [desktop behavior](DESKTOP.md) and [verification evidence](TESTING.md) for the implemented mechanisms and their tested limits. Report problems with a minimal synthetic reproduction; remove tokens, personal content and private local paths before sharing diagnostics.
