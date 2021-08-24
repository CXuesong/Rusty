import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { findNearestPath } from "src/utility/pathFinder";
import { isWalkableByLookAtResult } from "src/utility/terrain";
import { CancellationTokenSource, ICancellationToken } from "tasklike-promise-library";
import { nextGameFrame } from "../async";
import { creepCollectAction } from "../creepActions/collect";
import { GameObjectRef, gameObjectRefFromId } from "../gameObjectRef";
import type { ObjectScheduler, ScheduledCreep } from "../objectScheduler";
import { TaskBase } from "./base";

export type HarvestableObject = Resource | Mineral | Deposit;

interface HarvestableObjectInfo {
    ref: GameObjectRef<HarvestableObject>;
    slots: RoomPosition[];
    incomingCreeps: Id<Creep>[];
}

interface CreepState {
    targetRef: GameObjectRef<HarvestableObject>;
}

const emptyHarvestableObjectInfo: Omit<HarvestableObjectInfo, "ref"> = {
    slots: [],
    incomingCreeps: []
};

export class HarvestTask extends TaskBase {
    private readonly scheduledCreeps = new Map<Id<Creep>, CreepState>();
    private _harvestableObjects = new Map<Id<HarvestableObject>, HarvestableObjectInfo>();
    protected readonly logger = new Logger("Rusty.Task.Definitions.HarvestTask");
    public static isApplicableToRoom(roomName: string): boolean {
        const room = Game.rooms[roomName];
        if (!room) return false;
        if (room.find(FIND_SOURCES).length) return true;
        if (room.find(FIND_MINERALS).length) return true;
        if (room.find(FIND_DEPOSITS).length) return true;
        return false;
    }
    public constructor(private _objectScheduler: ObjectScheduler, public readonly roomName: string) {
        super();
    }
    private _updateHarvestableObjects(): void {
        const room = Game.rooms[this.roomName];
        if (!room) return;
        const objs = [
            ...room.find(FIND_SOURCES),
        ...room.find(FIND_MINERALS),
            ...room.find(FIND_DEPOSITS)
        ];
        const nextHarvestableObjects = new Map<Id<HarvestableObject>, HarvestableObjectInfo>();
        for (const obj of objs) {
            const slots: RoomPosition[] = [];
            const { pos } = obj;
            const ref = gameObjectRefFromId<HarvestableObject>(obj);
            const adjacent = obj.room!.lookAtArea(pos.y - 1, pos.x - 1, pos.y + 1, pos.x + 1);
            for (let x = pos.x - 1; x <= pos.x + 1; x++) {
                for (let y = pos.x - 1; y <= pos.x + 1; y++) {
                    if (x === y) continue;
                    if (isWalkableByLookAtResult(adjacent[y][x]))
                        slots.push(obj.room?.getPositionAt(x, y)!);
                }
            }
            const prevInfo = this._harvestableObjects.get(ref.id);
            nextHarvestableObjects.set(ref.id, {
                ...prevInfo || emptyHarvestableObjectInfo,
                ref,
                slots
            });
        }
        this._harvestableObjects = nextHarvestableObjects;
    }
    protected async doWork(cancellationToken: ICancellationToken): Promise<void> {
        while (true) {
            const tick = await nextGameFrame();
            cancellationToken.throwIfCancellationRequested();
            if (!this._harvestableObjects.size || tick % 10 === 0) {
                this._updateHarvestableObjects();
            }
            for (const [c] of this.scheduledCreeps) {
                if (!Game.getObjectById(c)) this.scheduledCreeps.delete(c);
            }
            const freeObjects = _([...this._harvestableObjects.values()])
                .filter(info => info.slots.length > info.incomingCreeps.length && info.ref.exists)
                .map(info => info.ref)
                .value();
            // All sources are occupied.
            if (!freeObjects.length)
                continue;
            const scheduled = await this._objectScheduler.scheduleCreep({
                sku: "CarryWorker",
                priority: 0,
                resource: "free",
                preferredPositions: freeObjects.map(o => [o.target])
            });
            if (scheduled) {
                const nearest = findNearestPath(scheduled.creepRef.target!, freeObjects.map(o => o.target).filter((o): o is HarvestableObject => !!o));
                if (nearest) {
                    const creepState: CreepState = { targetRef: gameObjectRefFromId(nearest.goal.id as Id<HarvestableObject>) };
                    this.scheduledCreeps.set(scheduled.creepRef.id, creepState);
                    this._harvestableObjects.get(nearest.goal.id)!.incomingCreeps.push(scheduled.creepRef.id);
                    this.creepTask(scheduled, creepState, cancellationToken);
                } else {
                    this.logger.warning(`Unable to schedule target for ${scheduled.creepRef}.`);
                    scheduled.dispose();
                }
            }
        }
    }
    private async creepTask(scheduledCreep: ScheduledCreep, creepState: CreepState, ct: ICancellationToken): Promise<void> {
        const { creepRef } = scheduledCreep;
        const { targetRef } = creepState;
        try {
            const collectCts = CancellationTokenSource.race(ct);
            // TODO collectCts cancellation
            await creepCollectAction({
                creepRef: scheduledCreep.creepRef,
                sourceRef: targetRef,
                resourceType: "any",
                onCollectingStarted: () => {
                    this._harvestableObjects.get(targetRef.id)?.incomingCreeps.remove(creepRef.id);
                }
            }, collectCts.token);
        } finally {
            scheduledCreep.dispose();
            this.scheduledCreeps.delete(scheduledCreep.creepRef.id);
        }
    }
}