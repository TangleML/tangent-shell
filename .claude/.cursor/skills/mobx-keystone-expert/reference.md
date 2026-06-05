# MobX + Keystone Reference

Extended documentation, code examples, and source links for the [SKILL.md](SKILL.md).

---

## Sources

- [mobx-keystone documentation](https://mobx-keystone.js.org/)
- [mobx-keystone LLM-optimized docs](https://mobx-keystone.js.org/llms-full.txt)
- [MobX React integration](https://mobx.js.org/react-integration.html)
- [MobX actions](https://mobx.js.org/actions.html)
- [MobX common pitfalls](https://iiunknown.gitbooks.io/mobx-doc/content/best/pitfalls.html)
- [Best practices for MobX with React](https://iconof.com/best-practices-for-mobx-with-react/)
- [DDD with mobx-keystone](https://medium.com/@hoshinokanade0/mobx-keystone-road-to-domain-driven-design-f0b84fb8983)

---

## 1. mobx-keystone Class Model

### Basic model definition

```ts
import { computed } from "mobx";
import { Model, model, modelAction, prop, idProp } from "mobx-keystone";

@model("spec/Task")
class Task extends Model({
  $id: idProp,
  name: prop<string>(),
  description: prop<string | undefined>(undefined),
  inputs: prop<Input[]>(() => []),
}) {
  @modelAction
  setName(name: string) {
    this.name = name;
  }

  @computed
  get inputCount() {
    return this.inputs.length;
  }
}
```

Key points:

- `@model("spec/Task")` -- unique ID across the whole application.
- `idProp` -- entity identity; enables reconciliation and root references.
- `prop<T>(defaultOrFactory)` -- observable and snapshotable.
- `@modelAction` -- required for any mutation of model `prop` data.
- `@computed` -- from `mobx`, for derived/cached values.

### withSetter shorthand

```ts
@model("spec/Output")
class Output extends Model({
  name: prop<string>().withSetter(),
  type: prop<string>("string").withSetter(),
}) {}

// Usage:
output.setName("result");
output.setType("number");
```

### Model inheritance

```ts
import { ExtendedModel } from "mobx-keystone";

@model("spec/SpecialTask")
class SpecialTask extends ExtendedModel(Task, {
  priority: prop<number>(0),
}) {
  @modelAction
  setPriority(p: number) {
    this.priority = p;
  }
}
```

Always use `ExtendedModel`, never raw `extends Model(...)` for subclasses.

### Lifecycle hooks

```ts
@model("spec/ComponentSpec")
class ComponentSpec extends Model({
  tasks: prop<Task[]>(() => []),
}) {
  onAttachedToRootStore() {
    const disposer = reaction(
      () => getSnapshot(this),
      (sn) => saveToStorage(sn),
      { fireImmediately: true },
    );
    // Return disposer -- runs when detached or root store unregistered
    return () => {
      disposer();
    };
  }
}
```

- `onInit()` -- fires immediately on creation. Use sparingly.
- `onAttachedToRootStore(rootStore)` -- fires when node joins a root store tree. Best place for reactions/effects.
- Returned disposer runs on detach. Always dispose subscriptions.

### Root store registration

```ts
import {
  registerRootStore,
  unregisterRootStore,
  isRootStore,
} from "mobx-keystone";

const spec = deserializer.deserialize(data);
registerRootStore(spec);

// Cleanup:
if (isRootStore(spec)) {
  unregisterRootStore(spec);
}
```

---

## 2. Async Actions (modelFlow)

```ts
import { Model, model, modelFlow, _async, _await, prop } from "mobx-keystone";

@model("myApp/DataStore")
class DataStore extends Model({
  items: prop<Item[]>(() => []),
  loading: prop(false),
}) {
  @modelFlow
  fetchItems = _async(function* (this: DataStore) {
    this.loading = true;
    try {
      const data = yield* _await(api.getItems());
      this.items = data;
    } finally {
      this.loading = false;
    }
  });
}
```

Why not `async/await`:

- After the first `await`, execution resumes outside the action context.
- MobX will throw "state modified outside action" errors.
- `@modelFlow` + generator keeps the full call inside action protection.

---

## 3. Plain MobX Store Pattern

```ts
import { makeObservable, observable, action, computed } from "mobx";

class EditorStore {
  selectedNodeId: string | null = null;
  hoveredNodeId: string | null = null;

  constructor() {
    makeObservable(this, {
      selectedNodeId: observable,
      hoveredNodeId: observable,
      setSelectedNode: action,
      setHoveredNode: action,
      hasSelection: computed,
    });
  }

  setSelectedNode(id: string | null) {
    this.selectedNodeId = id;
  }

  setHoveredNode(id: string | null) {
    this.hoveredNodeId = id;
  }

  get hasSelection() {
    return this.selectedNodeId !== null;
  }
}

export const editorStore = new EditorStore();
```

### observable modifiers

```ts
makeObservable(this, {
  items: observable, // deep -- tracks nested property changes
  itemsShallow: observable.shallow, // tracks add/remove, not nested changes
  externalRef: observable.ref, // tracks reference identity only
});
```

Use `observable.ref` for values like `UndoManager` instances or external objects where deep tracking is unneeded and expensive.

### Async in plain stores

```ts
import { runInAction } from "mobx";

class MyStore {
  data: Item[] = [];
  loading = false;

  constructor() {
    makeObservable(this, {
      data: observable,
      loading: observable,
      fetchData: action,
    });
  }

  async fetchData() {
    this.loading = true; // OK -- inside action-annotated method
    try {
      const result = await api.getData();
      runInAction(() => {
        // Required -- after await, action context is lost
        this.data = result;
        this.loading = false;
      });
    } catch {
      runInAction(() => {
        this.loading = false;
      });
    }
  }
}
```

---

## 4. React Integration

### observer component

```ts
import { observer } from "mobx-react-lite"

export const TaskNode = observer(function TaskNode({ task }: { task: Task }) {
  return (
    <div>
      <span>{task.name}</span>
      <span>{task.inputCount} inputs</span>
    </div>
  )
})
```

- Named function expression gives proper DevTools display name.
- `observer` auto-applies `React.memo` -- do not add `memo()` on top.

### Late dereferencing

```ts
// WRONG -- primitive is copied, component won't update
<TaskLabel name={task.name} />

// RIGHT -- pass the observable object, dereference inside observer
<TaskLabel task={task} />

const TaskLabel = observer(function TaskLabel({ task }: { task: Task }) {
  return <span>{task.name}</span>  // reads observable inside observer
})
```

### Effects with MobX

```ts
import { useEffect } from "react";
import { reaction, autorun } from "mobx";

function useAutoSave(spec: ComponentSpec) {
  useEffect(() => {
    const disposer = reaction(
      () => getSnapshot(spec),
      (snapshot) => saveToBackend(snapshot),
      { delay: 1000 },
    );
    return disposer; // cleanup on unmount
  }, [spec]);
}
```

### Passing observables to non-observer components

```ts
// Third-party component that is NOT an observer
<GridRow data={{
  title: todo.title,    // read primitives here
  done: todo.done,
}} />

// Or use toJS:
import { toJS } from "mobx"
<GridRow data={toJS(todo)} />
```

---

## 5. Snapshots and Patches

### getSnapshot

```ts
import { getSnapshot } from "mobx-keystone";

const snapshot = getSnapshot(spec);
// snapshot is a plain JS object with $modelType and $ metadata
```

**Warning**: `getSnapshot()` transforms model data by wrapping props in `$`. This changes the shape of patches. In this project, undo history persistence avoids `getSnapshot()` because it breaks redo when patches contain model snapshots.

### Snapshot processors

```ts
@model("spec/MyModel")
class MyModel extends Model(
  {
    _version: prop(2),
    firstName: prop<string>(),
    lastName: prop<string>(),
  },
  {
    fromSnapshotProcessor(sn) {
      if (sn._version === 1) {
        const [firstName, lastName] = sn.fullName.split(" ");
        return { _version: 2, firstName, lastName };
      }
      return sn;
    },
  },
) {}
```

Use `fromSnapshotProcessor` for backwards-compatible deserialization when changing model shape.

---

## 6. Undo / Redo Middleware

```ts
import { undoMiddleware } from "mobx-keystone";

const undoManager = undoMiddleware(spec);

// Undo/redo
undoManager.undo();
undoManager.redo();
undoManager.canUndo; // boolean
undoManager.canRedo; // boolean

// Group multiple mutations into one undo step
undoManager.withGroup("move nodes", () => {
  node1.setPosition(newPos1);
  node2.setPosition(newPos2);
});
```

### Undo history persistence caveat

From `src/services/undoHistoryStorage.ts`:

> We deliberately avoid `getSnapshot()` here because it transforms model snapshots embedded in patch values (wraps props in `$`), which breaks redo when those patches are later applied. Instead we deep-clone the raw events via JSON round-trip to strip MobX observables while preserving the original format.

```ts
// Correct: clone via JSON round-trip
const cloned = JSON.parse(JSON.stringify(rawUndoEvents));

// Wrong: using getSnapshot on undo events
const broken = getSnapshot(undoEvents); // changes patch format
```

---

## 7. Tree Rules

mobx-keystone enforces a strict tree structure:

1. **Single parent**: A non-primitive node can be a child of at most one parent.
2. **No cycles**: The tree cannot contain cycles.
3. **Primitives are copied**: `string`, `number`, `boolean`, `null`, `undefined` follow normal JS value semantics.
4. **Value types**: Models with `{ valueType: true }` are auto-cloned on attachment (act like primitives).

```ts
// This throws -- someArray already has a parent
someModel.setArray(someArray);
someOtherModel.setArray(someArray); // Error!

// Fix: clone or use references
someOtherModel.setArray([...someArray]);
```

### References

Use keystone references when multiple parts of the tree need to point to the same entity:

```ts
import { rootRef } from "mobx-keystone";

const taskRef = rootRef<Task>("spec/TaskRef");

// In a model:
@model("spec/Binding")
class Binding extends Model({
  sourceTaskRef: prop<Ref<Task>>(),
}) {}
```

---

## 8. Domain-Driven Design with Keystone

From [DDD with mobx-keystone](https://medium.com/@hoshinokanade0/mobx-keystone-road-to-domain-driven-design-f0b84fb8983):

### Entities

Each `@model` node is an entity. The `@model("namespace/Name")` ID serves as the type identity; `idProp` serves as the instance identity.

### Value Objects

Keystone treats all nodes as entities by default. For value semantics:

- Use `{ valueType: true }` to auto-clone on attachment.
- Or define no mutation actions (immutable by convention) and use factory methods.

### Aggregate Roots

The `registerRootStore` concept maps to the DDD aggregate root. The outer layer interacts through the root, and `onAttachedToRootStore` is the lifecycle boundary.

### Encapsulation

- Model actions (`@modelAction`) are the only way to mutate state.
- Give actions **meaningful domain names** (not just `setX`): `completeTask()`, `addBinding()`, `removeInput()`.
- Derived data lives in `@computed` getters with domain semantics: `get isValid()`, `get connectedTasks()`.

### Bounded Contexts

Multiple root stores are legitimate in mobx-keystone, mapping to multiple bounded contexts in DDD. Each root store owns its subtree and lifecycle independently.

---

## 9. Common Pitfalls (from MobX docs)

### Array.isArray returns false for observable arrays (MobX 4/5)

In MobX 6+ with Proxy support this is fixed. But if passing to external code that checks `Array.isArray`, use `.slice()` first.

### Observable object property assignment

MobX observable objects (non-model) do not detect new property assignments that weren't declared observable. Use `extendObservable` or observable Maps for dynamic keys.

### Computed values run more often than expected

If a computed is not observed by any reaction/observer, it evaluates lazily on every access (no caching). Once observed, it caches and only re-evaluates when dependencies change.

### Actions are untracked

Observables read inside an action are **not** tracked as dependencies. This is by design -- actions modify state, they don't derive from it.

### Always dispose reactions

`autorun` and `reaction` hold references to all observables they track. If not disposed, they prevent garbage collection of both the reaction and the observables.

```ts
// In a React component:
useEffect(() => {
  const disposer = autorun(() => {
    console.log(store.value)
  })
  return disposer
}, [])

// In a keystone model:
onAttachedToRootStore() {
  const disposer = reaction(
    () => this.tasks.length,
    (count) => console.log(`${count} tasks`)
  )
  return () => disposer()
}
```
