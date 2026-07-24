# Architecture

`lgtm` uses layered business domains with mechanically enforced dependency boundaries.
The filesystem is the architecture map. Put code in the domain and layer that owns its
behavior, then let the linter verify every dependency edge.

## Source layout

```text
src/
  app/
  domains/
    review/
      types/
      config/
      repo/
      service/
      runtime/
      ui/
      index.ts
    settings/
      types/
      config/
      repo/
      service/
      runtime/
      ui/
      index.ts
    setup/
      types/
      config/
      repo/
      service/
      runtime/
      ui/
      index.ts
  providers/
  tooling/
  utils/
  define.ts
```

Only create a layer directory when the domain has code for it. Every domain exposes a
deliberate public API from `index.ts`. Cross-domain and app imports use that API instead
of importing domain internals.

Platform-specific surfaces may expose a narrower layer API, such as
`domains/review/ui/index.ts`. Keep the domain root API safe to load in every supported
runtime; browser-only exports belong in the UI entrypoint.

Browser UI uses `ui/index.ts` as a runtime-safe public entrypoint. This keeps the universal
domain API importable by Node apps without evaluating browser globals.

## Responsibilities

| Location    | Responsibility                                                                       |
| ----------- | ------------------------------------------------------------------------------------ |
| `app`       | Executable composition, transport parsing, dependency wiring, and result translation |
| `types`     | Data contracts, schemas, parsers, discriminated unions, and data-shaped errors       |
| `config`    | Defaults, constants, static policies, and supported values                           |
| `repo`      | Persistence, external data acquisition, serialization, Git, and SSH access           |
| `service`   | Stateless use cases, domain transformations, and business rules                      |
| `runtime`   | Stateful orchestration, servers, timers, caches, routes, and long-running operations |
| `ui`        | React or Ink components, hooks, view mapping, and presentation behavior              |
| `providers` | Domain-independent filesystem, process, browser, network, and clock access           |
| `utils`     | Pure domain-independent code with at least two real consumers                        |
| `tooling`   | Architecture enforcement and development tooling; production code cannot import it   |

External data is parsed at `repo`, `runtime`, or `app` boundaries before it enters domain
behavior. Prefer schemas and parsed domain values over repeated validation.

## Dependency rules

Within a domain, a layer may import itself and the layers listed below:

| Source    | Allowed targets                                                     |
| --------- | ------------------------------------------------------------------- |
| `types`   | `types`, `utils`                                                    |
| `config`  | `types`, `config`, `utils`                                          |
| `repo`    | `types`, `config`, `repo`, `providers`, `utils`                     |
| `service` | `types`, `config`, `repo`, `service`, `providers`, `utils`          |
| `runtime` | `types`, `config`, `service`, `runtime`, `providers`, `utils`       |
| `ui`      | `types`, `config`, `service`, `runtime`, `ui`, `providers`, `utils` |

Additional rules:

- Cross-domain imports use `domains/<domain>/index.ts` or a deliberate layer `index.ts`.
- `app` imports domain public APIs, providers, utilities, and `define.ts`.
- Providers import only providers, utilities, `define.ts`, and external packages.
- Utilities import only utilities, `define.ts`, and external packages.
- Tooling imports only tooling, utilities, and external packages.
- Domains and providers never import `app`.
- Production code never imports `tooling`.
- Domain public APIs expose stable contracts and operations, not every implementation.

`src/tooling/architecture/architecture.ts` is the executable source of truth for these
rules. Oxlint rules and structural tests consume the same model.

## Definition vocabulary

Use helpers that match the owning architectural layer:

- `defineType` for runtime schemas and parsers in `types`.
- `defineConfig` in `config`.
- `defineRepo` in `repo`.
- `defineService` in `service`.
- `defineRuntime` in `runtime`.
- `defineProvider` in `providers`.
- `defineUIComponent` and `defineUIHook` in `ui`.
- `defineService` for pure UI presentation logic and `defineRuntime` for browser I/O in `ui`.
- `defineSingleton` for object definitions in `service`, `runtime`, and `ui`.
- `defineApp` at executable app roots.
- `defineUtil` for shared utility definitions in `utils`.
- Plain TypeScript remains appropriate for type-only declarations.

## Taste invariants

- Production files contain at most 400 meaningful lines.
- Test files contain at most 600 meaningful lines.
- Functions and class methods contain at most 80 meaningful lines.
- Blank and comment-only lines do not count toward these limits.
- Split code by responsibility and layer; avoid generic helper buckets.
- Compound `if` conditions use a descriptive boolean variable.
- Boundary diagnostics include a concrete remediation for the next agent run.
