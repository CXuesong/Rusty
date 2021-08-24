import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { HasRoomPosition } from "src/utility/pathFinder";
import { IDisposable, PromiseLikeResolutionSource } from "tasklike-promise-library";
import { CreepSku } from "./creepSku";
import { GameObjectRef, gameObjectRefFromId } from "./gameObjectRef";

export interface ScheduleRoomObjectOptions {
    /** The larger the number, the higher the priority. */
    priority?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    preferredPositions?: Array<[position: RoomPosition | HasRoomPosition | null | undefined | boolean, weight?: number]>;
    /** In game ticks. Defaults to 10. */
    timeout?: number;
}

export interface ScheduleCreepOptions extends ScheduleRoomObjectOptions {
    sku: CreepSku;
    resource: ResourceConstant | "free";
    minAmount?: number;
}

export interface ScheduledCreep extends IDisposable {
    creepRef: GameObjectRef<Creep>;
}

export type SchedulableSource = Source | Tombstone | Ruin | Resource | StructureStorage | Mineral | Deposit;

export interface ScheduleSourceOptions extends ScheduleRoomObjectOptions {
    resource: ResourceConstant;
    minAmount?: number;
}

export interface ScheduledSource extends IDisposable {
    sourceRef: GameObjectRef<SchedulableSource>;
}

export interface ScheduleLinkPairOptions extends ScheduleRoomObjectOptions {
    resource: "energy";
    minAmount?: number;
}

export interface ScheduledLinkPair extends IDisposable {
    sourceRef: GameObjectRef<StructureLink>;
    targetRef: GameObjectRef<StructureLink>;
}

function getPos(pos: RoomPosition | HasRoomPosition): RoomPosition {
    if ("pos" in pos) return pos.pos;
    return pos;
}

const occupiedCreepMap = new Map<Id<Creep>, IDisposable>();

interface PendingCreepRequest {
    tick: number;
    priority: number;
    /** Ordered candidates */
    candidates: Creep[];
    resolutionSource: PromiseLikeResolutionSource<ScheduledCreep | undefined>;
}

export class ObjectScheduler {
    protected readonly logger = new Logger("Rusty.Task.ObjectScheduler");
    private readonly pendingCreepRequests: PendingCreepRequest[] = [];
    public scheduleCreep(options: ScheduleCreepOptions): PromiseLike<ScheduledCreep | undefined> {
        const { sku, resource, minAmount = 1, preferredPositions } = options;
        if (!preferredPositions?.length)
            throw new Error("Need position to determine room.");
        this.logger.trace(() => `scheduleCreep: ${sku}, ${resource}>=${minAmount} in ${preferredPositions}`);
        // Evaluate all possible combinations
        const candidates = _(options.preferredPositions)
            .map(([pos, weight = 1]) => {
                if (pos && typeof pos === "object" && weight > 0) {
                    pos = getPos(pos);
                    // impl. in the same room
                    const creep = pos.findClosestByRange(FIND_MY_CREEPS, {
                        filter: c => {
                            if (c.memory.rustySku !== sku || occupiedCreepMap.has(c.id))
                                return false;
                            if (resource === "free") {
                                if (c.store.getFreeCapacity() < minAmount)
                                    return false;
                            } else if (c.store[resource] < minAmount)
                                return false;
                            return true;
                        }
                    });
                    if (creep) {
                        return { pos, creep, cost: (Math.abs(creep.pos.x - pos.x) + Math.abs(creep.pos.y - pos.y)) / weight }
                    }
                }
                return undefined;
            })
            .filter(e => !!e)
            .orderBy(e => e!.cost, "asc")
            .map(e => e!.creep)
            .value();
        if (!candidates.length) {
            this.logger.trace(() => `scheduleCreep failed fast.`);
            return Promise.resolve(undefined);
        }
        const prs = new PromiseLikeResolutionSource<ScheduledCreep | undefined>();
        this.pendingCreepRequests.push({
            tick: Game.time,
            candidates,
            priority: options.priority ?? 5,
            resolutionSource: prs
        });
        return prs.promiseLike;
    }
    public scheduleSource(options: ScheduleSourceOptions): PromiseLike<ScheduledSource | undefined> {
        return Promise.resolve(undefined);
    }
    public scheduleLinkPair(options: ScheduleLinkPairOptions): PromiseLike<ScheduledLinkPair | undefined> {
        return Promise.resolve(undefined);
    }
    /** Execute schedule for current game tick. */
    public schedulePendingRequests() {
        const tick = Game.time;
        this.logger.trace(() => `schedulePendingRequests: schedule ${this.pendingCreepRequests.length} creep requests.`);
        this.pendingCreepRequests.sort((x, y) => x.priority - y.priority);
        while (this.pendingCreepRequests.length) {
            const req = this.pendingCreepRequests.pop()!;
            if (req.tick !== tick) {
                req.resolutionSource.tryReject(new Error(`Creep request queued at ${req.tick} is expired. Current tick: ${tick}.`));
                continue;
            }
            const selectedCreep = req.candidates.find(c => !occupiedCreepMap.has(c.id));
            if (!selectedCreep) {
                req.resolutionSource.tryResolve(undefined);
                continue;
            }
            const creepRef = gameObjectRefFromId(selectedCreep);
            const result: ScheduledCreep = {
                creepRef,
                dispose: () => {
                    if (occupiedCreepMap.get(creepRef.id) === result)
                        occupiedCreepMap.delete(creepRef.id);
                }
            }
            req.resolutionSource.tryResolve(result);
        }
    }
}