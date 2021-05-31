import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { evadeBlockers, evadeHostileCreeps, findNearestPath } from "src/utility/pathFinder";
import { enumSpecializedCreeps, SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "./base";
import { getSpecializedCreep } from "./registry";
import { initializeCreepMemory, spawnCreep } from "./spawn";

const MIN_COLLECTABLE_DROPPED_ENERGY = 20;

interface CollectorCreepStateBase {
    mode: string;
    isWalking?: boolean;
}

interface CollectorCreepStateIdle extends CollectorCreepStateBase {
    mode: "idle";
    nextEvalTime: number;
}

type CollectorCreepCollectDestType = Source | Tombstone | Resource | Creep;
type CollectorCreepDistributeDestType
    = StructureController
    | ConstructionSite
    | StructureSpawn
    | StructureExtension
    | StructureTower
    | StructureRampart
    | StructureRoad
    | StructureWall;

interface CollectorCreepStateCollect extends CollectorCreepStateBase {
    mode: "collect";
    destId: Id<CollectorCreepCollectDestType>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepStateCollectSource extends CollectorCreepStateCollect {
    readonly sourceId: Id<Source>;
    sourceDistance: 0;
}

interface CollectorCreepStateCollectTombstone extends CollectorCreepStateCollect {
    readonly tombstoneId: Id<Tombstone>;
}

// Resource dropped.
interface CollectorCreepStateCollectResource extends CollectorCreepStateCollect {
    readonly resourceId: Id<Resource>;
}

interface CollectorCreepStateCollectCreepRelay extends CollectorCreepStateCollect {
    readonly sourceCreepId: Id<Creep>;
    sourceDistance: number;
}

interface CollectorCreepStateDistribute extends CollectorCreepStateBase {
    mode: "distribute";
    destId: Id<CollectorCreepDistributeDestType>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepStateDistributeSpawn extends CollectorCreepStateDistribute {
    spawnId: Id<StructureSpawn>;
    destId: Id<StructureSpawn>;
}

interface CollectorCreepStateDistributeTower extends CollectorCreepStateDistribute {
    towerId: Id<StructureTower>;
    destId: Id<StructureTower>;
}

interface CollectorCreepStateDistributeExtension extends CollectorCreepStateDistribute {
    extensionId: Id<StructureExtension>;
    destId: Id<StructureExtension>;
}

interface CollectorCreepStateDistributeRampart extends CollectorCreepStateDistribute {
    rampartId: Id<StructureRampart>;
    destId: Id<StructureRampart>;
}

interface CollectorCreepStateDistributeWall extends CollectorCreepStateDistribute {
    wallId: Id<StructureWall>;
    destId: Id<StructureWall>;
}

interface CollectorCreepStateDistributeRoad extends CollectorCreepStateDistribute {
    roadId: Id<StructureRoad>;
    destId: Id<StructureRoad>;
}

interface CollectorCreepStateDistributeController extends CollectorCreepStateDistribute {
    controllerId: Id<StructureController>;
    destId: Id<StructureController>;
}

interface CollectorCreepStateDistributeConstruction extends CollectorCreepStateDistribute {
    constructionSiteId: Id<ConstructionSite>;
    destId: Id<ConstructionSite>;
}

export type CollectorCreepState
    = CollectorCreepStateIdle
    | CollectorCreepStateCollectSource
    | CollectorCreepStateCollectTombstone
    | CollectorCreepStateCollectResource
    | CollectorCreepStateCollectCreepRelay
    | CollectorCreepStateDistributeSpawn
    | CollectorCreepStateDistributeTower
    | CollectorCreepStateDistributeExtension
    | CollectorCreepStateDistributeRampart
    | CollectorCreepStateDistributeWall
    | CollectorCreepStateDistributeRoad
    | CollectorCreepStateDistributeController
    | CollectorCreepStateDistributeConstruction;

type CollectorDestId = Id<RoomObject>;

let occupiedDests: Map<CollectorDestId, Set<Id<Creep>>> | undefined;

const emptySet: ReadonlySet<any> = {
    entries: function* () { },
    forEach: () => { },
    has: () => false,
    keys: function* () { },
    size: 0,
    values: function* () { },
    [Symbol.iterator]: function* () { },
}

export function houseKeeping(logger: Logger) {
    if (occupiedDests) {
        let count = 0;
        for (const [destId, collectors] of occupiedDests) {
            if (!Game.getObjectById(destId)) {
                occupiedDests.delete(destId);
                continue;
            }
            for (const collector of collectors) {
                if (!(Game.getObjectById(collector) instanceof Creep)) {
                    collectors.delete(collector);
                }
            }
        }
        logger.info(`Removed ${count} dangling collector in occupiedDests cache.`);
    }
}

function getTargetingCollectors(id: CollectorDestId): ReadonlySet<Id<Creep>> {
    if (!occupiedDests) {
        occupiedDests = new Map();
        for (const c of enumSpecializedCreeps(CollectorCreep)) {
            if (c.state.mode === "collect")
                addTargetingCollector(c.state.destId, c.id);
            else if (c.state.mode === "distribute")
                addTargetingCollector(c.state.destId, c.id);
        }
    }
    return occupiedDests.get(id) || emptySet;
}

function addTargetingCollector(id: CollectorDestId, collector: Id<Creep>): void {
    if (!occupiedDests) return;
    let set = occupiedDests.get(id);
    if (!set) {
        set = new Set();
        occupiedDests.set(id, set);
    }
    set.add(collector);
}

function removeTargetingCollector(id: CollectorDestId, collector: Id<Creep>): void {
    if (!occupiedDests) return;
    const set = occupiedDests.get(id);
    if (!set) return;
    set.delete(collector);
    if (!set.size) occupiedDests.delete(id);
}

export function structureNeedsRepair(structure: Structure): "now" | "yes" | "later" | false {
    // some WALL does not have hitsMax
    if (!structure.hitsMax || structure.hits >= structure.hitsMax) return false;
    if (structure instanceof StructureRampart) {
        // 3600 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME = 15,800
        if (structure.hits < 5000 + 3600 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME)
            return "now";
        if (structure.hits < 10000 + 3600 * 24 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME)
            return "yes";
        // Rampart has relatively high hitsMax
        if (structure.hits < 50000 + 3600 * 24 * 2 * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME)
            return "later";
        return false;
    }
    if (structure instanceof StructureWall) {
        if (structure.hits < 50000)
            return "now";
        if (structure.hits < 500000)
            return "yes";
        if (structure.hits < 1000000)
            return "later";
        return false;
    }
    if (structure instanceof StructureRoad) {
        if (structure.hits < 2000 || structure.hits / structure.hitsMax < 0.2)
            return "now";
        if (structure.hits / structure.hitsMax < 0.8)
            return "yes";
        return "later";
    }
    // Tactic targets
    if (structure instanceof StructureTower || structure instanceof StructureSpawn) {
        const damage = structure.hitsMax - structure.hits;
        if (damage > 500)
            return "now";
        if (damage > 100)
            return "yes";
        return "later";
    }
    if (structure.hitsMax - structure.hits < 1000 && structure.hits / structure.hitsMax > 0.5) return false;
    // 2000 -- needs 20 ticks to repair.
    return structure.hits < 2000 || structure.hits / structure.hitsMax < 0.1
        ? "now" : "yes";
}

function estimateDecayedResourceAmount(currentPos: RoomPosition, target: Resource) {
    return Math.floor(target.amount * Math.pow(1 - 1 / ENERGY_DECAY, target.pos.getRangeTo(currentPos) * 1.6));
}

export const __internal__debugInfo = {
    getOccupiedDests: () => occupiedDests
};

export class CollectorCreep extends SpecializedCreepBase<CollectorCreepState> {
    public static readonly rustyType = "collector";
    private logger = new Logger(`Rusty.SpecializedCreeps.CollectorCreep.#${this.creep.name}`);
    private pathCache: { targetId: string; targetPath: RoomPosition[] | PathStep[] } | undefined;
    public static spawn(spawn: StructureSpawn, variant?: "normal" | "lite"): string | SpecializedSpawnCreepErrorCode {
        if (!variant) variant = "normal";
        const name = spawnCreep(spawn, variant === "normal" ? {
            [CARRY]: 2,
            [MOVE]: 2,
            [WORK]: 1,
        } : {
            [CARRY]: 1,
            [MOVE]: 3,
            [WORK]: 1,
        });
        if (typeof name === "string") {
            initializeCreepMemory<CollectorCreepState>(name, CollectorCreep.rustyType, { mode: "idle", nextEvalTime: Game.time });
        }
        return name;
    }
    protected onNextFrame(): void {
        const { state } = this;
        switch (state.mode) {
            case "idle":
                this.nextFrameIdle();
                break;
            case "collect":
                this.nextFrameCollect();
                break;
            case "distribute":
                this.nextFrameDistribute();
                break;
            default:
                this.transitIdle();
                break;
        }
    }
    protected onStateRootChanging(newState: CollectorCreepState): CollectorCreepState {
        const { creep, state } = this;
        if (newState.mode !== state.mode) {
            creep.say(newState.mode.split("-").map(s => s.substr(0, 4)).join("-"));
            this.logger.info(`Switch mode: ${state.mode} -> ${newState.mode}.`);
        }
        if ((state.mode === "collect" || state.mode === "distribute")
            && (newState.mode !== state.mode || !("destId" in newState) || newState.destId !== state.destId)) {
            removeTargetingCollector(state.destId, this.id);
            if (newState.mode === "collect" || newState.mode === "distribute")
                addTargetingCollector(newState.destId, this.id);
        }
        return newState;
    }
    public dispose() {
        const { state } = this;
        if (this.disposed) return;
        if (state.mode === "collect" && "destId" in state) {
            removeTargetingCollector(state.destId, this.id);
        }
        super.dispose();
    }
    private transitCollect(): boolean {
        const { creep } = this;
        const { room } = creep;
        const reachedMaxPeers = (id: CollectorDestId, maxPeers: number) => {
            const c = getTargetingCollectors(id);
            const peers = c.size - (c.has(this.id) ? 1 : 0);
            return peers >= maxPeers;
        }
        const roomCallback = (roomName: string) => {
            const room = Game.rooms[roomName];
            if (!room) {
                this.logger.warning(`Unable to check room ${roomName}.`);
                return false;
            }
            const costs = new PathFinder.CostMatrix();
            evadeBlockers(room, costs);
            evadeHostileCreeps(room, costs);
            costs.set(creep.pos.x, creep.pos.y, 0);
            return costs;
        }
        const resources = room.find(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY
                && !reachedMaxPeers(r.id, 1)
                && estimateDecayedResourceAmount(creep.pos, r) >= MIN_COLLECTABLE_DROPPED_ENERGY
        }) as Resource<RESOURCE_ENERGY>[];
        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: t => t.store.energy >= MIN_COLLECTABLE_DROPPED_ENERGY && t.ticksToDecay >= 3
                && !reachedMaxPeers(t.id, 2)
        });
        const sources = room.find(FIND_SOURCES_ACTIVE, {
            filter: t => t.energy >= 50 || t.energyCapacity >= 100 && t.ticksToRegeneration <= 20
                // Allow queuing up
                && !reachedMaxPeers(t.id, 10)
        });
        // We allow stealing energy from existing collecting creeps,
        // only if they have already collected some energy.
        const collectingCreeps = enumSpecializedCreeps(CollectorCreep, room)
            .filter(c => c !== this
                && c.state.mode === "collect"
                && (("sourceId" in c.state || "sourceCreepId" in c.state) && c.state.sourceDistance <= 1)
                && !reachedMaxPeers(c.id, 1))
            .map(c => c.creep)
            .filter(c => c.store.energy / c.store.getCapacity(RESOURCE_ENERGY) >= 0.4)
            .value();
        // Prefer collect from direct source.
        let nearest = findNearestPath<Source | Tombstone | Resource | Creep>(creep.pos, [
            ...resources,
            ...tombstones,
            ...sources
        ], { maxRooms: 1, roomCallback });
        this.logger.trace(`transitCollect: Nearest target: ${nearest?.goal}, cost ${nearest?.cost}.`);
        if (!nearest || nearest.cost > 20) {
            // If every direct source is too far away...
            const secondary = collectingCreeps.length
                ? findNearestPath(creep.pos, [...collectingCreeps], { maxRooms: 1, roomCallback })
                : undefined;
            this.logger.trace(`transitCollect: Secondary target: ${nearest?.goal}, cost ${nearest?.cost}.`);
            if (!nearest || secondary && nearest.cost - secondary.cost > 10)
                nearest = secondary;
        }
        if (!nearest) return false;
        const destId = nearest.goal.id;
        const nextEvalTime = Game.time + _.random(4, 10);
        this.logger.info(`transitCollect: Collect ${nearest.goal}, path: [${nearest.path.length}], cost ${nearest?.cost}.`);
        if (!nearest.path.length)
            this.logger.warning(`transitCollect: Empty path to ${nearest.goal}.`);
        if (nearest.goal instanceof Resource)
            this.state = { mode: "collect", resourceId: nearest.goal.id, destId, nextEvalTime };
        else if (nearest.goal instanceof Tombstone)
            this.state = { mode: "collect", tombstoneId: nearest.goal.id, destId, nextEvalTime };
        else if (nearest.goal instanceof Source)
            this.state = { mode: "collect", sourceId: nearest.goal.id, destId, sourceDistance: 0, nextEvalTime };
        else if (nearest.goal instanceof Creep) {
            const sourceCollector = getSpecializedCreep(nearest.goal, CollectorCreep);
            if (!sourceCollector) throw new Error("Unexpected null sourceCollector.");
            const sourceState = sourceCollector.state;
            if (sourceState.mode === "collect" && ("sourceId" in sourceState || "sourceCreepId" in sourceState)) {
                this.state = {
                    mode: "collect",
                    sourceCreepId: nearest.goal.id,
                    destId,
                    sourceDistance: sourceState.sourceDistance + 1,
                    nextEvalTime
                };
            } else {
                throw new Error("Unexpected sourceCollector state.");
            }
        } else
            throw new Error("Unexpected code path.");
        this.pathCache = { targetId: destId, targetPath: nearest.path };
        return true;
    }
    private transitIdle(nextEvalTimeOffset?: number): boolean {
        this.state = { mode: "idle", nextEvalTime: nextEvalTimeOffset ?? (Game.time + _.random(5)) };
        return true;
    }
    private transitDistribute(): boolean {
        type TTargetStructre = StructureSpawn | StructureExtension | StructureTower | StructureRampart;
        const { creep, state } = this;
        if (!creep.store.energy) return false;
        const { room } = creep;
        const reachedMaxPeers = (id: CollectorDestId, maxPeers: number) => {
            const c = getTargetingCollectors(id);
            const peers = c.size - (c.has(this.id) ? 1 : 0);
            return peers >= maxPeers;
        }
        const roomCallback = (roomName: string, costMatrix?: CostMatrix) => {
            const room = Game.rooms[roomName];
            if (!room) {
                this.logger.warning(`Unable to check room ${roomName}.`);
                return false;
            }
            const costs = costMatrix || new PathFinder.CostMatrix();
            evadeBlockers(room, costs);
            evadeHostileCreeps(room, costs);
            costs.set(creep.pos.x, creep.pos.y, 0);
            return costs;
        };
        if (state.mode === "distribute") {
            // Keep incremental state update if current is already in distribute state.
            const reEvaluatePath = (target: StructureController | ConstructionSite | TTargetStructre) => {
                this.pathCache = {
                    targetId: target.id,
                    targetPath: creep.pos.findPathTo(target.pos, {
                        maxRooms: 1,
                        costCallback: (n, c) => roomCallback(n, c) || c
                    })
                };
            }
            if ("controllerId" in state) {
                const c = Game.getObjectById(state.controllerId);
                if (c?.my) {
                    reEvaluatePath(c);
                    return true;
                }
            } else if ("constructionSiteId" in state) {
                const s = Game.getObjectById(state.constructionSiteId);
                if (s && s.progress < s.progressTotal) {
                    reEvaluatePath(s);
                    return true;
                }
            } else if ("spawnId" in state || "extensionId" in state || "towerId" in state || "rampartId" in state) {
                const st = Game.getObjectById(state.destId as Id<StructureSpawn | StructureExtension | StructureTower | StructureRampart>);
                const minFreeCap = st instanceof StructureSpawn ? 10 : 0;
                if (st && ("store" in st && st.store.getFreeCapacity(RESOURCE_ENERGY) > minFreeCap || structureNeedsRepair(st))) {
                    reEvaluatePath(st);
                    return true;
                }
            }
        }
        const structures = _(room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_EXTENSION && s.my
                || s.structureType === STRUCTURE_TOWER && s.my
                || s.structureType === STRUCTURE_RAMPART && s.my
                || s.structureType === STRUCTURE_ROAD
                || s.structureType === STRUCTURE_WALL
        }))
            .map(s => {
                const c = getTargetingCollectors(s.id);
                return {
                    structure: s as TTargetStructre,
                    needsRepair: structureNeedsRepair(s),
                    storeVacancy: "store" in s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
                    peers: c.size - (c.has(this.id) ? 1 : 0),
                }
            })
            .filter(e => !!e.needsRepair || e.storeVacancy)
            .value();
        // Normally, we consider structures in urgent need of fixing, and with vacant store.
        const normalStructureTargets = structures.filter(e => e.needsRepair === "now" || e.storeVacancy);
        const towers = structures.filter((s) => s.structure instanceof StructureTower);
        const constructionSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.progress < s.progressTotal });
        const { controller } = room;
        let controllerPriority: number;
        if (controller?.my) {
            if (!reachedMaxPeers(controller.id, 1) || controller.ticksToDowngrade <= 3600 && !reachedMaxPeers(controller.id, 4)) {
                // Resetting downgrade timer is priority.
                controllerPriority = 1;
            } else if (!reachedMaxPeers(controller.id, 6)) {
                controllerPriority = 0.2;
            } else if (!reachedMaxPeers(controller.id, 10)) {
                controllerPriority = 0.05;
            } else {
                controllerPriority = 0;
            }
        } else {
            controllerPriority = 0;
        }
        const nextEvalTime = Game.time + _.random(4, 10);
        if (controllerPriority === 0 || controllerPriority < 1 && _.random(true) > controllerPriority) {
            const spawns = room.find(FIND_MY_SPAWNS, { filter: s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 });
            let goals;
            if (towers.length && _(towers).map(t => creep.pos.getRangeTo(t.structure)).min()! < 20) {
                // Feeding tower is priority.
                goals = towers.map(e => e.structure) as TTargetStructre[];
            } else {
                goals = [
                    ...constructionSites,
                    ...normalStructureTargets.map(e => e.structure) as TTargetStructre[],
                    ...spawns
                ];
            }
            let nearest = findNearestPath<CollectorCreepDistributeDestType>(creep.pos, goals, { maxRooms: 1, roomCallback: roomCallback });
            if (!nearest) {
                // No goal.
                this.logger.info(`transitDistribute: No primary goal.`);
                // Try some no-so-urgent stuff
                const fixableStructures = structures.filter(e => e.needsRepair === "yes");
                const laterFixableStructures = structures.filter(e => e.needsRepair === "later");
                if ((fixableStructures.length && !laterFixableStructures.length || _.random() < 0.7)
                    // use "=" by design
                    && (nearest = findNearestPath(creep.pos, fixableStructures.map(e => e.structure), { maxRooms: 1, roomCallback: roomCallback }))) {
                    this.logger.info(`transitDistribute: Found fixable goal.`);
                } else if (laterFixableStructures.length
                    && (nearest = findNearestPath(creep.pos,
                        _(laterFixableStructures)
                            .map(e => e.structure)
                            .sampleSize(Math.max(2, laterFixableStructures.length / 4))
                            .value(), {
                        maxRooms: 1,
                        roomCallback: roomCallback
                    }))) {
                    this.logger.info(`transitDistribute: Found low-pri fixable goal.`);
                } else {
                    return false;
                }
            }
            const destId = nearest.goal.id as Id<any>;
            this.logger.info(`Distribute ${nearest.goal}.`);
            if (nearest.goal instanceof StructureSpawn) {
                this.state = { mode: "distribute", spawnId: nearest.goal.id, destId, nextEvalTime };
            }
            else if (nearest.goal instanceof ConstructionSite) {
                this.state = { mode: "distribute", constructionSiteId: nearest.goal.id, destId, nextEvalTime };
            } else if (nearest.goal instanceof StructureExtension) {
                this.state = { mode: "distribute", extensionId: nearest.goal.id, destId, nextEvalTime };
            } else if (nearest.goal instanceof StructureTower) {
                this.state = { mode: "distribute", towerId: nearest.goal.id, destId, nextEvalTime };
            } else if (nearest.goal instanceof StructureRampart) {
                this.state = { mode: "distribute", rampartId: nearest.goal.id, destId, nextEvalTime };
            } else if (nearest.goal instanceof StructureWall) {
                this.state = { mode: "distribute", wallId: nearest.goal.id, destId, nextEvalTime };
            } else if (nearest.goal instanceof StructureRoad) {
                this.state = { mode: "distribute", roadId: nearest.goal.id, destId, nextEvalTime };
            } else
                throw new Error("Unexpected code path.");
            this.pathCache = { targetId: destId, targetPath: nearest.path };
            return true;
        }
        if (controller?.my) {
            this.state = { mode: "distribute", controllerId: controller.id, destId: controller.id, nextEvalTime }
            this.pathCache = {
                targetId: controller.id,
                targetPath: creep.pos.findPathTo(controller.pos, {
                    maxRooms: 1,
                    costCallback: (n, c) => roomCallback(n, c) || c
                })
            };
            return true;
        }
        return false;
    }
    private checkEnergyConstraint(): boolean {
        const { creep, state } = this;
        switch (state.mode) {
            case "idle":
                return true;
            case "collect":
                if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    this.logger.trace("Reached max energy cap. transitDistribute.");
                    this.transitDistribute() || this.transitIdle();
                    return false;
                }
                return true;
            case "distribute":
                if (!creep.store.energy) {
                    this.transitCollect() || this.transitIdle();
                    return false;
                }
                return true;
            default:
                throw new Error("Invalid state.");
        }
    }
    private nextFrameIdle(): void {
        const { creep, state } = this;
        if (state.mode !== "idle") throw new Error("Invalid state.");
        if (Game.time < state.nextEvalTime) {
            creep.say(`Idle${state.nextEvalTime - Game.time}`);
            return;
        }
        const energy = creep.store.energy;
        const maxEnergy = creep.store.getCapacity(RESOURCE_ENERGY);
        if ((energy < 20 || energy / maxEnergy < 0.4) && this.transitCollect())
            return;
        if ((energy > 60 || energy / maxEnergy < 0.6) && this.transitDistribute())
            return;
        const tryPickupNearest = () => {
            if (maxEnergy - energy < MIN_COLLECTABLE_DROPPED_ENERGY) return false;
            const ts = creep.pos.findClosestByRange(FIND_TOMBSTONES, {
                filter: ts => ts.store.energy >= MIN_COLLECTABLE_DROPPED_ENERGY && !getTargetingCollectors(ts.id).size
            });
            if (ts && creep.pos.inRangeTo(ts, 4))
                return this.transitCollect();
            const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
                filter: r => r.resourceType === RESOURCE_ENERGY
                    && estimateDecayedResourceAmount(creep.pos, r) >= MIN_COLLECTABLE_DROPPED_ENERGY
                    && !getTargetingCollectors(r.id).size
            });
            if (dropped && creep.pos.inRangeTo(dropped, 4))
                return this.transitCollect();
        };

        if (tryPickupNearest()) return;
        if (energy < 20 && this.transitCollect()) return;
        if (this.transitDistribute()) return;

        this.transitIdle();
        creep.say("IdleStil");
    }
    private nextFrameCollect(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "collect") throw new Error("Invalid state.");
        let result;
        let dest;
        if ("resourceId" in state) {
            const resource = dest = Game.getObjectById(state.resourceId);
            result = resource ? creep.pickup(resource) : undefined;
            this.logger.trace(`nextFrameCollect: creep.withdraw -> ${result}.`);
        } else if ("tombstoneId" in state) {
            const tombstone = dest = Game.getObjectById(state.tombstoneId);
            result = tombstone ? creep.withdraw(tombstone, RESOURCE_ENERGY) : undefined;
            this.logger.trace(`nextFrameCollect: creep.withdraw -> ${result}.`);
        } else if ("sourceCreepId" in state) {
            const sc = dest = Game.getObjectById(state.sourceCreepId);
            const scollector = sc && getSpecializedCreep(sc, CollectorCreep);
            const scstate = scollector?.state;
            if (scstate?.mode == "collect" && "sourceDistance" in scstate && scstate.sourceDistance < state.sourceDistance) {
                if (!sc) {
                    result = undefined;
                } else if (sc.store.energy >= 5) {
                    result = sc ? sc.transfer(creep, RESOURCE_ENERGY) : undefined;
                    this.logger.trace(`nextFrameCollect: ${sc}.transfer(creep) -> ${result}.`);
                } else {
                    this.logger.info(`nextFrameCollect: sourceCreep ${sc} energy is exhausted.`);
                    if (!this.transitCollect())
                        this.transitIdle();
                    return
                }
            } else {
                // In case peer changed source.
                result = undefined;
                this.logger.info(`nextFrameCollect: sourceCreep ${sc} changed source: mode=${scstate?.mode}.`);
            }
        } else {
            const source = dest = Game.getObjectById(state.sourceId);
            result = source ? creep.harvest(source) : undefined;
            this.logger.trace(`nextFrameCollect: creep.harvest -> ${result}.`);
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE) {
            if (
                // Dest is gone.
                !dest
                // Need to prepare next path.
                || Game.time >= state.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
                // Transient cache lost.
                || this.pathCache?.targetId !== dest.id) {
                if (!this.transitCollect()) {
                    this.transitIdle();
                    return;
                }
            }
            if (!creep.fatigue) {
                if (!this.pathCache) throw new Error("Assertion failure.");
                const moveResult = creep.moveByPath(this.pathCache.targetPath);
                if (moveResult !== OK) {
                    this.logger.warning(`nextFrameCollect: creep.moveByPath(${dest}) -> ${moveResult}.`);
                    if (moveResult === ERR_NOT_FOUND) {
                        this.logger.trace(`pathCache: ${JSON.stringify(this.pathCache)}.`);
                        this.transitCollect();
                    }
                }
            }
            return;
        }
        if (result === ERR_NOT_ENOUGH_RESOURCES) {
            if (dest instanceof Source && dest.ticksToRegeneration > 10)
                creep.say("Wait Regn");
            else
                this.transitCollect() || this.transitIdle();
            return;
        }
    }
    private nextFrameDistribute(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "distribute") throw new Error("Invalid state.");
        let result;
        let dest;
        if ("constructionSiteId" in state) {
            const constructionSite = dest = Game.getObjectById(state.constructionSiteId);
            result = constructionSite ? creep.build(constructionSite) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.build -> ${result}.`);
        } else if ("spawnId" in state || "extensionId" in state || "towerId" in state || "rampartId" in state || "wallId" in state || "roadId" in state) {
            const st = dest = Game.getObjectById(state.destId as Id<StructureSpawn | StructureExtension | StructureTower | StructureRampart>);
            if (!st) {
                result = undefined
            } else {
                const needsRepair = st && structureNeedsRepair(st);
                const freeCap = "store" in st ? st.store.getFreeCapacity(RESOURCE_ENERGY) : 0;
                if (needsRepair === "now" || needsRepair && !freeCap) {
                    // Fix construct, if it needs fixing or we have more energy.
                    result = creep.repair(st);
                    this.logger.trace(`nextFrameDistribute: creep.repair(${st}) -> ${result}.`);
                } else {
                    result = creep.transfer(st, RESOURCE_ENERGY);
                    this.logger.trace(`nextFrameDistribute: creep.transfer -> ${result}.`);
                }
            }
        } else {
            const controller = dest = Game.getObjectById(state.controllerId);
            result = controller ? creep.upgradeController(controller) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.upgradeController -> ${result}.`);
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE || result == ERR_INVALID_TARGET) {
            if (
                // Dest is gone.
                !dest
                // Need to prepare next path.
                || Game.time >= state.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
                // Transient cache lost.
                || this.pathCache?.targetId !== dest.id) {
            } {
                // Recheck nearest spawn / controller.
                if (!this.transitDistribute()) {
                    this.transitIdle();
                    return;
                }
            }
            if (!creep.fatigue) {
                if (!this.pathCache) throw new Error("Assertion failure.");
                const moveResult = creep.moveByPath(this.pathCache.targetPath);
                if (moveResult !== OK) {
                    this.logger.warning(`nextFrameDistribute: creep.moveByPath(${dest}) -> ${moveResult}.`);
                }
            }
            return;
        } if (result === ERR_NOT_ENOUGH_RESOURCES) {
            if (!this.transitCollect)
                this.transitIdle();
            return;
        }
        if (result === ERR_FULL) {
            if (creep.store.energy > 25 && this.transitDistribute()) return;
            if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && this.transitCollect()) return;
            this.transitIdle();
            return;
        }
    }
}
