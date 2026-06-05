---
name: mobx-keystone-expert
description: Guidelines, rules, and best practices for MobX and mobx-keystone state management. Use when reviewing, refactoring, or designing code that involves MobX observables, keystone models, stores, observer components, snapshots, patches, or undo/redo. Applies to code review, architecture planning, and refactoring tasks.
---

# MobX + Keystone Expert

Rules, restrictions, and practices for working with MobX and mobx-keystone in this project. Applies to **Review**, **Refactoring**, and **Design (Planning)** tasks.

For extended documentation, code examples, and source links see [reference.md](reference.md).

---

## Project Architecture

This project uses a **dual-layer** state management pattern:

| Layer         | Library                       | Purpose                                            | Location                             |
| ------------- | ----------------------------- | -------------------------------------------------- | ------------------------------------ |
| Domain models | `mobx-keystone`               | Pipeline spec tree (snapshotable, undoable)        | `src/models/componentSpec/entities/` |
| UI stores     | Plain MobX (`makeObservable`) | Editor UI state (selection, navigation, clipboard) | `src/routes/EditorV2/store/`         |

- `observer` from `mobx-react-lite` on all reactive components.
- Stores are singletons imported directly -- no MobX `Provider`/`inject` pattern.
- `SpecProvider` is a plain React context for passing the current `ComponentSpec` into ReactFlow nodes.

---

## 1. mobx-keystone Model Rules

### Model Declaration

- Decorate every model with `@model("namespace/Name")` using a globally unique string ID.
- Extend `Model({...})` for base models; use `ExtendedModel(Base, {...})` for inheritance.
- Use `prop<T>()` for observable/snapshotable state. Use `idProp` for entity identity.
- Use factory defaults for non-primitive props: `prop<T[]>(() => [])`.
- Never declare a `constructor`. Use `onInit` for eager setup, `onAttachedToRootStore` for side effects.

### Actions and Computed

- Use `@modelAction` for **all** state mutations on model props -- never mutate outside actions.
- Use `@computed` (imported from `mobx`) for derived model state.
- Use `@modelFlow` with `_async` / `yield* _await(...)` for async actions. Raw `async/await` loses action context after the first `await`.
- Use `withSetter()` on props to auto-generate setter actions and reduce boilerplate.

### Tree Structure

- A non-primitive node can have **only one parent**. Assigning it to a second parent throws.
- Use `valueType: true` in model options when a model should be auto-cloned on attachment (value semantics).
- Use keystone **references** when multiple tree locations need to point to the same entity.
- Use `detach(node)` to remove a node from its parent before re-attaching elsewhere.

### Root Stores and Lifecycle

- Register root stores with `registerRootStore(spec)` and clean up with `unregisterRootStore(spec)`.
- Use `onAttachedToRootStore(rootStore)` for side effects (reactions, subscriptions). Return a disposer.
- `getRoot(node)` returns the node itself when detached -- prefer `getRootStore(node)` and guard for `undefined`.

---

## 2. Plain MobX Store Rules

- Use `makeObservable(this, {...})` with **explicit** annotations: `observable`, `action`, `computed`.
- Use `observable.ref` for values that should be tracked by reference only (e.g. external objects).
- Use `observable.shallow` for collections where deep observation is unnecessary.
- **Every** getter that derives state must be annotated `computed`. Missing annotations means MobX won't cache/track the value.
- **Every** method that mutates state must be annotated `action`.
- After `await`, wrap state updates in `runInAction(() => { ... })`.

---

## 3. React Integration

### observer

- Wrap **every** component that reads observable data in `observer()` from `mobx-react-lite`.
- `observer` already applies `React.memo` -- never double-wrap with `memo()`.
- Use named function expressions for proper DevTools display: `observer(function MyComponent() {...})`.

### Dereferencing

- Dereference observables **as late as possible**: pass the observable object down, read properties in the leaf `observer` component.
- Never copy observable values into React local state (`useState`) or class fields -- read them directly from the store/model.
- If you must pass data to a non-observer component, convert to plain values first (spread, `toJS`, or read primitives).

### Effects

- Set up MobX `reaction`/`autorun` inside `useEffect` and return the disposer for cleanup.
- Prefer `reaction` over `autorun` when you need to react to a specific observable expression.
- Do not combine `useEffect` dependency arrays with MobX tracking -- let MobX handle the reactivity, keep the dependency array empty (or with only non-observable deps).

---

## 4. Snapshots and Serialization

- `getSnapshot()` wraps model props with `$` metadata. **Do not** use it for undo/patch persistence -- it changes patch format and breaks redo. See `src/services/undoHistoryStorage.ts`.
- To clone raw MobX data without observables, use `JSON.parse(JSON.stringify(data))`.
- For spec serialization/deserialization, use the project's `JsonSerializer` / `YamlDeserializer`, not raw `getSnapshot` / `fromSnapshot`.

---

## 5. Undo / Redo

- Set up undo tracking via `undoMiddleware(spec, store)` on the registered root spec.
- Group related mutations: `undoManager.withGroup("label", () => { ... })`.
- Persist/restore undo history carefully -- see `undoHistoryStorage.ts` for format constraints around avoiding `getSnapshot()`.

---

## 6. Anti-Patterns to Flag

Use this checklist during **review** and **refactoring**:

| Anti-pattern                                          | Why it's wrong                                  | Fix                                                         |
| ----------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Mutating model state outside `@modelAction`           | Breaks action protection, undo, patches         | Wrap in `@modelAction` or use `withSetter()`                |
| Missing `observer` on component reading observables   | Component won't re-render on changes            | Add `observer()` wrapper                                    |
| `getSnapshot()` for undo history persistence          | `$` wrapping breaks redo patches                | Clone via `JSON.parse(JSON.stringify(...))`                 |
| Reading `ref.current` during render                   | Violates React Compiler rules and MobX tracking | Read refs in effects/callbacks only                         |
| Missing `computed` annotation on derived getters      | MobX won't cache; re-runs every access          | Add `computed` to `makeObservable` map                      |
| Storing derived data as `observable`                  | Redundant state; risk of staleness              | Convert to `@computed` getter                               |
| Forgetting to dispose `reaction`/`autorun`            | Memory leak; stale subscriptions                | Return disposer from `useEffect` or `onAttachedToRootStore` |
| Passing observable objects to non-observer components | Child won't react to changes                    | Spread/convert to plain data, or wrap child in `observer`   |
| Using `as` type assertions on model data              | Unsafe; hides type mismatches                   | Use type guards, proper typing, or schema validation        |
| Double-wrapping `observer` + `React.memo`             | Redundant; `observer` already memos             | Remove the `memo()` wrapper                                 |
| Using `async/await` in `@modelAction`                 | Action context lost after first `await`         | Use `@modelFlow` with `_async`/`_await`                     |
| Declaring `constructor` in a keystone model           | Breaks model initialization                     | Use `onInit` or `onAttachedToRootStore`                     |
| Assigning same node to two parents                    | Throws at runtime; violates tree rules          | Clone node or use references                                |

---

## 7. Design Checklist

When **planning** new features that involve state, answer these questions:

1. **Domain vs UI state?**
   - Domain data (persisted, serialized, shared) -> mobx-keystone `Model` in `src/models/`
   - UI-only state (selection, hover, panel visibility) -> plain MobX store in `src/routes/EditorV2/store/`

2. **Needs undo/redo?**
   - Yes -> must live inside the keystone tree (covered by `undoMiddleware`)
   - No -> can be either layer

3. **Needs snapshots/serialization?**
   - Yes -> use keystone `prop<T>()` (auto-snapshotable)
   - No -> plain class property or `@observable`

4. **Needs persistence across page reload?**
   - Consider `onAttachedToRootStore` + `reaction` to localStorage/IndexedDB

5. **Shared between components?**
   - Store singleton (import directly) or React context
   - Avoid prop-drilling observable objects through many layers

6. **Cross-references between entities?**
   - Use keystone references, not direct object pointers
   - Direct pointers violate single-parent tree rule

7. **Async operations?**
   - In keystone model: `@modelFlow` + `_async`/`_await`
   - In plain MobX store: `async` method annotated `action`, with `runInAction` after `await`
   - For server state: prefer Tanstack Query (existing project pattern)

---

## 8. Refactoring Guidelines

When refactoring MobX/Keystone code:

- **Do not break snapshot format.** Changing `prop` names or removing props changes serialization. Use `fromSnapshotProcessor` for migrations.
- **Do not change `@model()` IDs.** They are used for deserialization and must be stable.
- **Extract repeated observable patterns** into shared models or mixins (`defineModelMixin`, `composeMixins`).
- **Replace manual setter actions** with `prop<T>().withSetter()` to reduce boilerplate.
- **Move computed values into models/stores** instead of computing in components. Derived state belongs close to its source data.
- **Consolidate scattered `runInAction` calls** by wrapping the entire async handler in an action when possible.
- **Ensure all `makeObservable` annotations are complete** -- missing `computed` on getters is a common oversight.
