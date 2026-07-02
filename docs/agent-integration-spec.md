# BuzzQuill × Agents — Integration Spec, Research & Pitch

> **Status: SPEC / RESEARCH — not scheduled for build yet.**
> Deliberately deferred behind a human-first foundation. The AI/agent layer is an
> adapter over an operation layer that must first be excellent as a *human* feature.
> **Do not implement the agent layer until Phase 0 (below) is done beautifully.**
>
> Author: Wright Bagwell · Drafted 2026-07-01 · Model of record for AI: `claude-opus-4-8`

---

## 0. TL;DR

BuzzQuill can become **the live, editable design canvas that plugs into the AI our
users already pay for** — Claude Code, Cursor, Copilot — instead of embedding (and
reselling) its own LLM. The thing that makes this uniquely possible is infrastructure
we *already shipped* for humans: **stable element identity that survives a round-trip,
a faithful SVG import/export, and a single command layer every mutation flows through.**
Those three are exactly what turns "AI generates a thing you can't touch" into "AI and
a human co-edit one shared document."

Strategic bet: **Bring-Your-Own-Agent (BYOA) first** (zero inference cost to us, no "yet
another AI subscription" for the user), with an optional built-in-LLM tier as a pricing
lever. Both are front doors onto **one operation layer** — which is also just a great
human editing primitive. So we build the operation layer for humans first, and the agent
story becomes cheap later.

---

## 1. Pitch (one-pager)

### BuzzQuill — Design at the speed of conversation

**One-liner:** BuzzQuill is a live vector/UI canvas you edit by hand *and* drive with the
AI agent you already use — sketch, hand-tweak, and refine conversationally on the *same*
document, with every AI edit landing in undo like a human one.

**The problem.** Every "AI draws your UI" tool today is a one-way street: you prompt, it
generates, and the moment you hand-edit the result the AI loses the thread — the next
prompt regenerates from scratch and clobbers your changes. People don't want a vending
machine; they want a collaborator they can interrupt, correct, and steer. That loop
doesn't exist yet.

**The insight (and why we already solved the hard part).** True bidirectional editing
needs three things almost nobody has together: stable element identity that survives every
round-trip, a faithful SVG import/export, and a single command layer both human and AI
edits flow through. Without them, human and AI edits drift into two diverging copies.
BuzzQuill was built as a *real* vector editor first, so we already have all three —
stress-tested against 79 MB / 117k-path real-world files. **The AI layer is an adapter on
infrastructure we already ship, not a research bet.** The moat isn't the model; it's the
editable, addressable document underneath it.

**Bring your own agent.** We don't sell inference. The user's own Claude Code / Cursor /
Copilot drives BuzzQuill through a small, schema-validated operation layer (add / move /
style / group). Our marginal cost per AI edit is ~zero; the user pays no new subscription;
and as their agent gets smarter, our tool gets better for free. Being a listed integration
in the agent ecosystem is itself a distribution channel.

**Why it feels different.** Type "sketch a login screen." Drag the button bigger and
recolor it by hand. Select three cards and say "align these and make them consistent." The
AI still sees *your* edited button — because IDs and geometry survived — and touches only
what you asked. It's pair-designing, not prompting.

**What competitors are doing.**

| Who | What they do | The gap |
|---|---|---|
| **tldraw "Make Real"** | Wireframe → generated HTML prototype | One-shot generation; you annotate and *re-generate*, you don't co-edit a persistent model. Bundles (and marks up) inference. |
| **Figma Dev Mode MCP** | Design ↔ code via an external agent (bidirectional) | Validates BYOA — but aimed at *developers* in an IDE, heavyweight, enterprise. Not a lightweight designer/PM mock-up canvas. |
| **v0 / generative-UI** | Prompt → React code | Output is code, not an editable canvas; hand-edits and prompts fight each other. |
| **Excalidraw + AI plugins** | Text → diagram | No stable identity or surgical re-editing; regenerate-and-replace. |

**Our wedge:** everyone else treats AI as a *generator*. We treat it as a *co-editor of a
shared, stably-identified document* — and we let the user bring their own agent. That's the
difference between "AI made me a thing" and "AI and I are making a thing together."

**Why now.** The agent ecosystem (Claude Code, Cursor, Copilot) is exploding and
standardizing on MCP; Figma shipping bidirectional MCP is proof the market believes design
tools should plug into agents. The winners will be the tools with a *clean editable
substrate* to expose — which is precisely our head start.

**The ask.** A short spike to (a) make the operation layer + identity + selection model
beautiful as human features, then (b) expose it to external agents over MCP. Low technical
risk: the hard part (the editable substrate) is done.

---

## 2. Research

### 2.1 The core technical insight
Bidirectional editing requires that the human and the agent mutate the **same
id-addressed model**, and that both paths go through the **same history stack**. BuzzQuill
already has this:

- **Central document model:** `AppState.shapes: ShapeData[]` in `src/core/state.ts` — a
  hierarchical tree derived from, and kept in sync with, the live SVG DOM
  (`rebuildShapesFromDOM`). Not a throwaway scene graph.
- **Stable identity:** every shape has an `id` (`shape-N`, `src/core/state.ts` ~L385) plus
  a human `name` on `data-name`. Id-less imports are auto-assigned ids on rebuild.
- **Single mutation path:** all edits funnel through `AppState` methods and the command
  registry (`src/commands.ts` `COMMANDS[]`), and snapshots flow through
  `src/core/history.ts` (undo/redo, 100 levels).
- **Faithful round-trip:** `importSVGContent` (`src/core/state.ts` ~L2164) /
  `serializeDocumentSVG` preserve ids, defs, namespaces, and arbitrary attributes —
  stress-tested via `test/fixtures.spec.ts`, `test/idless-layers.spec.ts`, `test/corpus.spec.ts`.

**Consequence:** an agent can refer to "`shape-42`" across turns and still be talking about
the same element *after* a human resized and recolored it — because identity and geometry
survive the round-trip. This is the exact property the naive "dump SVG → get SVG back" loop
lacks (IDs churn every turn; manual edits get clobbered).

### 2.2 Landscape (as of mid-2026)
- **tldraw "Make Real"** — draw → GPT-vision → generated HTML; iterate by annotating and
  re-generating. One-way generation, bundled inference. (makereal.tldraw.com)
- **Figma Dev Mode MCP** — bidirectional: agents read design context *and* write native
  Figma layers back. Dev/enterprise-oriented. Strong validation of the BYOA direction.
- **v0 / generative-UI tools** — prompt → framework code; not an editable canvas.
- **WebMCP** (Chrome 146, experimental) — lets a *web page* expose typed tools to an
  *in-browser* agent. Future-relevant, but does **not** cover external hosts like Cursor.

### 2.3 Where the loop can live — three front doors, one substrate
All three are adapters over the same operation layer (§3.2):

- **A. Built-in LLM (in-app chat).** App → Supabase Edge Function proxy (key server-side;
  `*.supabase.co` already CSP-allowed) → Claude → ops applied to `state`. Best in-app
  realtime UX; we pay inference. → **optional paid tier.**
- **B. BYOA / external agent (MCP).** The user's Claude Code / Cursor drives BuzzQuill over
  a remote MCP server that relays to the live tab. Zero inference cost; no new subscription.
  → **primary GTM.**
- **C. Headless/programmatic.** Op layer exposed on `window` for scripting/tests. Substrate
  for A and B.

### 2.4 BYOA connectivity (the CTO's question: "how does Cursor reach a browser tab?")
MCP hosts connect to a **remote MCP server** over Streamable HTTP. Our op layer is the tool
set on that server; the server relays to the live canvas over infra we already have — **no
local install, no CSP change:**

```
Cursor / Claude Code
   │  Streamable HTTP MCP  (user's own BuzzQuill token)
   ▼
BuzzQuill MCP server  ── Supabase Edge Function / CF Worker  (tool implementations)
   │  Supabase Realtime channel, keyed to the user's open doc
   ▼
Live browser tab  ── canvas applies ops through state.ts + history.ts
```

Enablers already in place:
- `wss://*.supabase.co` is **CSP-whitelisted** and Realtime infra + cloud sync (`projects`
  table, `cloud-doc` tracker, debounced autosave) already exist. Browser→Supabase leg needs
  nothing new.
- Agent→server leg is a normal HTTP server; CSP governs only the browser's outbound, so it
  doesn't apply there.
- **Pairing:** user is already signed in (Google/Discord). Mint a token in account settings,
  paste into the MCP config. Standard remote-MCP onboarding.
- **Fallback (zero-backend):** a local companion process speaking stdio↔agent and
  WebSocket↔tab (the Playwright-MCP / browser-tools-MCP pattern). Works, but adds an install
  step. The Realtime relay is preferred.

### 2.5 What the agent reads / writes
- **Read:** a compact structured tree from `state.shapes` (`{id, name, type, bounds, style,
  children}` — same shape the layers panel already flattens), **not** raw SVG (token cost;
  huge files). For layout-sensitive asks, optionally a rendered PNG (`src/ui/export.ts`) for
  vision.
- **Write — coarse:** an SVG fragment → `importSVGContent()`. Good for "from scratch," bad
  for iteration (re-keys ids, clobbers manual edits).
- **Write — fine (the differentiator):** structured operations mapped onto existing state
  methods / commands. Surgical, mergeable, and rides existing undo/redo for free.

### 2.6 Code seams (for whoever builds it later)
| Need | Existing seam |
|---|---|
| Read model → structured summary | `state.shapes` (`src/core/types.ts`); flatten like `src/ui/layers.ts` |
| Vision input | PNG export in `src/ui/export.ts` |
| Coarse write | `importSVGContent()` — `src/core/state.ts` ~L2164 |
| Fine write (ops) | `state.addShape` / `removeShape` / `selectShape` / `findShapeById` + `src/commands.ts` |
| Undo of AI edits | free — mutations already flow through `src/core/history.ts` |
| Network / key custody (tier A) | new Supabase Edge Function proxy — domain already CSP-allowed |
| Relay to live tab (tier B) | Supabase Realtime channel keyed to the open `projects` doc |
| Auth / rate limiting | existing `src/lib/auth.ts` + Supabase RLS |

---

## 3. Spec

### 3.1 Design principles
1. **Human-first.** Every capability the agent uses must first be a great *human* feature.
   The operation layer is a human editing primitive that an agent happens to also call.
2. **One operation layer, many front doors.** Built-in LLM (A), external agent (B), and
   scripting (C) are adapters. Never fork the mutation logic per front door.
3. **Identity is sacred.** Ids are stable within a session; never re-key on a round-trip.
   The `name`/`data-name` field is a first-class, user-editable label — it's also how an
   agent and a human refer to the same thing ("the CTA button").
4. **Everything reversible.** Every op is a history entry. No black-box replacements.
5. **BYOA before built-in.** Ship the external-agent path as the wedge; the built-in LLM is
   a convenience/pricing tier, not the identity of the product.

### 3.2 The operation layer (the asset)
A small, closed, schema-validated set of document mutations — the single surface all three
front doors call, and a clean internal API for human features too:

- `create_shape(type, props) -> id`
- `update_shape(id, props)` (geometry, style, name, visibility, lock)
- `delete_shape(id)`
- `move_shape(id, dx|position)`
- `set_style(id, style)`
- `group(ids) -> id` / `ungroup(id)`
- `align(ids, axis, mode)` / `distribute(ids, axis)`
- `reorder(id, z)` / `reparent(id, parentId)`
- `select(ids)` / `get_selection()`
- `describe_document() -> tree` (compact structured read)
- `render_png() -> image` (vision read)

Requirements: each op is (a) a pure intent that maps onto existing `AppState`/command
methods, (b) a single history entry, (c) individually addressable by `id`, (d) described
with *prescriptive, trigger-conditioned* text when later exposed as an agent tool
("call `align` when the user asks to tidy layout"). This same list is the MCP tool set, the
built-in-LLM tool set, and the `window` scripting API — authored once.

### 3.3 Phasing

> **Phase 0 is the only phase currently greenlit.** It is entirely human-facing and ships
> value with zero AI. Phases 1–3 are documented so we build Phase 0 in a way that makes
> them cheap — not so we start them now.

#### Phase 0 — Human-first foundation *(build this beautifully first)*
Make the substrate excellent as a pure human editing experience. No LLM, no MCP, no network AI.
- **Operation layer as internal API.** Refactor human editing (menus, tools, shortcuts) to
  route through the closed op set in §3.2, so there's one mutation surface. Characterization
  tests around each op.
- **Identity & naming UX.** Make `name` a first-class, inline-editable label in the layers
  panel; guarantee ids are stable across save→reload and never collide. Great rename,
  search-by-name, and "select by name" flows — useful to humans on their own.
- **Selection model polish.** Multi-select, selection as an explicit, inspectable object;
  "operate on selection" verbs (align/distribute/group/restyle) that read beautifully.
- **Undo/redo confidence.** Every op is one clean, labeled history entry; verify grouped
  ops undo atomically.
- **Structured document read.** A clean `describe_document()` that mirrors the layers tree
  (drives a better layers panel / outline view *today*, agent summary *later*).
- **Success:** a power user can do fast, precise, fully-reversible editing entirely by
  hand; the op layer, identity, naming, and selection are so clean that bolting an agent on
  is "just another caller."

#### Phase 1 — BYOA / external agent (MCP)  *(deferred)*
- Remote MCP server exposing the §3.2 ops as tools; Supabase Realtime relay to the live tab;
  account-minted token pairing (§2.4). Prescriptive tool descriptions + MCP resources
  (document summary) + prompts.
- **Success:** a user drives BuzzQuill from Claude Code / Cursor with their own subscription;
  agent edits and manual edits interleave on one document; all reversible. Our inference
  cost: zero.

#### Phase 2 — Co-editing UX & realtime polish  *(deferred)*
- Selection-as-prompt-target, diff/patch animation of incoming ops, two-way annotations,
  a constrained wireframe vocabulary via the symbol registry (`src/core/symbol-registry.ts`),
  semantic auto-naming.
- **Success:** the "pair-designing" feel — watching the canvas mutate, pointing via selection.

#### Phase 3 — Optional built-in LLM tier  *(deferred)*
- Supabase Edge Function proxy → Claude (`claude-opus-4-8`; a cheaper tier for high-frequency
  ops) → same op layer. For users with no agent. Per-user rate limiting via existing auth.
- **Success:** non-agent users get in-app conversational editing as a paid convenience;
  agent users still pay us nothing for inference.

### 3.4 Non-goals (for now)
- No embedded LLM in Phase 0. No code generation / export-to-React. No multi-user human
  co-editing (separate track). No WebMCP (revisit when in-browser agents matter).

---

## 4. Open questions / decisions to make later
- **Op granularity:** how coarse can ops be before agents lose surgical control vs. how fine
  before latency/verbosity hurt? (Resolve empirically in Phase 1.)
- **Relay vs. document-only:** does the agent require a *live tab*, or can it edit the
  synced `projects` doc headlessly and reconcile on open? (Live tab = the differentiated UX;
  headless = simpler. Possibly both.)
- **Token/pairing UX:** paste-a-token is fine for devs; is there a slicker OAuth-style handoff
  worth it for the broader ICP?
- **Identity across clean exports:** our TraceCraft/clean exports strip editor ids. For the
  agent loop we must hold the id space constant within a session — confirm no export path
  silently re-keys mid-session.
- **Guardrails:** generative bulk output could exceed `AUTO_ID_MODEL_LIMIT` (20k modeled
  elements). Fine for wireframes; define behavior if an agent emits a pathological document.

---

## 5. Sources
- tldraw "Make Real" — makereal.tldraw.com ; tldraw AI integrations — tldraw.dev/docs/ai
- Figma Dev Mode MCP server — figma.com/blog/introducing-figma-mcp-server
- WebMCP early preview (Chrome 146) — dev.to/axrisi (Chrome WebMCP)
- awesome-generative-ui — github.com/narrowin/awesome-generative-ui
- Internal: `src/core/state.ts`, `src/commands.ts`, `src/core/history.ts`, `src/ui/layers.ts`,
  `src/ui/export.ts`, `src/lib/{auth,supabase,projects,cloud-doc}.ts`; project memory
  (deployment-stack, svg-import-fidelity, paper-core-csp-constraint).
