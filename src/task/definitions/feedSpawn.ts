import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { findNearestPath } from "src/utility/pathFinder";
import { ICancellationToken } from "tasklike-promise-library";
import { nextGameFrame } from "../async";
import { creepTransferResourceAction } from "../creepActions/transferResource";
import { GameObjectRef, gameObjectRefFromId } from "../gameObjectRef";
import type { ObjectScheduler, ScheduledCreep } from "../objectScheduler";
import { TaskBase } from "./base";

export type SpawnRelatedStructure = StructureSpawn | StructureExtension;

interface TargetInfo {
    targetRef: GameObjectRef<SpawnRelatedStructure>;
    creeps: GameObjectRef<Creep>[];
}

export class FeedSpawnTask extends TaskBase {
    protected readonly logger = new Logger(`Rusty.Task.Definitions.FeedSpawnTask.#${this.roomName}`);
    private _knownTargets = new Map<Id<SpawnRelatedStructure>, TargetInfo>();
    public static isApplicableToRoom(roomName: string): boolean {
        const room = Game.rooms[roomName];
        if (!room) return false;
        const spawns = room.find(FIND_MY_SPAWNS);
        if (!spawns.length) return false;
        return true;
    }
    public constructor(private _creepScheduler: ObjectScheduler, public readonly roomName: string) {
        super();
    }
    protected async doWork(cancellationToken: ICancellationToken): Promise<void> {
        while (true) {
            const tick = await nextGameFrame();
            cancellationToken.throwIfCancellationRequested();
            const room = Game.rooms[this.roomName];
            if (!room) {
                this.logger.error("Room is not penetrable.");
                return;
            }
            const spawns = room.find(FIND_MY_SPAWNS);
            if (!spawns.length) {
                this.logger.error("No spawns in the room.");
                return;
            }
            if (!this._knownTargets.size || tick % 10 === 0) {
                this._updateTargets();
            }
            const freeTargets: SpawnRelatedStructure[] = [];
            for (const targetInfo of this._knownTargets.values()) {
                const { target } = targetInfo.targetRef;
                if (!target) {
                    this._knownTargets.delete(targetInfo.targetRef.id);
                    continue;
                }
                targetInfo.creeps = targetInfo.creeps.filter(c => c.exists);
                if (target.store.getFreeCapacity(RESOURCE_ENERGY) > _(targetInfo.creeps).sumBy(c => c.target!.store.energy)) {
                    freeTargets.push(target);
                }
            }
            if (freeTargets.length > 0) {
                const scheduled = await this._creepScheduler.scheduleCreep({
                    sku: "CarryWorker",
                    priority: 4,
                    resource: RESOURCE_ENERGY,
                    minAmount: 25,
                    preferredPositions: freeTargets.map(t => [t]),
                });
                if (scheduled) {
                    const target = findNearestPath(scheduled.creepRef.target!, freeTargets);
                    if (target) {
                        this.creepTask(scheduled, gameObjectRefFromId<SpawnRelatedStructure>(target.goal), cancellationToken);
                    } else {
                        this.logger.warning(`Unable to schedule target for ${scheduled.creepRef}.`);
                        scheduled.dispose();
                    }
                }
            }
        }
    }
    private _updateTargets(): void {
        const room = Game.rooms[this.roomName];
        if (!room) return;
        const targets = room.find(FIND_STRUCTURES, { filter: s => (s.structureType === "spawn" || s.structureType === "extension") && s.my });
        const nextKnownTargets = new Map<Id<SpawnRelatedStructure>, TargetInfo>();
        for (const target of targets) {
            const id = target.id as Id<any>;
            nextKnownTargets.set(id, this._knownTargets.get(id) || { targetRef: gameObjectRefFromId(id), creeps: [] });
        }
        this._knownTargets = nextKnownTargets;
    }
    private async creepTask(scheduledCreep: ScheduledCreep, targetRef: GameObjectRef<SpawnRelatedStructure>, ct: ICancellationToken): Promise<void> {
        const { creepRef } = scheduledCreep;
        try {
            await creepTransferResourceAction({
                creepRef,
                resourceType: RESOURCE_ENERGY,
                targetRef,
            }, ct);
        } finally {
            scheduledCreep.dispose();
            this._knownTargets.get(targetRef.id)?.creeps.remove(creepRef);
        }
    }
}