import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { evadeBlockers, evadeHostileCreeps, findNearestPath } from "src/utility/pathFinder";
import { enumSpecializedCreeps, SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "./base";
import { getSpecializedCreep } from "./registry";
import { initializeCreepMemory, spawnCreep } from "./spawn";

interface CollectorCreepStateBase {
    mode: string;
    isWalking?: boolean;
}

interface CollectorCreepStateIdle extends CollectorCreepStateBase {
    mode: "idle";
    nextEvalTime: number;
}

interface CollectorCreepStateCollect extends CollectorCreepStateBase {
    mode: "collect";
    destId: Id<Source> | Id<Tombstone> | Id<Resource> | Id<Creep>;
    /** Expiry at which the target and path cache can be considered as "invalidated". */
    nextEvalTime: number;
}

interface CollectorCreepStateCollectSource extends CollectorCreepStateCollect {
    readonly sourceId: Id<Source>;
    sourceDistance: 0;
    relayTo?: Id<Creep>;
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
    destId: Id<unknown>;
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

function structureNeedsRepair(structure: Structure): "yes" | "now" | false {
    if (!structure.hitsMax) return false;
    if (structure.hitsMax - structure.hits < 500 && structure.hits / structure.hitsMax > 0.8) return false;
    // 2000 -- needs 20 ticks to repair.
    return structure.hitsMax - structure.hits > 2000 || structure.hits / structure.hitsMax < 0.5
        ? "now" : "yes";
}

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
    public nextFrame(): void {
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
                && r.amount * (1 - r.pos.getRangeTo(creep) * 1.6 / ENERGY_DECAY) > 20
        }) as Resource<RESOURCE_ENERGY>[];
        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: t => t.store.energy >= 20 && t.ticksToDecay >= 3
                && !reachedMaxPeers(t.id, 2)
        });
        const sources = room.find(FIND_SOURCES_ACTIVE, {
            filter: t => t.energy >= 50 || t.energyCapacity >= 100 && t.ticksToRegeneration <= 20
                // Allow queuing up
                && !reachedMaxPeers(t.id, 10)
        });
        // We allow stealing energy from existing collecting creeps.
        const collectingCreeps = enumSpecializedCreeps(CollectorCreep, room)
            .filter(c => c !== this
                && c.state.mode === "collect"
                && (("sourceId" in c.state || "sourceCreepId" in c.state) && c.state.sourceDistance <= 1)
                && !reachedMaxPeers(c.id, 1))
            .map(c => c.creep)
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
        const { creep, state } = this;
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
            const reEvaluatePath = (target: StructureController | StructureSpawn | ConstructionSite | StructureExtension | StructureTower) => {
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
            } else if ("spawnId" in state || "extensionId" in state || "towerId" in state) {
                const st = Game.getObjectById(state.destId as Id<StructureExtension | StructureTower>);
                const minFreeCap = st instanceof StructureSpawn ? 10 : 0;
                if (st && (st.store.getFreeCapacity(RESOURCE_ENERGY) > minFreeCap || structureNeedsRepair(st))) {
                    reEvaluatePath(st);
                    return true;
                }
            }
        }
        const structures = room.find(FIND_MY_STRUCTURES, {
            filter: s => (
                (s.structureType === STRUCTURE_EXTENSION
                    || s.structureType === STRUCTURE_TOWER
                    || s.structureType === STRUCTURE_RAMPART
                )
                && (structureNeedsRepair(s) === "now" || "store" in s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                && !reachedMaxPeers(s.id, 4)
            )
        }) as Array<StructureExtension | StructureTower | StructureRampart>;
        const towers = structures.filter((s): s is StructureTower => s instanceof StructureTower);
        const constructionSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.progress < s.progressTotal });
        const { controller } = room;
        let controllerPriority: number;
        if (controller?.my) {
            if (!reachedMaxPeers(controller.id, 1) || controller.ticksToDowngrade <= 1500 && !reachedMaxPeers(controller.id, 4)) {
                // Resetting downgrade timer is priority.
                controllerPriority = 1;
            } else if (towers.length || constructionSites.length > 2) {
                controllerPriority = 0
            } else if (!reachedMaxPeers(controller.id, 6)) {
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
            if (towers.length && _(towers).map(t => creep.pos.getRangeTo(t.pos)).min()! < 20) {
                // Feeding tower is priority.
                goals = [...towers];
            } else {
                goals = [
                    ...constructionSites,
                    ...structures,
                    ...spawns
                ];
            }
            const nearest = findNearestPath(creep.pos, goals, { maxRooms: 1, roomCallback: roomCallback });
            if (!nearest) {
                this.logger.warning(`transitDistribute: findNearestPath(${goals}) -> undefined.`);
                return false;
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
        if (Game.time < state.nextEvalTime) return;
        if (creep.store.energy < 40 && this.transitCollect())
            return;
        if (creep.store.energy > 10 && this.transitDistribute())
            return;
        this.transitIdle();
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
            if (scstate && scstate.mode == "collect" && "relayTo" in scstate && scstate.relayTo === this.id && state.sourceDistance != null) {
                result = sc ? sc.transfer(creep, RESOURCE_ENERGY) : undefined;
                this.logger.trace(`nextFrameCollect: sourceCreep.transfer(creep) -> ${result}.`);
            } else {
                // In case peer changed source.
                result = undefined;
                this.logger.trace(`nextFrameCollect: sourceCreep ${sc} changed source: mode=${scstate?.mode}.`);
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
        } else if ("spawnId" in state || "extensionId" in state || "towerId" in state || "rampartId" in state) {
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
        if (result == null || result === ERR_NOT_IN_RANGE) {
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
