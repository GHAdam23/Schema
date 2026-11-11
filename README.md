# Schema

Lightweight AV / network schematic editor (Chrome / Edge). See [SPEC.md](SPEC.md) for features, phases and design decisions.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

`window.__schema` exposes the store, actions and exporters for debugging / automated smoke tests.
