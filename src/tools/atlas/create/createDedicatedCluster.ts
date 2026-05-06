import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import { AtlasArgs } from "../../args.js";
import { z } from "zod";

const PROVIDER_DEFAULT_REGIONS = {
    AWS: "US_EAST_1",
    AZURE: "US_EAST_2",
    GCP: "CENTRAL_US",
} as const;

export class CreateDedicatedClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-dedicated-cluster";
    public description =
        "Create a dedicated MongoDB Atlas cluster. Use this over atlas-create-free-cluster when a cluster greater than M0 is required, or when the workload requires guaranteed compute and memory, larger storage, backup support, or private networking.";
    static operationType: OperationType = "create";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("ID of the Atlas project to create the cluster in"),
        name: AtlasArgs.clusterName().describe("Name of the cluster"),
        clusterType: z
            .enum(["REPLICASET", "SHARDED", "GEOSHARDED"])
            .default("REPLICASET")
            .describe("Type of cluster: REPLICASET (default), SHARDED, or GEOSHARDED"),
        provider: z
            .enum(["AWS", "AZURE", "GCP"])
            .default("AWS")
            .describe("Cloud provider: AWS (default), AZURE, or GCP"),
        region: AtlasArgs.region()
            .optional()
            .describe(
                "Cloud region to deploy the cluster in. Defaults to US_EAST_1 for AWS, US_EAST_2 for AZURE, and CENTRAL_US for GCP"
            ),
        tier: z
            .enum(["M10", "M20", "M30", "M40", "M50", "M60", "M80", "M140", "M200", "M300"])
            .default("M10")
            .describe("Instance size for cluster nodes, e.g. M10 (default), M20, M30"),
        numShards: z
            .number()
            .int()
            .min(1)
            .max(12)
            .default(2)
            .describe("Number of shards for SHARDED or GEOSHARDED clusters. Ignored for REPLICASET. Defaults to 2"),
    };

    protected async execute({
        projectId,
        name,
        clusterType,
        provider,
        region,
        tier,
        numShards,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const resolvedRegion = region ?? PROVIDER_DEFAULT_REGIONS[provider];

        const baseSpec = {
            zoneName: "Zone 1",
            regionConfigs: [
                {
                    providerName: provider,
                    regionName: resolvedRegion,
                    electableSpecs: {
                        instanceSize: tier,
                        nodeCount: 3,
                    },
                    priority: 7,
                },
            ],
        };

        const replicationSpecs =
            clusterType === "REPLICASET"
                ? [baseSpec]
                : Array.from({ length: numShards }, () => structuredClone(baseSpec));

        const body = {
            name,
            clusterType,
            replicationSpecs,
            terminationProtectionEnabled: false,
        } as unknown as ClusterDescription20240805;

        await ensureCurrentIpInAccessList(this.apiClient, projectId);
        await this.apiClient.createCluster({
            params: {
                path: {
                    groupId: projectId,
                },
            },
            body,
        });

        const shardsNote = clusterType !== "REPLICASET" ? ` with ${numShards} shards` : "";
        return {
            content: [
                {
                    type: "text",
                    text: `Cluster "${name}" (${clusterType}${shardsNote}, ${tier} on ${provider} in ${resolvedRegion}) creation has been requested. It may take a few minutes to provision.`,
                },
            ],
        };
    }
}
