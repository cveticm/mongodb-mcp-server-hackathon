import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import { z } from "zod";

export class UpdateDedicatedClusterTool extends AtlasToolBase {
    static toolName = "atlas-update-dedicated-cluster";
    public description =
        "Update an existing dedicated MongoDB Atlas cluster. Use this to scale the instance tier, pause or resume the cluster, upgrade the MongoDB major version, or enable/disable backup.";
    static operationType: OperationType = "update";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("ID of the Atlas project containing the cluster"),
        clusterName: AtlasArgs.clusterName().describe("Name of the cluster to update"),
        tier: z
            .enum(["M10", "M20", "M30", "M40", "M50", "M60", "M80", "M140", "M200", "M300"])
            .optional()
            .describe("New instance size for all cluster nodes, e.g. M30"),
        paused: z.boolean().optional().describe("Set to true to pause the cluster, false to resume it"),
        mongoDBMajorVersion: z
            .string()
            .optional()
            .describe('MongoDB major version to upgrade to, e.g. "7.0" or "8.0". Can only increase.'),
        backupEnabled: z.boolean().optional().describe("Set to true to enable cloud backup, false to disable it"),
    };

    protected async execute({
        projectId,
        clusterName,
        tier,
        paused,
        mongoDBMajorVersion,
        backupEnabled,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (tier === undefined && paused === undefined && mongoDBMajorVersion === undefined && backupEnabled === undefined) {
            return {
                content: [
                    {
                        type: "text",
                        text: "At least one of tier, paused, mongoDBMajorVersion, or backupEnabled must be specified.",
                    },
                ],
                isError: true,
            };
        }

        const current = await this.apiClient.getCluster({
            params: { path: { groupId: projectId, clusterName } },
        });

        const body: Partial<ClusterDescription20240805> = {};

        if (tier !== undefined) {
            const replicationSpecs = structuredClone(current.replicationSpecs ?? []);
            for (const spec of replicationSpecs) {
                for (const regionConfig of spec.regionConfigs ?? []) {
                    const rc = regionConfig as {
                        electableSpecs?: { instanceSize?: string };
                        analyticsSpecs?: { instanceSize?: string };
                        readOnlySpecs?: { instanceSize?: string };
                    };
                    if (rc.electableSpecs) rc.electableSpecs.instanceSize = tier;
                    if (rc.analyticsSpecs) rc.analyticsSpecs.instanceSize = tier;
                    if (rc.readOnlySpecs) rc.readOnlySpecs.instanceSize = tier;
                }
            }
            body.replicationSpecs = replicationSpecs;
        }

        if (paused !== undefined) {
            (body as Record<string, unknown>).paused = paused;
        }

        if (mongoDBMajorVersion !== undefined) {
            body.mongoDBMajorVersion = mongoDBMajorVersion;
        }

        if (backupEnabled !== undefined) {
            body.backupEnabled = backupEnabled;
        }

        await this.apiClient.updateCluster(projectId, clusterName, body);

        const changes: string[] = [];
        if (tier !== undefined) changes.push(`tier → ${tier}`);
        if (paused !== undefined) changes.push(`paused → ${paused}`);
        if (mongoDBMajorVersion !== undefined) changes.push(`mongoDBMajorVersion → ${mongoDBMajorVersion}`);
        if (backupEnabled !== undefined) changes.push(`backupEnabled → ${backupEnabled}`);

        return {
            content: [
                {
                    type: "text",
                    text: `Cluster "${clusterName}" update requested: ${changes.join(", ")}. Changes may take a few minutes to apply.`,
                },
            ],
        };
    }
}
