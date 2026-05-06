# Design: `atlas-create-paid-cluster` MCP Tool

**Date:** 2026-05-06
**Status:** Approved

---

## Overview

Add a new MCP tool `atlas-create-paid-cluster` that creates a dedicated (paid) MongoDB Atlas cluster. It distinguishes itself from the existing `atlas-create-free-cluster` by supporting paid tiers (M10+), configurable cloud providers, regions, instance sizes, and all three cluster topologies: replica set, sharded, and geo-sharded.

**Tool description:**
> "Create a dedicated (paid) MongoDB Atlas cluster. Supports replica set, sharded, and geo-sharded topologies on AWS, Azure, or GCP with configurable region and instance tier."

---

## File Location

```
src/tools/atlas/create/createPaidCluster.ts
```

Registered via one added line in `src/tools/atlas/tools.ts`:

```ts
export { CreatePaidClusterTool } from "./create/createPaidCluster.js";
```

---

## Tool Class Shape

```ts
export class CreatePaidClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-paid-cluster";
    static operationType: OperationType = "create";
    // category inherited from AtlasToolBase: "atlas"
    public description = "Create a dedicated (paid) MongoDB Atlas cluster. ...";
    public argsShape = { ... };
    protected async execute(args): Promise<CallToolResult> { ... }
}
```

`AtlasToolBase` already provides `this.apiClient`, `resolveTelemetryMetadata` (extracts `projectId`), and formatted error handling for 401/402/403. No overrides needed.

---

## Inputs (`argsShape`)

| Param | Zod type | Required | Default | Description |
|---|---|---|---|---|
| `projectId` | `AtlasArgs.projectId()` | yes | — | `"ID of the Atlas project to create the cluster in"` |
| `name` | `AtlasArgs.clusterName()` | yes | — | `"Name of the cluster"` |
| `clusterType` | `z.enum(["REPLICASET","SHARDED","GEOSHARDED"])` | no | `"REPLICASET"` | `"Type of cluster: REPLICASET (default), SHARDED, or GEOSHARDED"` |
| `provider` | `z.enum(["AWS","AZURE","GCP"])` | no | `"AWS"` | `"Cloud provider: AWS (default), AZURE, or GCP"` |
| `region` | `AtlasArgs.region().optional()` | no | provider-dependent | `"Cloud region to deploy the cluster in. Defaults to US_EAST_1 for AWS, US_EAST_2 for AZURE, and CENTRAL_US for GCP"` |
| `tier` | `z.enum(["M10","M20","M30","M40","M50","M60","M80","M140","M200","M300"])` | no | `"M10"` | `"Instance size for cluster nodes, e.g. M10 (default), M20, M30"` |
| `numShards` | `z.number().int().min(1).max(12)` | no | `2` | `"Number of shards for SHARDED or GEOSHARDED clusters. Ignored for REPLICASET. Defaults to 2"` |

Region validation is delegated to the Atlas API — invalid region names will surface as `ApiClientError` and be formatted by `AtlasToolBase.handleError`.

---

## Execute Logic

Steps executed in order:

### 1. Resolve region default
If `region` is not supplied by the caller, derive it from `provider`:
- `AWS` → `US_EAST_1`
- `AZURE` → `US_EAST_2`
- `GCP` → `CENTRAL_US`

### 2. Build `replicationSpecs`
Construct a base spec entry:
```ts
const baseSpec = {
    zoneName: "Zone 1",
    regionConfigs: [{
        providerName: provider,
        regionName: resolvedRegion,
        electableSpecs: { instanceSize: tier, nodeCount: 3 },
        priority: 7,
    }],
};
```

Apply topology branching:
- `REPLICASET` → `replicationSpecs = [baseSpec]`
- `SHARDED` / `GEOSHARDED` → `replicationSpecs = Array.from({ length: numShards }, () => ({ ...baseSpec }))`

### 3. Add caller IP to access list
```ts
await ensureCurrentIpInAccessList(this.apiClient, projectId);
```

### 4. Create cluster
```ts
await this.apiClient.createCluster({
    params: { path: { groupId: projectId } },
    body: {
        name,
        clusterType,
        replicationSpecs,
        terminationProtectionEnabled: false,
    } as unknown as ClusterDescription20240805,
});
```

### 5. Return success message
Confirm cluster name, type, tier, provider, and resolved region. For SHARDED/GEOSHARDED, also include shard count.

---

## Error Handling

No custom overrides needed. Errors propagate to `AtlasToolBase.handleError`:
- **401** — credential/permission hint
- **402** — payment setup hint
- **403** — role permission hint
- **Other** — generic message via `ToolBase.handleError`

---

## Registration

Add to `src/tools/atlas/tools.ts`:
```ts
export { CreatePaidClusterTool } from "./create/createPaidCluster.js";
```

No changes needed to `src/tools/index.ts` — it aggregates from `tools.ts` automatically.

---

## Testing

Mirror existing pattern in `tests/integration/tools/atlas/clusters.test.ts` using `describeWithAtlas` + `withProject`.

Three test cases:
1. **REPLICASET with defaults** — supply only `name`; verify cluster is created with `M10`, `AWS`, `US_EAST_1`.
2. **SHARDED cluster** — supply `clusterType: "SHARDED"`, `numShards: 2`; verify two shards.
3. **Invalid region** — supply a region not valid for the chosen provider; verify `ApiClientError` is returned cleanly (no crash).

Run with:
```bash
export MDB_MCP_API_CLIENT_ID="..."
export MDB_MCP_API_CLIENT_SECRET="..."
pnpm test tests/integration/tools/atlas/clusters.test.ts
```

---

## API Extractor

After implementation, run:
```bash
pnpm run update:api
```
Commit the refreshed reports under `api-extractor/reports/` so `pnpm run check` passes.
